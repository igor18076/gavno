const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const { Pool } = require("pg");
const { runCmsMigrations } = require("./server/cms-admin");
const { registerCmsRoutes } = require("./server/cms-routes");
const { registerPublicCmsContentRoute } = require("./server/public-cms-content");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me-now";
const SESSION_SECRET = process.env.SESSION_SECRET || "replace-this-session-secret";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@postgres:5432/jewelry_shop";

const legacyDataFile = path.join(__dirname, "data", "products.json");
const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const pool = new Pool({
  connectionString: DATABASE_URL
});

function defaultHeroCollection() {
  return {
    badge: "РќРѕРІР°СЏ РєРѕР»Р»РµРєС†РёСЏ",
    title: "РЎРµРІРµСЂРЅС‹Р№ СЃРІРµС‚",
    description: "РћРїР°Р», Р»СѓРЅРЅС‹Р№ РєР°РјРµРЅСЊ, РєРІР°СЂС† Рё СЃРµСЂРµР±СЂРѕ РІ СЃРїРѕРєРѕР№РЅРѕР№ РїР°Р»РёС‚СЂРµ.",
    stones: ["РћРїР°Р»", "РђРіР°С‚", "РўСѓСЂРјР°Р»РёРЅ", "РљРІР°СЂС†"]
  };
}

function parseBool(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return ["1", "true", "on", "yes"].includes(normalized);
}

function sanitizeProduct(payload) {
  const price = Number(payload.price);
  return {
    name: String(payload.name || "").trim(),
    stone: String(payload.stone || "").trim(),
    price: Number.isFinite(price) ? Math.max(0, Math.round(price)) : NaN,
    imageUrl: String(payload.imageUrl || "").trim(),
    description: String(payload.description || "").trim(),
    inStock: parseBool(payload.inStock),
    featured: parseBool(payload.featured)
  };
}

function validateProduct(product, options = {}) {
  if (!product.name) return "РќР°Р·РІР°РЅРёРµ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ";
  if (!product.stone) return "РџРѕР»Рµ РєР°РјРЅРµР№/РјР°С‚РµСЂРёР°Р»РѕРІ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ";
  if (!Number.isFinite(product.price)) return "Р¦РµРЅР° РґРѕР»Р¶РЅР° Р±С‹С‚СЊ С‡РёСЃР»РѕРј";
  if (!product.description) return "РћРїРёСЃР°РЅРёРµ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ";
  if (options.requireImage && !product.imageUrl) return "РР·РѕР±СЂР°Р¶РµРЅРёРµ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ";
  return null;
}

function sanitizeHeroCollection(payload) {
  let stones = payload.stones;
  if (typeof stones === "string") {
    stones = stones
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(stones)) stones = [];

  return {
    badge: String(payload.badge || "").trim(),
    title: String(payload.title || "").trim(),
    description: String(payload.description || "").trim(),
    stones: stones.map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
  };
}

function validateHeroCollection(hero) {
  if (!hero.badge) return "РўРµРєСЃС‚ Р±РµР№РґР¶Р° РѕР±СЏР·Р°С‚РµР»РµРЅ";
  if (!hero.title) return "РќР°Р·РІР°РЅРёРµ РєРѕР»Р»РµРєС†РёРё РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ";
  if (!hero.description) return "РћРїРёСЃР°РЅРёРµ РєРѕР»Р»РµРєС†РёРё РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ";
  return null;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function mapProductRow(row) {
  return {
    id: row.id,
    name: row.name,
    stone: row.stone,
    price: Number(row.price),
    imageUrl: row.image_url || "",
    description: row.description,
    inStock: Boolean(row.in_stock),
    featured: Boolean(row.featured)
  };
}

async function getHeroCollection() {
  const result = await pool.query("SELECT value FROM site_settings WHERE key = $1", ["heroCollection"]);
  if (!result.rows.length) return defaultHeroCollection();
  return sanitizeHeroCollection(result.rows[0].value || defaultHeroCollection());
}

async function setHeroCollection(heroCollection) {
  await pool.query(
    `INSERT INTO site_settings (key, value)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    ["heroCollection", JSON.stringify(heroCollection)]
  );
}

async function connectDbWithRetry() {
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.log(`Waiting for PostgreSQL (${attempt}/${maxAttempts})...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      stone TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      image_url TEXT,
      description TEXT NOT NULL,
      in_stock BOOLEAN NOT NULL DEFAULT TRUE,
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );
  `);

  await pool.query(
    `INSERT INTO site_settings (key, value)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    ["heroCollection", JSON.stringify(defaultHeroCollection())]
  );
}

async function importLegacyJsonIfNeeded() {
  const countRes = await pool.query("SELECT COUNT(*)::int AS count FROM products");
  const hasProducts = Number(countRes.rows[0]?.count || 0) > 0;
  if (hasProducts) return;
  if (!fs.existsSync(legacyDataFile)) return;

  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyDataFile, "utf-8"));
  } catch (err) {
    console.error("Legacy JSON import skipped:", err.message);
    return;
  }

  if (legacy && legacy.heroCollection) {
    const hero = sanitizeHeroCollection(legacy.heroCollection);
    const heroErr = validateHeroCollection(hero);
    if (!heroErr) {
      await setHeroCollection(hero);
    }
  }

  const items = Array.isArray(legacy?.items) ? legacy.items : [];
  for (const raw of items) {
    const product = sanitizeProduct(raw);
    if (validateProduct(product, { requireImage: false })) continue;
    await pool.query(
      `INSERT INTO products (id, name, stone, price, image_url, description, in_stock, featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [
        Number(raw.id) || undefined,
        product.name,
        product.stone,
        product.price,
        product.imageUrl || null,
        product.description,
        product.inStock,
        product.featured
      ]
    );
  }

  await pool.query(
    `SELECT setval(
      pg_get_serial_sequence('products', 'id'),
      COALESCE((SELECT MAX(id) FROM products), 1),
      true
    )`
  );
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

registerPublicCmsContentRoute(app, {
  pool,
  publicDir: path.join(__dirname, "public")
});

app.use("/uploads", express.static(uploadsDir));
app.use(express.static(path.join(__dirname, "public")));

registerCmsRoutes(app, {
  pool,
  publicDir: path.join(__dirname, "public"),
  uploadsDir
});

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/catalog", (_req, res) => res.sendFile(path.join(__dirname, "public", "catalog.html")));
app.get("/products/:slug", (_req, res) => res.sendFile(path.join(__dirname, "public", "product.html")));
app.get("/stones/:slug", (_req, res) => res.sendFile(path.join(__dirname, "public", "stone.html")));
app.get("/collections/:slug", (_req, res) => res.sendFile(path.join(__dirname, "public", "collection.html")));
app.get("/about", (_req, res) => res.sendFile(path.join(__dirname, "public", "about.html")));
app.get("/size-guide", (_req, res) => res.sendFile(path.join(__dirname, "public", "size-guide.html")));
app.get("/packaging", (_req, res) => res.sendFile(path.join(__dirname, "public", "packaging.html")));
app.get("/policies/:slug", (_req, res) => res.sendFile(path.join(__dirname, "public", "policy.html")));

app.get(
  "/api/products",
  asyncHandler(async (_req, res) => {
    const itemsRes = await pool.query(
      `SELECT id, name, stone, price, image_url, description, in_stock, featured
       FROM products
       ORDER BY featured DESC, id DESC`
    );
    const heroCollection = await getHeroCollection();
    res.json({ items: itemsRes.rows.map(mapProductRow), heroCollection });
  })
);

app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "Р¤Р°Р№Р» СЃР»РёС€РєРѕРј Р±РѕР»СЊС€РѕР№ (РјР°РєСЃ. 8MB)" });
  }
  if (err && err.message) {
    console.error(err);
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: "Р’РЅСѓС‚СЂРµРЅРЅСЏСЏ РѕС€РёР±РєР° СЃРµСЂРІРµСЂР°" });
});

app.use((_req, res) => res.status(404).send("Not found"));

async function start() {
  await connectDbWithRetry();
  await initSchema();
  await importLegacyJsonIfNeeded();
  await runCmsMigrations(pool, {
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD
  });

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start application:", err);
  process.exit(1);
});

