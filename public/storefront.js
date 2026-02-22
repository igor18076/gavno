(function () {
  const content = window.StoneAtelierContent;
  if (!content) return;

  const { products, stones, collections, reviews, processSteps, packaging, sizeGuide, policies, footerLinks, helpers, heroCollection } = content;

  const state = {
    filters: {
      type: "",
      stone: "",
      color: "",
      collection: "",
      occasion: "",
      priceMax: ""
    },
    favorites: new Set(loadFavorites())
  };

  function loadFavorites() {
    try {
      return JSON.parse(localStorage.getItem("stoneAtelierFavorites") || "[]");
    } catch {
      return [];
    }
  }

  function saveFavorites() {
    localStorage.setItem("stoneAtelierFavorites", JSON.stringify([...state.favorites]));
  }

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function rub(value) {
    return `${new Intl.NumberFormat("ru-RU").format(Number(value || 0))} ₽`;
  }

  function firstNonEmpty(...values) {
    for (const value of values) {
      if (String(value || "").trim()) return String(value);
    }
    return "";
  }

  function bgStyle(url, fallbackGradient) {
    const image = firstNonEmpty(url);
    if (image) return `background-image:url('${esc(image)}')`;
    return `background-image:${fallbackGradient || "linear-gradient(135deg, rgba(201,171,110,.2), rgba(86,129,142,.22))"}`;
  }

  function productCard(product, options = {}) {
    const collection = helpers.getCollection(product.collection);
    const stoneNames = (product.stones || []).map((s) => helpers.getStone(s)?.name).filter(Boolean).join(", ");
    const isFav = state.favorites.has(product.slug);
    const badges = [...(product.badges || [])].map((b) => `<span class="badge badge-dark">${esc(b)}</span>`).join("");
    return `
      <article class="product-card ${product.badges?.length ? "featured" : ""}" data-product-slug="${esc(product.slug)}">
        <div class="product-image" style="background-image:url('${esc(product.images?.[0] || "")}')">
          <div class="card-top-actions">
            <div class="badge-row">${badges}</div>
            <button class="icon-btn fav-toggle ${isFav ? "active" : ""}" type="button" data-action="favorite" data-slug="${esc(product.slug)}" aria-label="Избранное">♥</button>
          </div>
          <div class="stock-badge ${product.status !== "в наличии" ? "out" : ""}">${esc(product.status)}</div>
        </div>
        <div class="product-body">
          <div class="product-top">
            <p class="product-stone">${esc(stoneNames)}</p>
            <p class="product-price">${rub(product.price)}</p>
          </div>
          <h3><a class="product-link" href="/products/${esc(product.slug)}">${esc(product.name)}</a></h3>
          <p class="product-desc">${esc(product.description)}</p>
          <div class="meta-row">
            <span>${esc(product.type)}</span>
            <span>•</span>
            <a href="/collections/${esc(product.collection)}">${esc(collection?.name || "")}</a>
          </div>
          <div class="card-actions">
            <a class="btn btn-secondary" href="/products/${esc(product.slug)}">Подробнее</a>
            ${options.quickView !== false ? `<button class="btn btn-secondary" type="button" data-action="quick-view" data-slug="${esc(product.slug)}">Быстрый просмотр</button>` : ""}
          </div>
        </div>
      </article>
    `;
  }

  function relatedCards(list) {
    return `<div class="catalog-grid compact-grid">${list.map((p) => productCard(p, { quickView: false })).join("")}</div>`;
  }

  function collectionCard(collection) {
    const list = helpers.getProductsForCollection(collection.slug);
    const cover = firstNonEmpty(collection.coverImage, collection.moodImage, collection.seoOgImage, list[0]?.images?.[0]);
    return `
      <article class="collection-card">
        <a class="collection-card-media" href="/collections/${esc(collection.slug)}" style="${bgStyle(cover)}"></a>
        <div class="collection-card-body">
          <p class="eyebrow">Коллекция</p>
          <h3><a class="product-link" href="/collections/${esc(collection.slug)}">${esc(collection.name)}</a></h3>
          <p>${esc(collection.concept || collection.inspiration || "")}</p>
          <div class="stone-list">${(collection.keyStones || []).slice(0, 4).map((s) => `<span>${esc(helpers.getStone(s)?.name || s)}</span>`).join("")}</div>
          <div class="meta-row">
            <span>${esc(list.length)} изделий</span>
            <span>•</span>
            <a href="/collections/${esc(collection.slug)}">Открыть коллекцию</a>
          </div>
        </div>
      </article>
    `;
  }

  function reviewCard(review) {
    const product = helpers.getProduct(review.productSlug);
    return `
      <article class="review-card">
        <div class="review-head">
          <img src="${esc(review.photo)}" alt="${esc(review.name)}" />
          <div>
            <h4>${esc(review.name)}</h4>
            <p>${esc(review.city)} • ${esc(review.occasion)}</p>
          </div>
        </div>
        <p class="review-text">${esc(review.text)}</p>
        ${product ? `<a class="review-link" href="/products/${esc(product.slug)}">${esc(product.name)}</a>` : ""}
      </article>
    `;
  }

  function getFilterOptions() {
    return {
      types: [...new Set(products.map((p) => p.type))],
      stones: stones.map((s) => s.slug),
      colors: [...new Set(products.map((p) => p.color))],
      collections: collections.map((c) => c.slug),
      occasions: [...new Set(products.flatMap((p) => p.occasion || []))]
    };
  }

  function applyFilters(list) {
    return list.filter((p) => {
      if (state.filters.type && p.type !== state.filters.type) return false;
      if (state.filters.stone && !(p.stones || []).includes(state.filters.stone)) return false;
      if (state.filters.color && p.color !== state.filters.color) return false;
      if (state.filters.collection && p.collection !== state.filters.collection) return false;
      if (state.filters.occasion && !(p.occasion || []).includes(state.filters.occasion)) return false;
      if (state.filters.priceMax && p.price > Number(state.filters.priceMax)) return false;
      return true;
    });
  }

  function renderFilters() {
    const wrap = document.getElementById("catalog-filters");
    if (!wrap) return;
    const opts = getFilterOptions();
    wrap.innerHTML = `
      <div class="filter-row">
        <div class="chip-group" data-filter-key="type">
          ${opts.types.map((x) => `<button class="chip ${state.filters.type === x ? "active" : ""}" type="button" data-chip="type" data-value="${esc(x)}">${esc(x)}</button>`).join("")}
        </div>
        <select data-select="stone">
          <option value="">Камень</option>
          ${opts.stones.map((slug) => `<option value="${esc(slug)}" ${state.filters.stone === slug ? "selected" : ""}>${esc(helpers.getStone(slug)?.name || slug)}</option>`).join("")}
        </select>
        <select data-select="collection">
          <option value="">Коллекция</option>
          ${opts.collections.map((slug) => `<option value="${esc(slug)}" ${state.filters.collection === slug ? "selected" : ""}>${esc(helpers.getCollection(slug)?.name || slug)}</option>`).join("")}
        </select>
        <select data-select="color">
          <option value="">Цвет</option>
          ${opts.colors.map((x) => `<option value="${esc(x)}" ${state.filters.color === x ? "selected" : ""}>${esc(x)}</option>`).join("")}
        </select>
        <select data-select="occasion">
          <option value="">Повод</option>
          ${opts.occasions.map((x) => `<option value="${esc(x)}" ${state.filters.occasion === x ? "selected" : ""}>${esc(x)}</option>`).join("")}
        </select>
        <label class="price-filter">
          <span>До</span>
          <input type="number" min="0" step="100" value="${esc(state.filters.priceMax)}" data-input="priceMax" placeholder="₽" />
        </label>
        <button id="reset-filters" class="btn btn-secondary" type="button">Сбросить</button>
      </div>
    `;
  }

  function renderActiveFilters() {
    const wrap = document.getElementById("active-filters");
    if (!wrap) return;
    const pairs = [];
    Object.entries(state.filters).forEach(([key, value]) => {
      if (!value) return;
      let label = value;
      if (key === "stone") label = helpers.getStone(value)?.name || value;
      if (key === "collection") label = helpers.getCollection(value)?.name || value;
      if (key === "priceMax") label = `до ${rub(value)}`;
      pairs.push({ key, label });
    });
    wrap.innerHTML = pairs.length
      ? `<div class="active-filter-list">${pairs
          .map((f) => `<button class="chip active" type="button" data-remove-filter="${esc(f.key)}">${esc(f.label)} ×</button>`)
          .join("")}</div>`
      : "";
  }

  function renderCatalog(targetCount) {
    const grid = document.getElementById("catalog-grid");
    if (!grid) return;
    const filtered = applyFilters(products);
    const list = typeof targetCount === "number" ? filtered.slice(0, targetCount) : filtered;
    if (!products.length) {
      grid.innerHTML = '<div class="loading-card">Каталог заполняется. Добавьте опубликованные товары в CMS (/admin).</div>';
      return;
    }
    grid.innerHTML = list.length
      ? list.map((p) => productCard(p)).join("")
      : '<div class="loading-card">По выбранным фильтрам ничего не найдено. Попробуйте сбросить фильтры.</div>';
  }

  function attachCatalogInteractions() {
    document.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-chip]");
      if (chip) {
        const key = chip.dataset.chip;
        const value = chip.dataset.value;
        state.filters[key] = state.filters[key] === value ? "" : value;
        rerenderCatalog();
        return;
      }

      const removeBtn = e.target.closest("[data-remove-filter]");
      if (removeBtn) {
        state.filters[removeBtn.dataset.removeFilter] = "";
        rerenderCatalog();
        return;
      }

      const reset = e.target.closest("#reset-filters");
      if (reset) {
        Object.keys(state.filters).forEach((k) => (state.filters[k] = ""));
        rerenderCatalog();
        return;
      }

      const quick = e.target.closest("[data-action='quick-view']");
      if (quick) {
        openQuickView(quick.dataset.slug);
        return;
      }

      const fav = e.target.closest("[data-action='favorite']");
      if (fav) {
        const slug = fav.dataset.slug;
        if (state.favorites.has(slug)) state.favorites.delete(slug);
        else state.favorites.add(slug);
        saveFavorites();
        rerenderCatalog(false);
        return;
      }

      if (e.target.closest("[data-close-quick-view]")) {
        closeQuickView();
      }
    });

    document.addEventListener("change", (e) => {
      const select = e.target.closest("[data-select]");
      if (select) {
        state.filters[select.dataset.select] = select.value;
        rerenderCatalog();
        return;
      }
      const input = e.target.closest("[data-input='priceMax']");
      if (input) {
        state.filters.priceMax = input.value;
        rerenderCatalog();
      }
    });
  }

  function rerenderCatalog(scroll = false) {
    renderFilters();
    renderActiveFilters();
    const page = document.body.dataset.page;
    renderCatalog(page === "home" ? 6 : undefined);
    if (scroll) document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openQuickView(slug) {
    const modal = document.getElementById("quick-view-modal");
    const product = helpers.getProduct(slug);
    if (!modal || !product) return;
    const stonesLinks = product.stones
      .map((s) => `<a class="stone-link-chip" href="/stones/${esc(s)}">${esc(helpers.getStone(s)?.name || s)}</a>`)
      .join("");
    modal.innerHTML = `
      <div class="quick-view-backdrop" data-close-quick-view></div>
      <div class="quick-view-panel" role="dialog" aria-modal="true">
        <button class="icon-btn quick-close" type="button" data-close-quick-view>×</button>
        <div class="quick-view-grid">
          <img src="${esc(product.images[0])}" alt="${esc(product.name)}" />
          <div>
            <p class="eyebrow">${esc(product.type)} • ${esc(helpers.getCollection(product.collection)?.name || "")}</p>
            <h2>${esc(product.name)}</h2>
            <p class="product-price large">${rub(product.price)}</p>
            <p class="small-muted">${esc(product.description)}</p>
            <div class="quick-view-stones">
              <p class="small-muted">Камни</p>
              <div class="stone-link-grid">${stonesLinks}</div>
            </div>
            <div class="form-actions">
              <a class="btn btn-primary" href="/products/${esc(product.slug)}">Открыть карточку</a>
              <button class="btn btn-secondary" type="button" data-close-quick-view">Закрыть</button>
            </div>
          </div>
        </div>
      </div>
    `;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeQuickView() {
    const modal = document.getElementById("quick-view-modal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = "";
    document.body.classList.remove("modal-open");
  }

  function renderHomeExtras() {
    renderHeroCollectionFromContent();

    const collectionsGrid = document.getElementById("collections-grid");
    if (collectionsGrid) {
      collectionsGrid.innerHTML = collections.length
        ? collections.map(collectionCard).join("")
        : '<div class="loading-card">Коллекции появятся после наполнения CMS.</div>';
    }

    const processGrid = document.getElementById("process-grid");
    if (processGrid) {
      processGrid.innerHTML = processSteps
        .map(
          (step) => `
        <article class="process-card">
          <div class="process-image" style="${bgStyle(step.image, "linear-gradient(135deg, rgba(214,182,123,.18), rgba(120,144,156,.16))")}"></div>
          <div class="process-body">
            <h3>${esc(step.title)}</h3>
            <p>${esc(step.caption)}</p>
          </div>
        </article>`
        )
        .join("");
    }

    const stonesGrid = document.getElementById("stones-grid");
    if (stonesGrid) {
      stonesGrid.innerHTML = stones
        .map(
          (stone) => `
        <article class="stone-card">
          <div class="stone-texture" style="${bgStyle(firstNonEmpty(stone.textureImages?.[0], stone.seoOgImage), "linear-gradient(135deg, rgba(106,120,126,.24), rgba(205,193,171,.24))")}"></div>
          <div class="stone-card-body">
            <h3><a class="product-link" href="/stones/${esc(stone.slug)}">${esc(stone.name)}</a></h3>
            <p>${esc(stone.description)}</p>
            <p class="small-muted">Оттенки: ${esc((stone.shades || []).join(", "))}</p>
          </div>
        </article>`
        )
        .join("");
    }

    const reviewsStrip = document.getElementById("reviews-strip");
    if (reviewsStrip) {
      reviewsStrip.innerHTML = reviews.map(reviewCard).join("");
    }

    const assistLinks = document.getElementById("assist-links");
    if (assistLinks) {
      assistLinks.innerHTML = `
        <a href="/size-guide">Как определить размер</a>
        <a href="/packaging">Упаковка и подарок</a>
        <a href="/policies/custom-order">Индивидуальный заказ</a>
        <a href="/policies/delivery">Доставка</a>
      `;
    }

    renderFooterLinks();
  }

  function renderHeroCollectionFromContent() {
    const fallbackCollection = collections[0] || null;
    const selectedCollection = (heroCollection?.slug && helpers.getCollection(heroCollection.slug)) || fallbackCollection;
    const heroTitle = firstNonEmpty(heroCollection?.title, selectedCollection?.name);
    const heroDescription = firstNonEmpty(heroCollection?.description, selectedCollection?.concept, selectedCollection?.inspiration);
    const heroStones = Array.isArray(heroCollection?.stones) && heroCollection.stones.length
      ? heroCollection.stones
      : (selectedCollection?.keyStones || []).map((x) => helpers.getStone(x)?.name || x).filter(Boolean);

    const badge = document.getElementById("hero-collection-badge");
    const title = document.getElementById("hero-collection-title");
    const desc = document.getElementById("hero-collection-description");
    const stonesWrap = document.getElementById("hero-collection-stones");
    const link = document.getElementById("hero-collection-link");
    if (badge) badge.textContent = heroCollection?.badge || "Новая коллекция";
    if (title && heroTitle) title.textContent = heroTitle;
    if (desc && heroDescription) desc.textContent = heroDescription;
    if (stonesWrap && heroStones.length) stonesWrap.innerHTML = heroStones.map((x) => `<span>${esc(x)}</span>`).join("");
    if (link && selectedCollection?.slug) link.href = `/collections/${selectedCollection.slug}`;
  }

  function renderFooterLinks() {
    const wrap = document.getElementById("footer-links");
    if (!wrap) return;
    wrap.innerHTML = footerLinks.map((x) => `<a href="${esc(x.href)}">${esc(x.label)}</a>`).join("");
  }

  function renderProductPage() {
    const root = document.getElementById("page-root");
    if (!root) return;
    const slug = location.pathname.split("/").pop();
    const product = helpers.getProduct(slug);
    if (!product) {
      root.innerHTML = '<div class="section"><div class="loading-card">Товар не найден.</div></div>';
      return;
    }
    const collection = helpers.getCollection(product.collection);
    const productReviews = helpers.getProductReviews(product);
    const related = helpers.getRelatedProducts(product);
    const [main, ...thumbs] = product.images;
    root.innerHTML = `
      <nav class="topbar topbar-rich page-topbar">
        <a class="brand-link" href="/"><div class="brand">Stone Atelier</div></a>
        <div class="topbar-links"><a class="ghost-link" href="/catalog">Каталог</a><a class="ghost-link" href="/size-guide">Размеры</a></div>
      </nav>
      <section class="section product-page">
        <div class="product-gallery">
          <div class="product-main-image-wrap">
            <img id="product-main-image" class="product-main-image" src="${esc(main)}" alt="${esc(product.name)}" />
            <button type="button" class="icon-btn zoom-btn" data-zoom-image="${esc(main)}">⤢</button>
          </div>
          <div class="product-thumbs">
            ${product.images.map((img, i) => `<button type="button" class="thumb-btn ${i === 0 ? "active" : ""}" data-thumb="${esc(img)}"><img src="${esc(img)}" alt="" /></button>`).join("")}
          </div>
        </div>
        <div class="product-summary panel">
          <p class="eyebrow">${esc(product.type)} • <a href="/collections/${esc(product.collection)}">${esc(collection?.name || "")}</a></p>
          <h1>${esc(product.name)}</h1>
          <div class="summary-price-row">
            <p class="product-price large">${rub(product.price)}</p>
            <span class="stock-badge ${product.status !== "в наличии" ? "out" : ""}">${esc(product.status)}</span>
          </div>
          <p class="small-muted">Срок изготовления: ${esc(product.leadTime)}</p>
          <div class="variation-block">
            <label for="variation-select">Вариации</label>
            <select id="variation-select">
              ${product.variations.map((v) => `<option value="${esc(v.id)}">${esc(v.label)}${v.priceDelta ? ` (+${rub(v.priceDelta)})` : ""}</option>`).join("")}
            </select>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="button">Заказать</button>
            <button class="btn btn-secondary" type="button">Запросить</button>
          </div>
          <div class="spec-list">
            <div><span>Металл</span><strong>${esc(product.metal)}</strong></div>
            <div><span>Размеры</span><strong>${esc(product.dimensions.length)} • ${esc(product.dimensions.diameter)}</strong></div>
            <div><span>Регулируемость</span><strong>${esc(product.dimensions.adjustable)}</strong></div>
            <div><span>Вес</span><strong>${esc(product.weight)}</strong></div>
          </div>
          <div class="size-links">
            <a href="/size-guide">Как определить размер</a>
            <a href="/packaging">Упаковка и подарок</a>
            <a href="/policies/delivery">Доставка</a>
          </div>
        </div>
      </section>

      <section class="section two-col-content">
        <article class="panel info-block"><h2>Описание</h2><p>${esc(product.description)}</p></article>
        <article class="panel info-block"><h2>История камня</h2><p>${esc(product.stoneStory)}</p></article>
        <article class="panel info-block"><h2>Камни в изделии</h2><div class="stone-link-grid">${product.stones.map((slug) => `<a class="stone-link-chip" href="/stones/${esc(slug)}">${esc(helpers.getStone(slug)?.name || slug)}</a>`).join("")}</div></article>
        <article class="panel info-block"><h2>Уход</h2><p>${esc(product.care)}</p></article>
      </section>

      <section class="section">
        <div class="section-head"><div><p class="eyebrow">Упаковка и доставка</p><h2>Срок изготовления, доставка и подарок</h2></div></div>
        <div class="split">
          <div class="split-card">
            <p>${esc(packaging.description)}</p>
            <p><strong>Подарочная опция:</strong> ${esc(packaging.giftOption)}</p>
            <p><strong>Открытка:</strong> ${esc(packaging.postcard)}</p>
            <div class="link-list">
              <a href="/packaging">Подробнее об упаковке</a>
              <a href="/policies/delivery">Условия доставки</a>
              <a href="/policies/returns">Возврат</a>
            </div>
          </div>
          <div class="split-card accent"><div class="wide-photo" style="background-image:url('${esc(packaging.photo)}')"></div></div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><div><p class="eyebrow">Похожие изделия</p><h2>Продолжить подбор</h2></div></div>
        ${relatedCards(related)}
      </section>

      <section class="section">
        <div class="section-head"><div><p class="eyebrow">Отзывы</p><h2>Отзывы по изделию</h2></div></div>
        <div class="reviews-strip">${(productReviews.length ? productReviews : reviews.slice(0, 2)).map(reviewCard).join("")}</div>
      </section>

      <section class="section">
        <div class="section-head"><div><p class="eyebrow">Подобрать комплект</p><h2>Сочетания к этому изделию</h2></div></div>
        ${relatedCards((product.setSuggestions || []).map((s) => helpers.getProduct(s)).filter(Boolean))}
      </section>

      <div id="image-zoom" class="quick-view-modal hidden" aria-hidden="true"></div>
    `;
    attachProductPageInteractions();
  }

  function attachProductPageInteractions() {
    document.querySelectorAll("[data-thumb]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const src = btn.dataset.thumb;
        const main = document.getElementById("product-main-image");
        if (main) main.src = src;
        document.querySelectorAll("[data-thumb]").forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
        const zoom = document.querySelector(".zoom-btn");
        if (zoom) zoom.dataset.zoomImage = src;
      });
    });
    document.querySelector(".zoom-btn")?.addEventListener("click", (e) => {
      const zoom = document.getElementById("image-zoom");
      if (!zoom) return;
      zoom.innerHTML = `<div class="quick-view-backdrop" data-close-zoom></div><div class="zoom-panel"><button class="icon-btn quick-close" data-close-zoom>×</button><img src="${esc(e.currentTarget.dataset.zoomImage)}" alt="" /></div>`;
      zoom.classList.remove("hidden");
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-close-zoom]")) document.getElementById("image-zoom")?.classList.add("hidden");
    });
  }

  function renderStonePage() {
    const root = document.getElementById("page-root");
    const slug = location.pathname.split("/").pop();
    const stone = helpers.getStone(slug);
    if (!root) return;
    if (!stone) {
      root.innerHTML = '<div class="section"><div class="loading-card">Камень не найден.</div></div>';
      return;
    }
    const linkedProducts = helpers.getProductsForStone(stone.slug);
    root.innerHTML = `
      <nav class="topbar topbar-rich page-topbar"><a class="brand-link" href="/"><div class="brand">Stone Atelier</div></a><div class="topbar-links"><a class="ghost-link" href="/catalog">Каталог</a></div></nav>
      <section class="section">
        <div class="section-head"><div><p class="eyebrow">Энциклопедия камней</p><h1 class="page-title">${esc(stone.name)}</h1></div><a class="ghost-link" href="/catalog">К каталогу</a></div>
        <div class="stone-page-grid">
          <div class="stone-gallery">${stone.textureImages.map((img) => `<div class="wide-photo" style="background-image:url('${esc(img)}')"></div>`).join("")}</div>
          <div class="panel info-stack">
            <p>${esc(stone.description)}</p>
            <div class="spec-list">
              <div><span>Символика</span><strong>${esc(stone.symbolism)}</strong></div>
              <div><span>Оттенки</span><strong>${esc(stone.shades.join(", "))}</strong></div>
              <div><span>Происхождение</span><strong>${esc(stone.origin)}</strong></div>
            </div>
            <h3>Как носить</h3><p>${esc(stone.howToWear)}</p>
            <h3>Уход</h3><p>${esc(stone.care)}</p>
          </div>
        </div>
      </section>
      <section class="section"><div class="section-head"><div><p class="eyebrow">Украшения с этим камнем</p><h2>Автосписок изделий</h2></div></div>${relatedCards(linkedProducts)}</section>
    `;
  }

  function renderCollectionPage() {
    const root = document.getElementById("page-root");
    const slug = location.pathname.split("/").pop();
    const collection = helpers.getCollection(slug);
    if (!root) return;
    if (!collection) {
      root.innerHTML = '<div class="section"><div class="loading-card">Коллекция не найдена.</div></div>';
      return;
    }
    const list = helpers.getProductsForCollection(collection.slug);
    root.innerHTML = `
      <nav class="topbar topbar-rich page-topbar"><a class="brand-link" href="/"><div class="brand">Stone Atelier</div></a><div class="topbar-links"><a class="ghost-link" href="/catalog">Каталог</a></div></nav>
      <section class="section">
        <div class="collection-hero panel">
            <div class="collection-hero-media" style="${bgStyle(firstNonEmpty(collection.coverImage, collection.moodImage, collection.seoOgImage))}"></div>
          <div class="collection-hero-copy">
            <p class="eyebrow">Коллекция</p>
            <h1 class="page-title">${esc(collection.name)}</h1>
            <p>${esc(collection.concept)}</p>
            <p class="small-muted">${esc(collection.inspiration)}</p>
            <div class="stone-list">${collection.palette.map((x) => `<span>${esc(x)}</span>`).join("")}</div>
            <div class="stone-link-grid">${collection.keyStones.map((s) => `<a class="stone-link-chip" href="/stones/${esc(s)}">${esc(helpers.getStone(s)?.name || s)}</a>`).join("")}</div>
          </div>
        </div>
      </section>
      <section class="section"><div class="section-head"><div><p class="eyebrow">Изделия коллекции</p><h2>Каталог коллекции</h2></div></div>${relatedCards(list)}</section>
    `;
  }

  function renderAboutPage() {
    const root = document.getElementById("page-root");
    if (!root) return;
    root.innerHTML = `
      <nav class="topbar topbar-rich page-topbar"><a class="brand-link" href="/"><div class="brand">Stone Atelier</div></a><div class="topbar-links"><a class="ghost-link" href="/catalog">Каталог</a></div></nav>
      <section class="section">
        <div class="section-head"><div><p class="eyebrow">О мастерской</p><h1 class="page-title">Ручная работа и подбор камней</h1></div></div>
        <div class="split">
          <div class="split-card"><p>Stone Atelier — это небольшая мастерская, где каждое украшение начинается с отбора камней и проверки их сочетания в паре.</p><p>Мы проектируем украшение вокруг характера камня, а не только вокруг формы изделия.</p></div>
          <div class="split-card accent"><p>Подбор длины, посадки, набора камней и подарочной подачи обсуждается до сборки. Это снижает риск случайной покупки и помогает создать «свое» изделие.</p></div>
        </div>
      </section>
      <section class="section"><div class="section-head"><div><p class="eyebrow">Процесс</p><h2>Как создается украшение</h2></div></div><div class="process-grid">${processSteps.map((s) => `<article class="process-card"><div class="process-image" style="${bgStyle(s.image, "linear-gradient(135deg, rgba(214,182,123,.18), rgba(120,144,156,.16))")}"></div><div class="process-body"><h3>${esc(s.title)}</h3><p>${esc(s.caption)}</p></div></article>`).join("")}</div></section>
    `;
  }

  function renderSizeGuidePage() {
    const root = document.getElementById("page-root");
    if (!root) return;
    const blocks = [
      { key: "bracelet", label: "Браслет" },
      { key: "necklace", label: "Колье" },
      { key: "ring", label: "Кольцо" }
    ];
    root.innerHTML = `
      <nav class="topbar topbar-rich page-topbar"><a class="brand-link" href="/"><div class="brand">Stone Atelier</div></a><div class="topbar-links"><a class="ghost-link" href="/catalog">Каталог</a></div></nav>
      <section class="section">
        <div class="section-head"><div><p class="eyebrow">Помощь с выбором</p><h1 class="page-title">Как определить размер</h1></div></div>
        <div class="size-guide-grid">
          ${blocks
            .map(({ key, label }) => {
              const block = sizeGuide[key];
              return `<article class="panel guide-card">
                <div class="guide-illustration">${esc(label)}</div>
                <h2>${esc(block.title)}</h2>
                <ol>${block.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
                <table class="mini-table">${block.table.map((row) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td></tr>`).join("")}</table>
              </article>`;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  function renderPackagingPage() {
    const root = document.getElementById("page-root");
    if (!root) return;
    root.innerHTML = `
      <nav class="topbar topbar-rich page-topbar"><a class="brand-link" href="/"><div class="brand">Stone Atelier</div></a><div class="topbar-links"><a class="ghost-link" href="/catalog">Каталог</a></div></nav>
      <section class="section">
        <div class="section-head"><div><p class="eyebrow">Упаковка</p><h1 class="page-title">${esc(packaging.title)}</h1></div></div>
        <div class="split">
          <div class="split-card"><p>${esc(packaging.description)}</p><p><strong>Подарочная опция:</strong> ${esc(packaging.giftOption)}</p><p><strong>Открытка:</strong> ${esc(packaging.postcard)}</p><div class="link-list"><a href="/policies/delivery">Доставка</a><a href="/policies/custom-order">Индивидуальный заказ</a></div></div>
          <div class="split-card accent"><div class="wide-photo tall" style="${bgStyle(packaging.photo)}"></div></div>
        </div>
      </section>
    `;
  }

  function renderPolicyPage() {
    const root = document.getElementById("page-root");
    if (!root) return;
    const slug = location.pathname.split("/").pop();
    const policy = policies.find((x) => x.slug === slug);
    if (!policy) {
      root.innerHTML = '<div class="section"><div class="loading-card">Страница не найдена.</div></div>';
      return;
    }
    root.innerHTML = `
      <nav class="topbar topbar-rich page-topbar"><a class="brand-link" href="/"><div class="brand">Stone Atelier</div></a><div class="topbar-links"><a class="ghost-link" href="/catalog">Каталог</a><a class="ghost-link" href="/packaging">Упаковка</a></div></nav>
      <section class="section">
        <div class="section-head"><div><p class="eyebrow">Коммерческая информация</p><h1 class="page-title">${esc(policy.title)}</h1></div></div>
        <article class="panel info-block policy-block"><p>${esc(policy.body)}</p></article>
        <div class="footer-links policy-links">${footerLinks.map((x) => `<a href="${esc(x.href)}">${esc(x.label)}</a>`).join("")}</div>
      </section>
    `;
  }

  function initHomeOrCatalog() {
    attachCatalogInteractions();
    rerenderCatalog(false);
    if (document.body.dataset.page === "home") renderHomeExtras();
  }

  const page = document.body.dataset.page;
  if (page === "home" || page === "catalog") initHomeOrCatalog();
  if (page === "product") renderProductPage();
  if (page === "stone") renderStonePage();
  if (page === "collection") renderCollectionPage();
  if (page === "about") renderAboutPage();
  if (page === "size-guide") renderSizeGuidePage();
  if (page === "packaging") renderPackagingPage();
  if (page === "policy") renderPolicyPage();
})();

