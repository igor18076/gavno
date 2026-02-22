const test = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL = process.env.CMS_TEST_BASE_URL || process.env.BASE_URL;
const ADMIN_EMAIL = process.env.CMS_TEST_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.CMS_TEST_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

function randomEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

class CmsClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.cookie = "";
    this.csrf = "";
  }

  async request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (this.cookie) headers.cookie = this.cookie;
    const method = String(options.method || "GET").toUpperCase();
    if (this.csrf && !["GET", "HEAD"].includes(method)) headers["x-csrf-token"] = this.csrf;
    if (options.body && !(options.body instanceof FormData) && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }
    const res = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = payload?.error?.message || payload?.error || `HTTP ${res.status}`;
      throw new Error(message);
    }
    return payload;
  }

  async login(email, password) {
    const data = await this.request("/api/admin/cms/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    this.csrf = data.csrfToken;
    return data;
  }
}

const shouldRun = Boolean(BASE_URL && ADMIN_EMAIL && ADMIN_PASSWORD);

test("CMS API integration: RBAC + review moderation + product relations", { skip: !shouldRun }, async () => {
  const admin = new CmsClient(BASE_URL);
  await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);

  const editorEmail = randomEmail("editor");
  const editorPassword = "Editor123!pass";
  const moderatorEmail = randomEmail("moderator");
  const moderatorPassword = "Moderator123!pass";

  const editor = await admin.request("/api/admin/cms/users", {
    method: "POST",
    body: JSON.stringify({ email: editorEmail, password: editorPassword, role: "editor" })
  });
  const moderator = await admin.request("/api/admin/cms/users", {
    method: "POST",
    body: JSON.stringify({ email: moderatorEmail, password: moderatorPassword, role: "moderator" })
  });

  const stone = await admin.request("/api/admin/cms/stones", {
    method: "POST",
    body: JSON.stringify({
      name: `Тест Камень ${Date.now()}`,
      slug: `test-stone-${Date.now()}`,
      description: "test",
      symbolism: "test",
      shades: ["черный"],
      textureImages: []
    })
  });

  const collection = await admin.request("/api/admin/cms/collections", {
    method: "POST",
    body: JSON.stringify({
      name: `Тест Коллекция ${Date.now()}`,
      slug: `test-collection-${Date.now()}`,
      concept: "test",
      inspiration: "test",
      palette: ["черный"],
      keyStones: [stone.item.id]
    })
  });

  const product = await admin.request("/api/admin/cms/products", {
    method: "POST",
    body: JSON.stringify({
      name: `Тест Товар ${Date.now()}`,
      slug: `test-product-${Date.now()}`,
      type: "колье",
      collectionId: collection.item.id,
      price: 7777,
      status: "published",
      description: "Интеграционный тест",
      dimensions: { length: "45 см" },
      images: [{ url: "/uploads/cms/fake.jpg", alt: "fake", sortOrder: 0, isCover: true }],
      variations: [{ id: "base", label: "base", priceDelta: 0 }],
      stoneIds: [stone.item.id]
    })
  });

  const fetchedProduct = await admin.request(`/api/admin/cms/products/${product.item.id}`);
  assert.equal(fetchedProduct.item.collectionId, collection.item.id);
  assert.ok(Array.isArray(fetchedProduct.item.stones));
  assert.equal(fetchedProduct.item.stones[0].id, stone.item.id);
  assert.equal(fetchedProduct.item.images.length, 1);

  const review = await admin.request("/api/admin/cms/reviews", {
    method: "POST",
    body: JSON.stringify({
      productId: product.item.id,
      name: "Тестовый клиент",
      text: "Очень красиво",
      status: "pending",
      source: "manual"
    })
  });

  const moderatorClient = new CmsClient(BASE_URL);
  await moderatorClient.login(moderatorEmail, moderatorPassword);
  await moderatorClient.request("/api/admin/cms/reviews/bulk", {
    method: "POST",
    body: JSON.stringify({ ids: [review.item.id], action: "approve" })
  });
  const reviewAfterModeration = await admin.request(`/api/admin/cms/reviews/${review.item.id}`);
  assert.equal(reviewAfterModeration.item.status, "approved");

  const editorClient = new CmsClient(BASE_URL);
  await editorClient.login(editorEmail, editorPassword);
  let editorDeleteDenied = false;
  try {
    await editorClient.request(`/api/admin/cms/products/${product.item.id}`, { method: "DELETE" });
  } catch (err) {
    editorDeleteDenied = /прав/i.test(err.message) || /доступ/i.test(err.message);
  }
  assert.equal(editorDeleteDenied, true);
});
