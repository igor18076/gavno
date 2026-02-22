function defaults() {
  return {
    processSteps: [
      { title: "Выбор камней", caption: "Отбираем камни по свету, рисунку и оттенку.", image: "" },
      { title: "Подбор пары", caption: "Сравниваем элементы в паре и в ритме будущего изделия.", image: "" },
      { title: "Сборка", caption: "Ручная сборка с проверкой посадки, длины и баланса.", image: "" },
      { title: "Полировка", caption: "Финишная обработка металла и контроль креплений.", image: "" },
      { title: "Финал", caption: "Упаковка, открытка и подготовка к отправке.", image: "" }
    ],
    packaging: {
      title: "Подарочная упаковка Stone Atelier",
      photo: "",
      description: "Каждое украшение упаковывается в фирменную коробку с карточкой по уходу.",
      giftOption: "Подарочная упаковка по запросу",
      postcard: "Открытка с вашим текстом"
    },
    sizeGuide: {
      bracelet: {
        title: "Браслет: измерение запястья",
        steps: ["Измерьте запястье мягкой лентой.", "Добавьте 1–1.5 см для комфортной посадки."],
        table: [["14–15 см", "S"], ["16–17 см", "M"], ["18–19 см", "L"]]
      },
      necklace: {
        title: "Колье: длина на шее",
        steps: ["Примерьте длину нитью.", "Сверьте с вырезом одежды."],
        table: [["40–42 см", "Короткое"], ["45 см", "Универсальное"], ["50–60 см", "Длинное"]]
      },
      ring: {
        title: "Кольцо: размер",
        steps: ["Измерьте внутренний диаметр кольца.", "Или окружность пальца."],
        table: [["16.0 мм", "16"], ["17.0 мм", "17"], ["18.0 мм", "18"]]
      }
    },
    footerLinks: [
      { href: "/policies/delivery", label: "Доставка" },
      { href: "/policies/returns", label: "Возврат" },
      { href: "/policies/warranty", label: "Гарантия" },
      { href: "/policies/custom-order", label: "Индивидуальный заказ" },
      { href: "/policies/naturalness-certificate", label: "Сертификат натуральности" },
      { href: "/packaging", label: "Упаковка" },
      { href: "/size-guide", label: "Размеры" }
    ]
  };
}

function jsScriptFromContent(content) {
  return `window.StoneAtelierContent = (() => {
  const data = ${JSON.stringify(content)};
  const stones = data.stones || [];
  const collections = data.collections || [];
  const reviews = data.reviews || [];
  const products = data.products || [];
  const helpers = {
    stonesBySlug: Object.fromEntries(stones.map((x) => [x.slug, x])),
    collectionsBySlug: Object.fromEntries(collections.map((x) => [x.slug, x])),
    reviewsById: Object.fromEntries(reviews.map((x) => [x.id, x])),
    productsBySlug: {}
  };
  products.forEach((p) => { helpers.productsBySlug[p.slug] = p; });
  function getProduct(slug){ return helpers.productsBySlug[slug] || null; }
  function getStone(slug){ return helpers.stonesBySlug[slug] || null; }
  function getCollection(slug){ return helpers.collectionsBySlug[slug] || null; }
  function getProductReviews(product){ return (product?.reviewIds || []).map((id)=>helpers.reviewsById[id]).filter(Boolean); }
  function getProductsForStone(stoneSlug){ return products.filter((p)=>(p.stones || []).includes(stoneSlug)); }
  function getProductsForCollection(collectionSlug){ return products.filter((p)=>p.collection === collectionSlug); }
  function getRelatedProducts(product){ return (product?.similar || []).map(getProduct).filter(Boolean); }
  return { ...data, helpers: { ...helpers, getProduct, getStone, getCollection, getProductReviews, getProductsForStone, getProductsForCollection, getRelatedProducts } };
})();`;
}

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function buildFallbackContentFromDbRows(rows) {
  const d = defaults();
  const siteSettings = rows.siteSettings || {};
  const homepage = siteSettings.homepage || {};
  const collections = Array.isArray(rows.collections) ? rows.collections : [];
  const stones = Array.isArray(rows.stones) ? rows.stones : [];
  const stonesById = Object.fromEntries(stones.map((s) => [String(s.id), s]));
  const stonesBySlug = Object.fromEntries(stones.map((s) => [String(s.slug), s]));
  const selectedCollection =
    collections.find((c) => c.slug && c.slug === homepage.heroCollectionSlug) ||
    collections[0] ||
    null;
  const heroCollection = selectedCollection
    ? {
        slug: selectedCollection.slug,
        badge: String(homepage.heroBadge || "Новая коллекция"),
        title: String(homepage.heroTitle || selectedCollection.name || ""),
        description: String(
          homepage.heroDescription ||
            selectedCollection.concept ||
            selectedCollection.inspiration ||
            ""
        ),
        stones: Array.isArray(selectedCollection.keyStones)
          ? selectedCollection.keyStones
              .map((s) => {
                const key = typeof s === "string" || typeof s === "number" ? String(s) : "";
                return stonesBySlug[key]?.name || stonesById[key]?.name || (typeof s === "string" ? s : s?.name || s?.slug || "");
              })
              .filter(Boolean)
          : []
      }
    : null;

  const processSteps = (Array.isArray(rows.storytelling) ? rows.storytelling : d.processSteps).map(
    (step, idx) => {
      const fallback = d.processSteps[idx] || d.processSteps[0] || {};
      return {
        ...fallback,
        ...step,
        image: step?.image || fallback.image || ""
      };
    }
  );

  const packaging = {
    ...d.packaging,
    ...(rows.packaging || {})
  };

  return {
    brandName: siteSettings.brandName || "Stone Atelier",
    products: rows.products,
    stones: rows.stones,
    collections: rows.collections,
    reviews: rows.reviews,
    processSteps,
    packaging,
    sizeGuide: rows.sizeGuide || d.sizeGuide,
    policies: rows.policies,
    footerLinks: rows.footerLinks || d.footerLinks,
    heroCollection
  };
}

async function fetchPublicCmsContent(pool) {
  const [stonesRes, collectionsRes, productsRes, productStonesRes, variationsRes, imagesRes, reviewsRes, pagesRes, settingsRes] = await Promise.all([
    pool.query(`SELECT * FROM cms_stones WHERE deleted_at IS NULL ORDER BY position ASC, id ASC`),
    pool.query(`SELECT * FROM cms_collections WHERE deleted_at IS NULL ORDER BY position ASC, id ASC`),
    pool.query(`SELECT * FROM cms_products WHERE deleted_at IS NULL AND status = 'published' ORDER BY position ASC, id DESC`),
    pool.query(`SELECT ps.product_id, s.slug, s.name, ps.position FROM cms_product_stones ps JOIN cms_stones s ON s.id = ps.stone_id AND s.deleted_at IS NULL ORDER BY ps.position ASC, ps.stone_id ASC`),
    pool.query(`SELECT * FROM cms_product_variations ORDER BY sort_order ASC, id ASC`),
    pool.query(`SELECT * FROM cms_product_images ORDER BY sort_order ASC, id ASC`),
    pool.query(`SELECT r.*, p.slug AS product_slug FROM cms_reviews r LEFT JOIN cms_products p ON p.id = r.product_id WHERE r.status = 'approved' ORDER BY r.created_at DESC`),
    pool.query(`SELECT * FROM cms_pages ORDER BY slug ASC`),
    pool.query(`SELECT key, value_json FROM cms_settings ORDER BY key ASC`)
  ]);

  const settings = Object.fromEntries(settingsRes.rows.map((r) => [r.key, r.value_json || {}]));

  const stonesById = Object.fromEntries(
    stonesRes.rows.map((r) => [
      String(r.id),
      {
        id: r.id,
        slug: r.slug,
        name: r.name,
        textureImages: ensureArray(parseJson(r.texture_images_json, [])),
        description: r.description || "",
        symbolism: r.symbolism || "",
        shades: ensureArray(parseJson(r.shades_json, [])),
        origin: r.origin || "",
        howToWear: r.how_to_wear || "",
        care: r.care || "",
        seoOgImage: r.seo_og_image || ""
      }
    ])
  );

  const collectionsById = Object.fromEntries(
    collectionsRes.rows.map((r) => [
      String(r.id),
      {
        id: r.id,
        slug: r.slug,
        name: r.name,
        concept: r.concept || "",
        inspiration: r.inspiration || "",
        palette: ensureArray(parseJson(r.palette_json, [])),
        keyStones: ensureArray(parseJson(r.key_stones_json, [])),
        coverImage: r.hero_image_url || "",
        moodImage: r.mood_image_url || "",
        seoOgImage: r.seo_og_image || ""
      }
    ])
  );

  const productStoneMap = {};
  for (const row of productStonesRes.rows) {
    const key = String(row.product_id);
    if (!productStoneMap[key]) productStoneMap[key] = [];
    productStoneMap[key].push({ slug: row.slug, name: row.name });
  }

  const variationsMap = {};
  for (const row of variationsRes.rows) {
    const key = String(row.product_id);
    if (!variationsMap[key]) variationsMap[key] = [];
    variationsMap[key].push({
      id: row.variation_key || row.id,
      label: row.label,
      priceDelta: Number(row.price_delta || 0),
      sortOrder: Number(row.sort_order || 0)
    });
  }

  const imagesMap = {};
  for (const row of imagesRes.rows) {
    const key = String(row.product_id);
    if (!imagesMap[key]) imagesMap[key] = [];
    imagesMap[key].push({
      id: row.id,
      url: row.url,
      alt: row.alt || "",
      sortOrder: Number(row.sort_order || 0),
      isCover: Boolean(row.is_cover)
    });
  }
  for (const key of Object.keys(imagesMap)) {
    imagesMap[key].sort((a, b) => (a.sortOrder - b.sortOrder) || (Number(b.isCover) - Number(a.isCover)));
  }

  const reviews = reviewsRes.rows.map((r) => ({
    id: `rv-${r.id}`,
    name: r.name,
    city: r.city || "",
    text: r.text || "",
    photo: r.photo_url || "",
    productSlug: r.product_slug || "",
    occasion: r.occasion || "",
    source: r.source || "manual"
  }));

  const reviewsByProduct = {};
  for (const r of reviews) {
    if (!r.productSlug) continue;
    if (!reviewsByProduct[r.productSlug]) reviewsByProduct[r.productSlug] = [];
    reviewsByProduct[r.productSlug].push(r.id);
  }

  const products = productsRes.rows.map((r) => {
    const productImages = imagesMap[String(r.id)] || [];
    const cover = productImages.find((img) => img.isCover) || productImages[0];
    const collection = collectionsById[String(r.collection_id)] || null;
    const stoneLinks = (productStoneMap[String(r.id)] || []).map((x) => x.slug);
    const badges = ensureArray(parseJson(r.badges_json, []));
    const occasion = ensureArray(parseJson(r.occasion_json, []));
    const dimensions = parseJson(r.dimensions_json, {});
    const status = r.lead_time ? "под заказ" : "в наличии";
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      type: r.type,
      collection: collection?.slug || "",
      price: Number(r.price || 0),
      status,
      leadTime: r.lead_time || "",
      stones: stoneLinks,
      metal: r.metal || "",
      dimensions,
      weight: r.weight || "",
      description: r.description || "",
      stoneStory: r.stone_story || "",
      care: r.care || "",
      variations: variationsMap[String(r.id)] || [],
      images: productImages.map((x) => x.url),
      similar: [],
      reviewIds: reviewsByProduct[r.slug] || [],
      color: r.color || "",
      occasion,
      badges,
      setSuggestions: []
    };
  });

  const productsByCollection = {};
  for (const p of products) {
    if (!p.collection) continue;
    if (!productsByCollection[p.collection]) productsByCollection[p.collection] = [];
    productsByCollection[p.collection].push(p);
  }
  for (const p of products) {
    const same = (productsByCollection[p.collection] || []).filter((x) => x.slug !== p.slug);
    const byStones = products.filter((x) => x.slug !== p.slug && (x.stones || []).some((s) => p.stones.includes(s)));
    const uniq = [];
    const seen = new Set();
    [...same, ...byStones].forEach((x) => {
      if (seen.has(x.slug)) return;
      seen.add(x.slug);
      uniq.push(x.slug);
    });
    p.similar = uniq.slice(0, 4);
    p.setSuggestions = uniq.slice(0, 3);
  }

  const stones = Object.values(stonesById);
  const productsByStoneSlug = {};
  for (const p of products) {
    for (const slug of p.stones || []) {
      if (!productsByStoneSlug[slug]) productsByStoneSlug[slug] = [];
      productsByStoneSlug[slug].push(p);
    }
  }
  for (const stone of stones) {
    const fallbackProduct = (productsByStoneSlug[stone.slug] || [])[0];
    const fallbackImage = fallbackProduct?.images?.[0] || "";
    const rawTextures = ensureArray(stone.textureImages).filter(Boolean);
    if (!rawTextures.length && stone.seoOgImage) rawTextures.push(stone.seoOgImage);
    if (!rawTextures.length && fallbackImage) rawTextures.push(fallbackImage);
    stone.textureImages = rawTextures;
  }
  const collections = Object.values(collectionsById);
  for (const c of collections) {
    if (!c.coverImage) c.coverImage = c.seoOgImage || c.moodImage || "";
    if (!c.moodImage) c.moodImage = c.coverImage || c.seoOgImage || "";
  }
  const policies = pagesRes.rows.map((p) => ({
    slug: p.slug,
    title: p.title,
    body: p.content_markdown || ""
  }));

  const siteSettings = settings.site || {};
  const storytelling = settings.storytelling?.steps || null;
  const packaging = settings.packaging || null;
  const sizeGuide = settings.sizeGuide || null;
  const footerLinks = settings.navigation?.footerLinks || null;

  return buildFallbackContentFromDbRows({
    products,
    stones,
    collections,
    reviews,
    policies,
    siteSettings,
    storytelling,
    packaging,
    sizeGuide,
    footerLinks
  });
}

function registerPublicCmsContentRoute(app, deps) {
  const { pool } = deps;

  app.get("/site-content.js", async (req, res) => {
    try {
      const content = await fetchPublicCmsContent(pool);
      const d = defaults();
      const emptyContent = {
        brandName: "Stone Atelier",
        products: [],
        stones: [],
        collections: [],
        reviews: [],
        processSteps: d.processSteps,
        packaging: d.packaging,
        sizeGuide: d.sizeGuide,
        policies: [],
        footerLinks: d.footerLinks
      };
      res.type("application/javascript; charset=utf-8").send(jsScriptFromContent(content || emptyContent));
    } catch (err) {
      console.error("Failed to build public CMS content:", err.message);
      const d = defaults();
      return res
        .type("application/javascript; charset=utf-8")
        .send(jsScriptFromContent({
          brandName: "Stone Atelier",
          products: [],
          stones: [],
          collections: [],
          reviews: [],
          processSteps: d.processSteps,
          packaging: d.packaging,
          sizeGuide: d.sizeGuide,
          policies: [],
          footerLinks: d.footerLinks
        }));
    }
  });
}

module.exports = {
  registerPublicCmsContentRoute
};
