const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canRole,
  validateReviewStatusTransition,
  normalizeProductPayload
} = require("../server/cms-admin");

test("RBAC: editor cannot delete products but can update", () => {
  assert.equal(canRole("editor", "update", "products"), true);
  assert.equal(canRole("editor", "delete", "products"), false);
});

test("Review moderation transitions are validated", () => {
  assert.equal(validateReviewStatusTransition("pending", "approved"), true);
  assert.equal(validateReviewStatusTransition("approved", "pending"), false);
  assert.equal(validateReviewStatusTransition("rejected", "approved"), true);
});

test("Product payload normalization parses collection and stone relations", () => {
  const payload = normalizeProductPayload({
    name: "Колье Тест",
    type: "колье",
    collectionId: "12",
    price: "5400",
    status: "published",
    stoneIds: JSON.stringify([1, "2", "x"]),
    images: JSON.stringify([{ url: "/uploads/a.jpg", isCover: true }]),
    variations: JSON.stringify([{ id: "v1", label: "45 см", priceDelta: 0 }])
  });

  assert.equal(payload.collectionId, 12);
  assert.deepEqual(payload.stoneIds, [1, 2]);
  assert.equal(payload.images.length, 1);
  assert.equal(payload.variations.length, 1);
  assert.equal(payload.status, "published");
});
