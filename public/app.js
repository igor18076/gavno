function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderHeroCollection(heroCollection) {
  if (!heroCollection || typeof heroCollection !== "object") return;

  const badge = document.getElementById("hero-collection-badge");
  const title = document.getElementById("hero-collection-title");
  const description = document.getElementById("hero-collection-description");
  const stones = document.getElementById("hero-collection-stones");

  if (badge && heroCollection.badge) badge.textContent = heroCollection.badge;
  if (title && heroCollection.title) title.textContent = heroCollection.title;
  if (description && heroCollection.description) description.textContent = heroCollection.description;

  if (stones && Array.isArray(heroCollection.stones) && heroCollection.stones.length) {
    stones.innerHTML = heroCollection.stones.map((stone) => `<span>${escapeHtml(stone)}</span>`).join("");
  }
}

async function loadCatalog() {
  const grid = document.getElementById("catalog-grid");
  if (!grid) return;
  try {
    const res = await fetch("/api/products");
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    renderHeroCollection(data.heroCollection);

    if (!items.length) {
      grid.innerHTML = '<div class="loading-card">Каталог пока пуст. Добавьте товары в админке.</div>';
      return;
    }

    grid.innerHTML = items
      .map((item) => {
        const price = new Intl.NumberFormat("ru-RU").format(item.price || 0);
        const imageStyle = item.imageUrl
          ? `style="background-image:url('${String(item.imageUrl).replace(/'/g, "%27")}')"`
          : "";
        return `
          <article class="product-card ${item.featured ? "featured" : ""}">
            <div class="product-image" ${imageStyle}>
              ${item.featured ? '<span class="badge badge-dark">featured</span>' : ""}
              ${item.inStock ? "" : '<span class="stock-badge out">Нет в наличии</span>'}
            </div>
            <div class="product-body">
              <div class="product-top">
                <p class="product-stone">${escapeHtml(item.stone || "")}</p>
                <p class="product-price">${price} ₽</p>
              </div>
              <h3>${escapeHtml(item.name || "")}</h3>
              <p class="product-desc">${escapeHtml(item.description || "")}</p>
              <button class="btn btn-secondary btn-full" type="button">
                ${item.inStock ? "Запросить заказ" : "Сообщить о поступлении"}
              </button>
            </div>
          </article>`;
      })
      .join("");
  } catch (err) {
    grid.innerHTML = '<div class="loading-card">Не удалось загрузить каталог.</div>';
    console.error(err);
  }
}

loadCatalog();
