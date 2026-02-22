const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const CMS_SESSION_KEY = "cmsUser";

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function nowIso() {
  return new Date().toISOString();
}

function safeJson(value, fallback) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseBool(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return ["1", "true", "on", "yes"].includes(normalized);
}

function parseJsonField(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const key = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${key}`;
}

function verifyPassword(password, stored) {
  if (!stored || !String(stored).startsWith("scrypt$")) return false;
  const [, salt, key] = String(stored).split("$");
  const check = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(check, "hex"), Buffer.from(key, "hex"));
}

function canRole(role, action, entity) {
  const matrix = {
    admin: {
      "*": ["read", "create", "update", "delete", "moderate", "bulk", "settings"]
    },
    editor: {
      products: ["read", "create", "update", "bulk"],
      stones: ["read", "create", "update"],
      collections: ["read", "create", "update"],
      pages: ["read", "create", "update"],
      media: ["read", "create", "update"],
      reviews: ["read"]
    },
    moderator: {
      reviews: ["read", "moderate", "update"],
      dashboard: ["read"]
    }
  };
  const roleRules = matrix[role] || {};
  const entityRules = roleRules[entity] || [];
  const wildcard = roleRules["*"] || [];
  return [...entityRules, ...wildcard].includes(action);
}

function validateReviewStatusTransition(fromStatus, toStatus) {
  const from = fromStatus || "pending";
  const to = toStatus || from;
  const allowed = {
    pending: ["pending", "approved", "rejected"],
    approved: ["approved", "rejected"],
    rejected: ["rejected", "approved"]
  };
  return (allowed[from] || []).includes(to);
}

function normalizeArrayOfObjects(value) {
  const parsed = parseJsonField(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeProductPayload(body) {
  const variations = normalizeArrayOfObjects(body.variations).map((v, idx) => ({
    id: String(v.id || `var-${idx + 1}`),
    label: String(v.label || "").trim(),
    priceDelta: Number(v.priceDelta || 0) || 0,
    sortOrder: Number(v.sortOrder ?? idx) || idx
  }));

  const images = normalizeArrayOfObjects(body.images).map((img, idx) => ({
    id: String(img.id || `img-${idx + 1}`),
    url: String(img.url || "").trim(),
    alt: String(img.alt || "").trim(),
    sortOrder: Number(img.sortOrder ?? idx) || idx,
    isCover: parseBool(img.isCover) || idx === 0
  }));

  const stoneIds = Array.from(
    new Set(
      parseJsonField(body.stoneIds, [])
        .map((x) => Number(x))
        .filter(Number.isFinite)
    )
  );

  const payload = {
    name: String(body.name || "").trim(),
    slug: slugify(body.slug || body.name || ""),
    type: String(body.type || "").trim(),
    collectionId: body.collectionId ? Number(body.collectionId) : null,
    price: Number(body.price || 0),
    status: String(body.status || "draft").trim(),
    leadTime: String(body.leadTime || "").trim(),
    metal: String(body.metal || "").trim(),
    dimensions: typeof body.dimensions === "string" ? body.dimensions : JSON.stringify(body.dimensions || {}),
    weight: String(body.weight || "").trim(),
    description: String(body.description || "").trim(),
    stoneStory: String(body.stoneStory || "").trim(),
    care: String(body.care || "").trim(),
    color: String(body.color || "").trim(),
    occasion: parseJsonField(body.occasion, []).map((x) => String(x)),
    badges: parseJsonField(body.badges, []).map((x) => String(x)),
    seoMetaTitle: String(body.seoMetaTitle || "").trim(),
    seoMetaDescription: String(body.seoMetaDescription || "").trim(),
    seoOgImage: String(body.seoOgImage || "").trim(),
    position: Number(body.position || 0),
    deletedAt: null,
    variations,
    images,
    stoneIds
  };

  if (!["draft", "published", "archived"].includes(payload.status)) payload.status = "draft";
  if (!Number.isFinite(payload.price) || payload.price < 0) payload.price = 0;
  if (!Number.isFinite(payload.position)) payload.position = 0;
  if (payload.collectionId != null && !Number.isFinite(payload.collectionId)) payload.collectionId = null;
  return payload;
}

function validateProductPayload(payload) {
  if (!payload.name) return "Название обязательно";
  if (!payload.slug) return "Slug обязателен";
  if (!payload.type) return "Тип изделия обязателен";
  if (!payload.description) return "Описание обязательно";
  const hasImageUrl = Array.isArray(payload.images) && payload.images.some((img) => String(img?.url || "").trim());
  if (!hasImageUrl) return "Нужна минимум 1 картинка";
  return null;
}

function adminError(res, status, message, details) {
  return res.status(status).json({ error: { message, details: details || null } });
}

function buildCsrfToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function auditLog(pool, actor, action, entityType, entityId, diff) {
  await pool.query(
    `INSERT INTO audit_log (actor_user_id, actor_email, actor_role, action, entity_type, entity_id, diff_json, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())`,
    [
      actor?.id || null,
      actor?.email || null,
      actor?.role || null,
      action,
      entityType,
      entityId ? String(entityId) : null,
      JSON.stringify(diff || {})
    ]
  );
}

async function runCmsMigrations(pool, options = {}) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrations = [
    {
      version: "cms_001",
      sql: `
        CREATE TABLE IF NOT EXISTS admin_users (
          id BIGSERIAL PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('admin','editor','moderator')),
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS cms_collections (
          id BIGSERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          concept TEXT DEFAULT '',
          inspiration TEXT DEFAULT '',
          palette_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          key_stones_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          hero_image_url TEXT DEFAULT '',
          mood_image_url TEXT DEFAULT '',
          seo_meta_title TEXT DEFAULT '',
          seo_meta_description TEXT DEFAULT '',
          seo_og_image TEXT DEFAULT '',
          position INTEGER NOT NULL DEFAULT 0,
          deleted_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS cms_stones (
          id BIGSERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          description TEXT DEFAULT '',
          symbolism TEXT DEFAULT '',
          shades_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          origin TEXT DEFAULT '',
          how_to_wear TEXT DEFAULT '',
          care TEXT DEFAULT '',
          texture_images_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          seo_meta_title TEXT DEFAULT '',
          seo_meta_description TEXT DEFAULT '',
          seo_og_image TEXT DEFAULT '',
          position INTEGER NOT NULL DEFAULT 0,
          deleted_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS cms_products (
          id BIGSERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL,
          collection_id BIGINT NULL REFERENCES cms_collections(id) ON DELETE SET NULL,
          price INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
          lead_time TEXT DEFAULT '',
          metal TEXT DEFAULT '',
          dimensions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          weight TEXT DEFAULT '',
          description TEXT DEFAULT '',
          stone_story TEXT DEFAULT '',
          care TEXT DEFAULT '',
          color TEXT DEFAULT '',
          occasion_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          badges_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          seo_meta_title TEXT DEFAULT '',
          seo_meta_description TEXT DEFAULT '',
          seo_og_image TEXT DEFAULT '',
          position INTEGER NOT NULL DEFAULT 0,
          deleted_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS cms_product_stones (
          product_id BIGINT NOT NULL REFERENCES cms_products(id) ON DELETE CASCADE,
          stone_id BIGINT NOT NULL REFERENCES cms_stones(id) ON DELETE CASCADE,
          position INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (product_id, stone_id)
        );

        CREATE TABLE IF NOT EXISTS cms_product_variations (
          id BIGSERIAL PRIMARY KEY,
          product_id BIGINT NOT NULL REFERENCES cms_products(id) ON DELETE CASCADE,
          variation_key TEXT NOT NULL,
          label TEXT NOT NULL,
          price_delta INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS cms_product_images (
          id BIGSERIAL PRIMARY KEY,
          product_id BIGINT NOT NULL REFERENCES cms_products(id) ON DELETE CASCADE,
          media_id BIGINT NULL,
          url TEXT NOT NULL,
          alt TEXT DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          is_cover BOOLEAN NOT NULL DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS cms_reviews (
          id BIGSERIAL PRIMARY KEY,
          product_id BIGINT NULL REFERENCES cms_products(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          city TEXT DEFAULT '',
          text TEXT NOT NULL,
          photo_url TEXT DEFAULT '',
          occasion TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
          source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('site','instagram','telegram','manual')),
          review_date DATE NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS cms_pages (
          id BIGSERIAL PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          content_markdown TEXT NOT NULL DEFAULT '',
          seo_meta_title TEXT DEFAULT '',
          seo_meta_description TEXT DEFAULT '',
          seo_og_image TEXT DEFAULT '',
          updated_by_user_id BIGINT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS cms_settings (
          key TEXT PRIMARY KEY,
          value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_by_user_id BIGINT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS cms_media (
          id BIGSERIAL PRIMARY KEY,
          file_name TEXT NOT NULL,
          original_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          storage_disk TEXT NOT NULL DEFAULT 'local',
          file_path TEXT NOT NULL,
          public_url TEXT NOT NULL,
          preview_url TEXT NOT NULL,
          width INTEGER NULL,
          height INTEGER NULL,
          size_bytes BIGINT NOT NULL DEFAULT 0,
          meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by_user_id BIGINT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS audit_log (
          id BIGSERIAL PRIMARY KEY,
          actor_user_id BIGINT NULL REFERENCES admin_users(id) ON DELETE SET NULL,
          actor_email TEXT NULL,
          actor_role TEXT NULL,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NULL,
          diff_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_cms_products_slug ON cms_products(slug);
        CREATE INDEX IF NOT EXISTS idx_cms_products_status ON cms_products(status);
        CREATE INDEX IF NOT EXISTS idx_cms_products_created_at ON cms_products(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_cms_stones_slug ON cms_stones(slug);
        CREATE INDEX IF NOT EXISTS idx_cms_collections_slug ON cms_collections(slug);
        CREATE INDEX IF NOT EXISTS idx_cms_reviews_status ON cms_reviews(status);
        CREATE INDEX IF NOT EXISTS idx_cms_reviews_created_at ON cms_reviews(created_at DESC);
      `
    }
  ];

  for (const migration of migrations) {
    const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [migration.version]);
    if (exists.rowCount) continue;
    await pool.query("BEGIN");
    try {
      await pool.query(migration.sql);
      await pool.query("INSERT INTO schema_migrations(version) VALUES ($1)", [migration.version]);
      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  }

  const seedEmail = options.adminEmail || process.env.ADMIN_EMAIL;
  const seedPassword = options.adminPassword || process.env.ADMIN_PASSWORD;
  if (seedEmail && seedPassword) {
    const existing = await pool.query("SELECT id FROM admin_users WHERE email = $1", [seedEmail]);
    if (!existing.rowCount) {
      await pool.query(
        `INSERT INTO admin_users (email, password_hash, role)
         VALUES ($1, $2, 'admin')`,
        [seedEmail, hashPassword(seedPassword)]
      );
    }
  }

  const defaults = [
    "delivery",
    "returns",
    "warranty",
    "custom-order",
    "naturalness-certificate"
  ];
  for (const slug of defaults) {
    await pool.query(
      `INSERT INTO cms_pages (slug, title, content_markdown)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO NOTHING`,
      [slug, slug.replace(/-/g, " "), `# ${slug}\n\nРедактируйте эту страницу в админке.`]
    );
  }

  await pool.query(
    `INSERT INTO cms_settings (key, value_json)
     VALUES ('site', $1::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [
      JSON.stringify({
        brandName: "Stone Atelier",
        contacts: { email: "atelier@example.com", telegram: "@stoneatelier" },
        socials: {},
        seoDefaults: { titleSuffix: " | Stone Atelier", description: "" },
        featureFlags: { reviews: true, encyclopedia: true, collections: true, storytelling: true }
      })
    ]
  );
}

function buildAuthRateLimiter() {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${req.ip || "ip"}:${req.body?.email || "unknown"}`;
    const now = Date.now();
    const item = hits.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
    if (now > item.resetAt) {
      item.count = 0;
      item.resetAt = now + 15 * 60 * 1000;
    }
    item.count += 1;
    hits.set(key, item);
    if (item.count > 20) {
      return adminError(res, 429, "Слишком много попыток входа. Попробуйте позже.");
    }
    return next();
  };
}

function createMediaUploader(mediaDir) {
  if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, mediaDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".bin";
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  });
  return multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if ((file.mimetype || "").startsWith("image/")) return cb(null, true);
      cb(new Error("Можно загружать только изображения"));
    }
  });
}

module.exports = {
  CMS_SESSION_KEY,
  canRole,
  hashPassword,
  verifyPassword,
  slugify,
  normalizeProductPayload,
  validateProductPayload,
  validateReviewStatusTransition,
  runCmsMigrations,
  buildAuthRateLimiter,
  createMediaUploader,
  buildCsrfToken,
  adminError,
  auditLog,
  safeJson,
  parseBool,
  nowIso
};
