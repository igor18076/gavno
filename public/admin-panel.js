const cmsState = {
  user: null,
  csrfToken: null,
  activeTab: "products",
  lookups: { stones: [], collections: [], products: [], media: [], users: [] },
  caches: {},
  filters: {
    products: { search: "", status: "", collectionId: "", stoneId: "", page: 1, pageSize: 20 },
    reviews: { search: "", status: "pending", page: 1, pageSize: 20 },
    generic: { search: "", page: 1, pageSize: 20 }
  },
  selections: { products: new Set(), reviews: new Set() }
};

const nodes = {
  login: document.getElementById("cms-login"),
  loginForm: document.getElementById("cms-login-form"),
  loginError: document.getElementById("cms-login-error"),
  app: document.getElementById("cms-app"),
  tabs: document.getElementById("cms-tabs"),
  tabContent: document.getElementById("cms-tab-content"),
  counters: document.getElementById("cms-counters"),
  toast: document.getElementById("cms-toast"),
  userBadge: document.getElementById("cms-user-badge"),
  logout: document.getElementById("cms-logout")
};

function esc(v){ return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;"); }
function rub(v){ return `${new Intl.NumberFormat("ru-RU").format(Number(v||0))} ₽`; }
function showToast(message, type="ok"){ nodes.toast.textContent = message; nodes.toast.className = `cms-toast ${type}`; setTimeout(()=> nodes.toast.classList.add("hidden"), 2200); }
function slugify(input){ return String(input||"").toLowerCase().trim().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-"); }
function safeJsonParse(raw, fallback){ try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
function parseNum(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function parseCsv(raw){ return String(raw || "").split(",").map(x => x.trim()).filter(Boolean); }
function parseLines(raw){ return String(raw || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean); }
function parseProcessStepsText(raw){
  return parseLines(raw).map((line, idx) => {
    const parts = line.split("|").map((x) => x.trim());
    return {
      title: parts[0] || `Шаг ${idx + 1}`,
      caption: parts[1] || "",
      image: parts.slice(2).join("|").trim()
    };
  }).filter((x) => x.title || x.caption || x.image);
}
function formatProcessStepsText(list){
  return (Array.isArray(list) ? list : [])
    .map((x) => `${x.title || ""} | ${x.caption || ""} | ${x.image || ""}`)
    .join("\n");
}
function parseVariationsText(raw){
  return parseLines(raw).map((line, idx) => {
    const [label="", priceDelta="", key=""] = line.split("|").map((x) => x.trim());
    return { id: key || `var-${idx + 1}`, label, priceDelta: Number(priceDelta || 0), sortOrder: idx };
  }).filter((v) => v.label);
}
function formatVariationsText(list){
  return (Array.isArray(list) ? list : []).map((v, idx) => `${v.label || ""}|${Number(v.priceDelta || 0)}|${v.variationKey || v.id || `var-${idx+1}`}`).join("\n");
}
function normalizeDimensionsForForm(d){ const x = d && typeof d === "object" ? d : {}; return { length: x.length || "", diameter: x.diameter || "", adjustable: x.adjustable || "" }; }
function helpToggleHtml(text){
  if(!text) return "";
  return `<span class="cms-help"><button type="button" class="cms-help-btn" data-action="help:toggle" aria-expanded="false" aria-label="Подсказка">?</button><span class="cms-help-popover" role="note">${esc(text)}</span></span>`;
}
function fieldWrap(label, inputHtml, help=""){
  return `<label class="cms-field"><span class="cms-field-label-row"><span class="cms-field-label">${esc(label)}</span>${helpToggleHtml(help)}</span>${inputHtml}</label>`;
}
function renderSelectField(label, name, optionsHtml, help=""){ return fieldWrap(label, `<select name="${esc(name)}">${optionsHtml}</select>`, help); }
function roleLabel(v){ return ({ admin:"Администратор", editor:"Редактор", moderator:"Модератор" }[v] || v || ""); }
function productStatusLabel(v){ return ({ draft:"Черновик", published:"Опубликован", archived:"Архив" }[v] || v || ""); }
function reviewStatusLabel(v){ return ({ pending:"На модерации", approved:"Одобрен", rejected:"Отклонен" }[v] || v || ""); }
function reviewSourceLabel(v){ return ({ manual:"Вручную", site:"Сайт", instagram:"Instagram", telegram:"Telegram" }[v] || v || ""); }
function mediaSelectOptions(selectedUrl = ""){
  return [`<option value="">Из медиабиблиотеки…</option>`]
    .concat((cmsState.lookups.media || []).map((m) => `<option value="${esc(m.public_url)}" ${String(selectedUrl||"") === String(m.public_url||"") ? "selected" : ""}>#${esc(m.id)} • ${esc(m.original_name || m.public_url)}</option>`))
    .join("");
}
function renderImageField(label, name, value, help="", attrs=""){
  return `<div class="cms-field">
    <span class="cms-field-label-row"><span class="cms-field-label">${esc(label)}</span>${helpToggleHtml(help)}</span>
    <div class="cms-inline-media" data-inline-media-wrap>
      <div class="cms-inline-media-row">
        <input type="text" name="${esc(name)}" value="${esc(value ?? "")}" ${attrs} data-image-url-input />
        <button class="mini-btn" type="button" data-action="media:pick-into-field">Подставить</button>
        <input type="file" accept="image/*" data-inline-upload />
      </div>
      <select class="cms-media-select" data-media-pick-select>${mediaSelectOptions(value)}</select>
      <span class="cms-media-hint">Можно загрузить файл прямо здесь или выбрать файл из медиабиблиотеки.</span>
    </div>
  </div>`;
}

async function api(url, options = {}){
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"] && options.body !== undefined) headers["Content-Type"] = "application/json";
  if (cmsState.csrfToken && !["GET","HEAD"].includes(String(options.method || "GET").toUpperCase())) headers["x-csrf-token"] = cmsState.csrfToken;
  const res = await fetch(url, { credentials: "same-origin", ...options, headers });
  const payload = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(payload?.error?.message || payload?.error || "Ошибка API");
  return payload;
}

async function checkSession(){
  try {
    const data = await api("/api/admin/cms/auth/me");
    cmsState.user = data.user; cmsState.csrfToken = data.csrfToken;
    enterApp();
  } catch {
    enterLogin();
  }
}
function enterLogin(){ nodes.login.classList.remove("hidden"); nodes.app.classList.add("hidden"); }
function enterApp(){ nodes.login.classList.add("hidden"); nodes.app.classList.remove("hidden"); nodes.userBadge.textContent = `${cmsState.user.email} • ${roleLabel(cmsState.user.role)}`; refreshDashboard(); refreshLookups(); renderTab(); }

async function refreshDashboard(){
  try {
    const data = await api("/api/admin/cms/dashboard");
    const c = data.counters || {};
    nodes.counters.innerHTML = `
      <div class="cms-counter"><span>Товары</span><strong>${esc(c.products || 0)}</strong></div>
      <div class="cms-counter"><span>Камни</span><strong>${esc(c.stones || 0)}</strong></div>
      <div class="cms-counter"><span>Коллекции</span><strong>${esc(c.collections || 0)}</strong></div>
      <div class="cms-counter"><span>Отзывы на модерации</span><strong>${esc(c.reviewsPending || 0)}</strong></div>`;
  } catch (e) { console.error(e); }
}

async function refreshLookups(){
  try { cmsState.lookups = await api("/api/admin/cms/lookups"); } catch (e) { console.error(e); }
}

function setActiveTab(tab){ cmsState.activeTab = tab; [...nodes.tabs.querySelectorAll("[data-tab]")].forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab)); renderTab(); }

function toolbarSearch(id, placeholder, value){ return `<input id="${id}" type="search" placeholder="${esc(placeholder)}" value="${esc(value || "")}" />`; }
function pagerHtml(meta, actionPrefix){
  if(!meta) return ""; const totalPages = Math.max(1, Math.ceil((meta.total || 0) / (meta.pageSize || 20)));
  return `<div class="cms-pager"><button class="mini-btn" data-action="${actionPrefix}:page" data-page="${Math.max(1,(meta.page||1)-1)}" ${meta.page<=1?"disabled":""}>←</button><span>${meta.page||1} / ${totalPages}</span><button class="mini-btn" data-action="${actionPrefix}:page" data-page="${Math.min(totalPages,(meta.page||1)+1)}" ${meta.page>=totalPages?"disabled":""}>→</button></div>`;
}

function renderEntityTable(columns, items, rowRenderer, options = {}){
  return `
    <div class="products-table cms-table-wrap">
      <table>
        <thead><tr>${options.selectable?"<th><input type='checkbox' data-action='toggle-all' /></th>":""}${columns.map(c=>`<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${items.length ? items.map(rowRenderer).join("") : `<tr><td colspan="${columns.length + (options.selectable?1:0)}"><span class="small-muted">Пусто</span></td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderField(label, name, value, type="text", attrs="", help=""){
  return fieldWrap(label, `<input type="${type}" name="${esc(name)}" value="${esc(value ?? "")}" ${attrs} />`, help);
}
function renderTextarea(label, name, value, rows=4, help=""){
  return fieldWrap(label, `<textarea name="${esc(name)}" rows="${rows}">${esc(value ?? "")}</textarea>`, help);
}

function getLookupOptions(list, selected){
  return (list || []).map(x => `<option value="${esc(x.id)}" ${String(selected ?? "") === String(x.id) ? "selected" : ""}>${esc(x.name || x.email || x.slug)}</option>`).join("");
}

async function loadProducts(){
  const f = cmsState.filters.products;
  const qs = new URLSearchParams(); Object.entries(f).forEach(([k,v])=>{ if(v!=="" && v!=null) qs.set(k,v); });
  cmsState.caches.products = await api(`/api/admin/cms/products?${qs.toString()}`);
}
async function loadStones(){ cmsState.caches.stones = await api(`/api/admin/cms/stones?search=${encodeURIComponent(cmsState.filters.generic.search||"")}&page=${cmsState.filters.generic.page}`); }
async function loadCollections(){ cmsState.caches.collections = await api(`/api/admin/cms/collections?search=${encodeURIComponent(cmsState.filters.generic.search||"")}&page=${cmsState.filters.generic.page}`); }
async function loadReviews(){ const f = cmsState.filters.reviews; const qs = new URLSearchParams(); Object.entries(f).forEach(([k,v])=>{ if(v!=="" && v!=null) qs.set(k,v); }); cmsState.caches.reviews = await api(`/api/admin/cms/reviews?${qs}`); }
async function loadPages(){ cmsState.caches.pages = await api(`/api/admin/cms/pages?search=${encodeURIComponent(cmsState.filters.generic.search||"")}&page=${cmsState.filters.generic.page}`); }
async function loadMedia(){ cmsState.caches.media = await api(`/api/admin/cms/media?search=${encodeURIComponent(cmsState.filters.generic.search||"")}&page=${cmsState.filters.generic.page}`); }
async function loadSettings(){ cmsState.caches.settings = await api(`/api/admin/cms/settings`); }
async function loadUsers(){ cmsState.caches.users = await api(`/api/admin/cms/users`); }
async function loadAudit(){ cmsState.caches.audit = await api(`/api/admin/cms/audit-log?page=${cmsState.filters.generic.page}`); }

function productFormHtml(item = {}){
  const stones = cmsState.lookups.stones || [];
  const collections = cmsState.lookups.collections || [];
  const selectedStoneIds = new Set((item.stones || []).map(s => Number(s.id)));
  const dims = normalizeDimensionsForForm(item.dimensions);
  return `
    <form id="cms-product-form" class="panel form-panel cms-form-grid" data-id="${esc(item.id || "")}">
      <div class="cms-form-head"><h2>${item.id ? `Редактирование товара #${item.id}` : "Новый товар"}</h2><div class="form-actions"><button class="btn btn-primary" type="submit">Сохранить</button><button class="btn btn-secondary" type="button" data-action="products:new">Новый</button></div></div>
      <div class="cms-grid-2">
        ${renderField("Название","name",item.name,"text","","Как будет показано на витрине и в карточке товара.")}
        ${renderField("Slug","slug",item.slug || slugify(item.name || ""),"text","","URL товара: /products/<slug>. Можно изменить вручную.")}
        ${renderField("Тип изделия","type",item.type,"text","","Например: браслет, колье, серьги, кольцо.")}
        ${renderSelectField("Коллекция","collectionId",`<option value="">—</option>${getLookupOptions(collections, item.collectionId)}`,"Связь товара с коллекцией для каталога и страницы коллекции.")}
        ${renderField("Цена","price",item.price||0,"number","min='0' step='1'","Цена в рублях без символа ₽.")}
        ${renderSelectField("Статус","status",`<option ${item.status==='draft'?'selected':''} value="draft">Черновик</option><option ${item.status==='published'?'selected':''} value="published">Опубликован</option><option ${item.status==='archived'?'selected':''} value="archived">Архив</option>`,"Черновик не виден покупателям, опубликованный товар показывается на витрине.")}
        ${renderField("Срок изготовления","leadTime",item.leadTime,"text","","Например: 3–5 дней или 1 неделя.")}
        ${renderField("Металл","metal",item.metal,"text","","Например: серебро 925, латунь с позолотой.")}
        ${renderField("Вес","weight",item.weight,"text","","Например: 8 г.")}
        ${renderField("Цвет","color",item.color,"text","","Основной цвет для фильтра каталога.")}
        ${renderField("Позиция","position",item.position||0,"number","","Меньше число — выше в списке.")}
        ${renderImageField("SEO OG-изображение","seoOgImage",item.seoOgImage,"Картинка для превью ссылки в соцсетях и мессенджерах.")}
        ${renderField("SEO title","seoMetaTitle",item.seoMetaTitle,"text","","Если пусто, можно оставить — будет использовано название товара.")}
        <div class="cms-grid-span-2">${renderField("SEO description","seoMetaDescription",item.seoMetaDescription,"text","","Короткое описание для поисковых систем.")}</div>
      </div>
      ${renderTextarea("Описание","description",item.description,4,"Основное описание изделия на карточке товара.")}
      ${renderTextarea("История камня","stoneStory",item.stoneStory,3,"Смысл/история камней, использованных в украшении.")}
      ${renderTextarea("Уход","care",item.care,3,"Рекомендации по уходу и хранению.")}
      <div class="cms-grid-2">
        ${renderField("Длина","dimLength",dims.length,"text","","Например: 17 см")}
        ${renderField("Диаметр","dimDiameter",dims.diameter,"text","","Например: 6 мм")}
        <div class="cms-grid-span-2">${renderField("Регулируемость","dimAdjustable",dims.adjustable,"text","","Например: регулируется / не регулируется / 16–18 см")}</div>
      </div>
      ${renderField("Поводы","occasion",Array.isArray(item.occasion) ? item.occasion.join(", ") : "","text","","Через запятую: подарок, повседневное, вечернее")}
      ${renderField("Бейджи","badges",Array.isArray(item.badges) ? item.badges.join(", ") : "","text","","Через запятую: новинка, бестселлер, лимит")}
      ${renderTextarea("Вариации","variationsText",formatVariationsText(item.variations || []),4,"По одной вариации в строке: Название | Надбавка к цене | Ключ. Пример: 17 см|0|size-17")}
      <div class="cms-media-picker" id="product-images-picker">
        <div class="cms-media-picker-head"><h3>Галерея / обложка</h3><button type="button" class="btn btn-secondary" data-action="product:add-image-row">Добавить строку</button></div>
        <div id="product-images-list">${renderProductImageRows(item.images || [])}</div>
        <p class="small-muted">Можно загрузить файл прямо в строке, выбрать из медиабиблиотеки, задать порядок и обложку.</p>
      </div>
      <fieldset class="cms-fieldset"><legend>Камни в изделии</legend><p class="cms-section-note">Отметьте один или несколько камней для связки товара с энциклопедией камней.</p><div class="cms-checkbox-grid">${stones.map(s => `<label class="check"><input type="checkbox" name="stoneIds" value="${s.id}" ${selectedStoneIds.has(Number(s.id)) ? "checked" : ""}/> ${esc(s.name)}</label>`).join("")}</div></fieldset>
      <p id="cms-product-form-error" class="form-error"></p>
    </form>`;
}
function renderProductImageRows(images){
  const rows = images.length ? images : [{ url:"", alt:"", sortOrder:0, isCover:true, mediaId:"" }];
  return rows.map((img,idx)=>`<div class="cms-image-row" data-index="${idx}">
      <input type="hidden" name="imageRowIndex" value="${idx}" />
      <div class="cms-inline-media" data-inline-media-wrap>
        <div class="cms-inline-media-row">
          <input type="text" data-image-field="url" data-image-url-input value="${esc(img.url||"")}" placeholder="URL изображения" />
          <button type="button" class="mini-btn" data-action="media:pick-into-field">Подставить</button>
          <input type="file" accept="image/*" data-inline-upload />
        </div>
        <select class="cms-media-select" data-media-pick-select>${mediaSelectOptions(img.url || "")}</select>
      </div>
      <input type="text" data-image-field="alt" value="${esc(img.alt||"")}" placeholder="Alt" />
      <input type="number" data-image-field="sortOrder" value="${esc(img.sortOrder ?? idx)}" placeholder="Порядок" />
      <input type="number" data-image-field="mediaId" value="${esc(img.mediaId || "")}" placeholder="ID медиа" />
      <label class="check"><input type="radio" name="coverIndex" value="${idx}" ${img.isCover ? "checked" : ""}/> Обложка</label>
      <button type="button" class="mini-btn danger" data-action="product:remove-image-row" data-index="${idx}">Удал.</button>
    </div>`).join("");
}

function productsTabHtml(){
  const data = cmsState.caches.products || { items: [], total:0, page:1, pageSize:20 };
  const f = cmsState.filters.products;
  const rows = data.items || [];
  return `
    <div class="cms-tab-grid">
      <section class="panel">
        <div class="cms-toolbar">${toolbarSearch("products-search","Поиск товаров",f.search)}
          <select id="products-status"><option value="">Статус</option><option value="draft" ${f.status==='draft'?'selected':''}>Черновик</option><option value="published" ${f.status==='published'?'selected':''}>Опубликован</option><option value="archived" ${f.status==='archived'?'selected':''}>Архив</option></select>
          <select id="products-collection"><option value="">Коллекция</option>${getLookupOptions(cmsState.lookups.collections, f.collectionId)}</select>
          <select id="products-stone"><option value="">Камень</option>${getLookupOptions(cmsState.lookups.stones, f.stoneId)}</select>
          <button class="btn btn-secondary" type="button" data-action="products:filter">Фильтр</button>
          <button class="btn btn-secondary" type="button" data-action="products:reset-filters">Сброс</button>
        </div>
        <div class="cms-toolbar">
          <select id="products-bulk-action"><option value="">Пакетное действие</option><option value="publish">Опубликовать</option><option value="archive">Архивировать</option><option value="delete">Мягко удалить (архив)</option></select>
          <button class="btn btn-secondary" type="button" data-action="products:bulk">Применить</button>
          <button class="btn btn-primary" type="button" data-action="products:new">Новый товар</button>
        </div>
        ${renderEntityTable(["Товар","Цена","Статус","Коллекция","Действия"], rows, (item)=>`<tr>
          <td><input type='checkbox' data-action='products:select' data-id='${item.id}' ${cmsState.selections.products.has(item.id)?'checked':''}/> <strong>${esc(item.name)}</strong><div class='td-sub'>${esc(item.slug)} • ${esc(item.type)}</div></td>
          <td>${rub(item.price)}</td>
          <td>${esc(productStatusLabel(item.status))}</td>
          <td>${esc(item.collectionName || '—')}</td>
          <td class='actions-cell'><button class='mini-btn' data-action='products:edit' data-id='${item.id}'>Изм.</button><button class='mini-btn danger' data-action='products:delete' data-id='${item.id}'>Архив</button></td>
        </tr>`)}
        ${pagerHtml(data, "products")}
      </section>
      <section id="products-form-host">${productFormHtml(cmsState.caches.productCurrent || {})}</section>
    </div>`;
}

function simpleEntityTabHtml(kind, title, fields, items, current){
  const listCols = ["Название", "Slug/ID", "Действия"];
  return `<div class="cms-tab-grid">
    <section class="panel">
      <div class="cms-toolbar">${toolbarSearch(`${kind}-search`,`Поиск`, cmsState.filters.generic.search)}<button class="btn btn-secondary" data-action="${kind}:search">Искать</button><button class="btn btn-primary" data-action="${kind}:new">Новый</button></div>
      ${renderEntityTable(listCols, items, (it)=>`<tr><td><strong>${esc(it.name || it.title || it.key || it.email || ('#'+it.id))}</strong>${it.description ? `<div class='td-sub'>${esc(String(it.description)).slice(0,120)}</div>` : ''}</td><td>${esc(it.slug || it.key || it.email || it.id)}</td><td class='actions-cell'><button class='mini-btn' data-action='${kind}:edit' data-id='${it.id || it.key}'>Изм.</button>${kind!=="settings"?`<button class='mini-btn danger' data-action='${kind}:delete' data-id='${it.id || it.key}'>Удал.</button>`:''}</td></tr>`)}
    </section>
    <section class="panel">
      <form class="form-panel cms-form-grid" id="${kind}-form" data-id="${esc(current?.id || current?.key || "")}">
        <div class="cms-form-head"><h2>${current?.id || current?.key ? "Редактирование" : "Создание"}</h2><button class="btn btn-primary" type="submit">Сохранить</button></div>
        ${fields(current || {}).join("")}
        <p class="form-error" id="${kind}-form-error"></p>
      </form>
      ${kind === "pages" ? `<div class='panel cms-preview-panel'><h3>Предпросмотр</h3><div id='pages-preview' class='cms-markdown-preview'>${esc(current?.content_markdown || '')}</div></div>` : ""}
    </section>
  </div>`;
}

function reviewsTabHtml(){
  const d = cmsState.caches.reviews || { items: [], total:0, page:1, pageSize:20 }; const f = cmsState.filters.reviews;
  return `<div class="cms-tab-grid cms-single-col">
    <section class="panel">
      <div class="cms-toolbar">${toolbarSearch("reviews-search","Поиск отзывов",f.search)}<select id="reviews-status"><option value="">Все</option><option value="pending" ${f.status==='pending'?'selected':''}>На модерации</option><option value="approved" ${f.status==='approved'?'selected':''}>Одобрен</option><option value="rejected" ${f.status==='rejected'?'selected':''}>Отклонен</option></select><button class="btn btn-secondary" data-action="reviews:filter">Фильтр</button><button class="btn btn-primary" data-action="reviews:new">Новый отзыв</button></div>
      <div class="cms-toolbar"><button class="btn btn-secondary" data-action="reviews:bulk-approve">Одобрить выбранные</button><button class="btn btn-secondary" data-action="reviews:bulk-reject">Отклонить выбранные</button></div>
      ${renderEntityTable(["Отзыв","Статус","Источник","Дата","Действия"], d.items || [], (it)=>`<tr><td><input type='checkbox' data-action='reviews:select' data-id='${it.id}' ${cmsState.selections.reviews.has(it.id)?'checked':''}/> <strong>${esc(it.name)}</strong><div class='td-sub'>${esc(it.city||'')} • ${esc(String(it.text||'').slice(0,120))}</div></td><td>${esc(reviewStatusLabel(it.status))}</td><td>${esc(reviewSourceLabel(it.source))}</td><td>${esc(it.review_date || '')}</td><td class='actions-cell'><button class='mini-btn' data-action='reviews:edit' data-id='${it.id}'>Изм.</button>${cmsState.user?.role==='admin' ? `<button class='mini-btn danger' data-action='reviews:delete' data-id='${it.id}'>Удал.</button>` : ''}</td></tr>`)}
      ${pagerHtml(d, "reviews")}
    </section>
    <section class="panel" id="reviews-form-host">${reviewFormHtml(cmsState.caches.reviewCurrent || {})}</section>
  </div>`;
}
function reviewFormHtml(item={}){
  return `<form id="reviews-form" class="form-panel cms-form-grid" data-id="${esc(item.id||"")}">
    <div class="cms-form-head"><h2>${item.id?`Отзыв #${item.id}`:"Новый отзыв"}</h2><button class="btn btn-primary" type="submit">Сохранить</button></div>
    ${renderField("Имя","name",item.name,"text","","Имя покупателя для отображения на витрине.")}
    ${renderField("Город","city",item.city,"text","","Город покупателя (необязательно).")}
    ${renderSelectField("Товар","productId",`<option value="">—</option>${(cmsState.lookups.products || []).map(p=>`<option value="${p.id}" ${String(item.product_id||item.productId||"")===String(p.id)?"selected":""}>${esc(p.name)}</option>`).join("")}`,"Если привязать товар, отзыв появится в карточке изделия.")}
    ${renderSelectField("Статус","status",`<option value="pending" ${String(item.status||'pending')==='pending'?'selected':''}>На модерации</option><option value="approved" ${String(item.status)==='approved'?'selected':''}>Одобрен</option><option value="rejected" ${String(item.status)==='rejected'?'selected':''}>Отклонен</option>`,"Статус модерации отзыва.")}
    ${renderSelectField("Источник","source",`<option value="manual" ${String(item.source||'manual')==='manual'?'selected':''}>Вручную</option><option value="site" ${String(item.source)==='site'?'selected':''}>Сайт</option><option value="instagram" ${String(item.source)==='instagram'?'selected':''}>Instagram</option><option value="telegram" ${String(item.source)==='telegram'?'selected':''}>Telegram</option>`,"Откуда пришел отзыв.")}
    ${renderField("Повод покупки","occasion",item.occasion,"text","","Например: подарок, свадьба, на каждый день.")}
    ${renderImageField("Фото отзыва","photoUrl",item.photo_url||item.photoUrl,"Фото покупателя или изделия (необязательно).")}
    ${renderField("Дата","reviewDate",item.review_date||item.reviewDate,"date","","Дата публикации/получения отзыва.")}
    ${renderTextarea("Текст","text",item.text,4,"Текст отзыва, который увидит покупатель.")}
    <p class='form-error' id='reviews-form-error'></p>
  </form>`;
}

function mediaTabHtml(){ const d=cmsState.caches.media||{items:[]}; return `<div class="cms-tab-grid cms-single-col"><section class="panel"><div class="cms-toolbar">${toolbarSearch("media-search","Поиск медиа", cmsState.filters.generic.search)}<button class="btn btn-secondary" data-action="media:search">Искать</button></div><div id="media-dropzone" class="cms-dropzone" tabindex="0">Перетащите изображения сюда или выберите <input id="media-file-input" type="file" multiple accept="image/*" /></div>${renderEntityTable(["Превью","Файл","Размер","Действия"], d.items||[], (it)=>`<tr><td><img class='cms-thumb' src='${esc(it.preview_url || it.public_url)}' alt=''/></td><td><div><strong>${esc(it.original_name)}</strong></div><div class='td-sub'>${esc(it.public_url)}</div></td><td>${esc(Math.round((it.size_bytes||0)/1024))} KB</td><td class='actions-cell'><button class='mini-btn danger' data-action='media:delete' data-id='${it.id}'>Удал.</button></td></tr>`)}${pagerHtml(d,"media")}</section></div>`; }

function settingsTabHtml(){
  const items = cmsState.caches.settings?.items || [];
  const site = items.find(x=>x.key === "site") || { key:"site", value_json:{} };
  const value = site.value_json?.value || site.value_json || {};
  const seo = value.seoDefaults || {};
  const ff = value.featureFlags || {};
  const homepage = value.homepage || {};
  const orderCta = value.orderCta || {};
  const fallbackSteps = Array.isArray(window.StoneAtelierContent?.processSteps) ? window.StoneAtelierContent.processSteps : [];
  const processSteps = Array.isArray(value.processSteps) && value.processSteps.length ? value.processSteps : fallbackSteps;
  const packagingPhoto = value.packagingPhoto || window.StoneAtelierContent?.packaging?.photo || "";
  const heroCollectionOptions = [`<option value="">Автовыбор (первая коллекция)</option>`]
    .concat((cmsState.lookups.collections || []).map((c) => `<option value="${esc(c.slug)}" ${String(homepage.heroCollectionSlug || "") === String(c.slug) ? "selected" : ""}>${esc(c.name)}</option>`))
    .join("");
  return `<div class="cms-tab-grid cms-single-col"><section class="panel"><form id="settings-form" class="form-panel cms-form-grid">
    <div class="cms-form-head"><h2>Настройки сайта</h2><button class="btn btn-primary" type="submit">Сохранить</button></div>
    ${renderField("Название бренда","brandName",value.brandName||"Stone Atelier","text","","Отображается в шапке/подвале и системных местах.")}
    ${renderField("Email","contactEmail",value.contacts?.email||"","email","","Основной контакт для заказов и вопросов.")}
    ${renderField("Telegram","contactTelegram",value.contacts?.telegram||"","text","","Ссылка или @username Telegram.")}
    ${renderField("SEO title по умолчанию","seoDefaultTitle",seo.title||"","text","","Используется, если у страницы нет собственного SEO title.")}
    ${renderField("SEO description по умолчанию","seoDefaultDescription",seo.description||"","text","","Короткое описание сайта по умолчанию.")}
    ${renderImageField("SEO OG-изображение по умолчанию","seoDefaultOgImage",seo.ogImage||"","Изображение по умолчанию для ссылок.")}
    ${renderField("Текст кнопки заказа","orderPrimaryLabel",orderCta.primaryLabel||"Заказать","text","","Основная кнопка в карточке товара.")}
    ${renderField("Ссылка кнопки заказа","orderPrimaryHref",orderCta.primaryHref||"/policies/custom-order?source=primary&product={slug}","text","","Поддерживается шаблон {slug}.")}
    ${renderField("Текст второй кнопки","orderSecondaryLabel",orderCta.secondaryLabel||"Запросить","text","","Вторая кнопка в карточке товара.")}
    ${renderField("Ссылка второй кнопки","orderSecondaryHref",orderCta.secondaryHref||"/policies/custom-order?source=secondary&product={slug}","text","","Поддерживается шаблон {slug}.")}
    ${renderSelectField("Hero-коллекция на главной","homeHeroCollectionSlug",heroCollectionOptions,"Можно выбрать существующую коллекцию для блока «Новая коллекция». Если не выбрано — будет первая коллекция.")}
    ${renderField("Текст бейджа hero","homeHeroBadge",homepage.heroBadge||"Новая коллекция","text","","Например: Новая коллекция / Выбор сезона")}
    ${renderTextarea("Шаги «Как создается украшение»","processStepsText",formatProcessStepsText(processSteps),7,"По одной строке на шаг: Заголовок | Описание | URL изображения. Пример: Выбор камней | Отбираем по свету и оттенку | https://...")}
    ${renderImageField("Фото упаковки","packagingPhoto",packagingPhoto,"Изображение для страницы «Упаковка».")}
    <fieldset class="cms-fieldset"><legend>Переключатели секций</legend>
      <p class="cms-section-note">Включайте/выключайте отдельные блоки витрины без редактирования кода.</p>
      <label class="check"><input type="checkbox" name="ffShowProcess" ${ff.showProcess === false ? "" : "checked"} /> Показать блок процесса создания</label>
      <label class="check"><input type="checkbox" name="ffShowReviews" ${ff.showReviews === false ? "" : "checked"} /> Показать отзывы на главной</label>
      <label class="check"><input type="checkbox" name="ffShowStoneGuide" ${ff.showStoneGuide === false ? "" : "checked"} /> Показать блок энциклопедии камней</label>
    </fieldset>
    <p id='settings-form-error' class='form-error'></p>
  </form></section></div>`;
}

function usersTabHtml(){
  const items = cmsState.caches.users?.items || [];
  return `<div class="cms-tab-grid"><section class="panel">${renderEntityTable(["Email","Роль","Активен","Действия"], items, (u)=>`<tr><td>${esc(u.email)}</td><td>${esc(roleLabel(u.role))}</td><td>${u.is_active ? 'Да' : 'Нет'}</td><td class='actions-cell'><button class='mini-btn' data-action='users:edit' data-id='${u.id}'>Изм.</button><button class='mini-btn danger' data-action='users:delete' data-id='${u.id}'>Удал.</button></td></tr>`)} </section><section class='panel'><form id='users-form' class='form-panel cms-form-grid' data-id='${esc(cmsState.caches.userCurrent?.id || "")}'><div class='cms-form-head'><h2>${cmsState.caches.userCurrent?.id ? 'Редактирование пользователя' : 'Новый пользователь'}</h2><button class='btn btn-primary' type='submit'>Сохранить</button></div>${renderField("Email","email",cmsState.caches.userCurrent?.email||"","email","","Логин пользователя для входа в админку.")}${renderField("Пароль","password","","password", cmsState.caches.userCurrent?.id ? "placeholder='Оставьте пустым чтобы не менять'" : "required","Пароль хранится в зашифрованном виде.")}${renderSelectField("Роль","role",`<option value='admin'>Администратор</option><option value='editor'>Редактор</option><option value='moderator'>Модератор</option>`,"Уровень доступа к разделам CMS.")}<label class='check'><input type='checkbox' name='isActive' ${cmsState.caches.userCurrent?.id ? (cmsState.caches.userCurrent?.is_active ? 'checked' : '') : 'checked'} />Активен</label><p class='form-error' id='users-form-error'></p></form></section></div>`;
}

function auditTabHtml(){ const d=cmsState.caches.audit||{items:[]}; return `<div class='cms-tab-grid cms-single-col'><section class='panel'>${renderEntityTable(["Когда","Кто","Действие","Сущность","ID","Изменения"], d.items||[], (a)=>`<tr><td>${esc(a.created_at)}</td><td>${esc(a.actor_email || '')}<div class='td-sub'>${esc(roleLabel(a.actor_role || ''))}</div></td><td>${esc(a.action)}</td><td>${esc(a.entity_type)}</td><td>${esc(a.entity_id || '')}</td><td><pre class='cms-pre'>${esc(JSON.stringify(a.diff_json || {}, null, 2))}</pre></td></tr>`)}${pagerHtml(d, "audit")}</section></div>`; }

function renderTab(){
  const tab = cmsState.activeTab;
  const loaders = { products: loadProducts, stones: loadStones, collections: loadCollections, reviews: async()=>{ if(!cmsState.caches.products) await loadProducts(); return loadReviews(); }, pages: loadPages, media: loadMedia, settings: loadSettings, users: loadUsers, audit: loadAudit };
  Promise.resolve(loaders[tab]?.()).then(()=>{
    if(tab === "products") nodes.tabContent.innerHTML = productsTabHtml();
    else if(tab === "stones") nodes.tabContent.innerHTML = simpleEntityTabHtml("stones","Камни", stoneFields, cmsState.caches.stones?.items || [], cmsState.caches.stoneCurrent);
    else if(tab === "collections") nodes.tabContent.innerHTML = simpleEntityTabHtml("collections","Коллекции", collectionFields, cmsState.caches.collections?.items || [], cmsState.caches.collectionCurrent);
    else if(tab === "reviews") nodes.tabContent.innerHTML = reviewsTabHtml();
    else if(tab === "pages") nodes.tabContent.innerHTML = simpleEntityTabHtml("pages","Страницы", pageFields, cmsState.caches.pages?.items || [], cmsState.caches.pageCurrent);
    else if(tab === "media") nodes.tabContent.innerHTML = mediaTabHtml();
    else if(tab === "settings") nodes.tabContent.innerHTML = settingsTabHtml();
    else if(tab === "users") nodes.tabContent.innerHTML = usersTabHtml();
    else if(tab === "audit") nodes.tabContent.innerHTML = auditTabHtml();
    hydrateTabDefaults(tab);
  }).catch(err=>{ nodes.tabContent.innerHTML = `<div class='loading-card'>${esc(err.message)}</div>`; });
}

function stoneFields(item={}){
  const textureImages = item.texture_images_json || item.textureImages || [];
  const textureCoverImage = Array.isArray(textureImages) ? (textureImages[0] || "") : "";
  const textureExtraImages = Array.isArray(textureImages) ? textureImages.slice(1) : [];
  return [
    renderField("Название","name",item.name,"text","","Название камня для энциклопедии и фильтров."),
    renderField("Slug","slug",item.slug||slugify(item.name||""),"text","","URL страницы камня: /stones/<slug>."),
    renderTextarea("Описание","description",item.description,3,"Короткое описание камня для карточек и страницы."),
    renderTextarea("Символика","symbolism",item.symbolism,2,"Смысл и ассоциации камня."),
    renderField("Происхождение","origin",item.origin,"text","","Место добычи/происхождение (если уместно)."),
    renderTextarea("Как носить","howToWear",item.how_to_wear||item.howToWear,2,"Подсказки по сочетаниям и стилю."),
    renderTextarea("Уход","care",item.care,2,"Как хранить и очищать камень."),
    renderField("Оттенки","shades",Array.isArray(item.shades_json || item.shades) ? (item.shades_json || item.shades).join(", ") : "","text","","Через запятую: молочный, голубой, дымчатый"),
    renderImageField("Главное изображение текстуры","textureCoverImage",textureCoverImage,"Главная картинка камня для энциклопедии и карточек."),
    renderTextarea("Дополнительные изображения текстуры","textureImages",Array.isArray(textureExtraImages) ? textureExtraImages.join("\n") : "",4,"По одному URL в строке. Можно загрузить файлы в разделе «Медиа», затем вставить ссылки."),
    renderField("SEO title","seoMetaTitle",item.seo_meta_title||item.seoMetaTitle,"text","","Заголовок для поисковых систем."),
    renderField("SEO description","seoMetaDescription",item.seo_meta_description||item.seoMetaDescription,"text","","Описание для поисковых систем."),
    renderImageField("SEO OG-изображение","seoOgImage",item.seo_og_image||item.seoOgImage,"Превью ссылки на страницу камня."),
    renderField("Позиция","position",item.position||0,"number","","Порядок в списках."),
    `<p class='form-error' id='stones-form-error'></p>`
  ];
}
function collectionFields(item={}){
  const selected = new Set((item.key_stones_json || item.keyStones || []).map(String));
  const stoneChoices = (cmsState.lookups.stones || []).map((s) => `<label class="check"><input type="checkbox" name="keyStoneIds" value="${esc(s.slug)}" ${selected.has(String(s.slug)) || selected.has(String(s.id)) ? "checked" : ""}/> ${esc(s.name)}</label>`).join("");
  return [
    renderField("Название","name",item.name,"text","","Название коллекции."),
    renderField("Slug","slug",item.slug||slugify(item.name||""),"text","","URL страницы коллекции: /collections/<slug>."),
    renderTextarea("Концепция","concept",item.concept,2,"Короткая идея коллекции."),
    renderTextarea("Вдохновение","inspiration",item.inspiration,3,"История и настроение коллекции."),
    renderField("Палитра","palette",Array.isArray(item.palette_json || item.palette) ? (item.palette_json || item.palette).join(", ") : "","text","","Через запятую: графит, молочный, янтарный"),
    `<fieldset class="cms-fieldset"><legend>Ключевые камни</legend><p class="cms-section-note">Выберите камни, которые будут подсвечены на странице коллекции.</p><div class="cms-checkbox-grid">${stoneChoices || "<span class='small-muted'>Сначала создайте камни</span>"}</div></fieldset>`,
    renderImageField("Hero-изображение","heroImageUrl",item.hero_image_url||item.heroImageUrl,"Основное изображение коллекции."),
    renderImageField("Mood-изображение","moodImageUrl",item.mood_image_url||item.moodImageUrl,"Дополнительное mood/атмосферное изображение."),
    renderField("SEO title","seoMetaTitle",item.seo_meta_title||item.seoMetaTitle,"text","","Заголовок для поисковиков."),
    renderField("SEO description","seoMetaDescription",item.seo_meta_description||item.seoMetaDescription,"text","","Описание для поисковиков."),
    renderImageField("SEO OG-изображение","seoOgImage",item.seo_og_image||item.seoOgImage,"Превью ссылки на коллекцию."),
    renderField("Позиция","position",item.position||0,"number","","Порядок в списках."),
    `<p class='form-error' id='collections-form-error'></p>`
  ];
}
function pageFields(item={}){
  return [
    renderField("Название страницы","title",item.title,"text","","Например: Доставка, Возврат, Гарантия."),
    renderField("Slug","slug",item.slug||slugify(item.title||""),"text","","URL страницы: /policies/<slug>."),
    renderTextarea("Содержимое (Markdown)","contentMarkdown",item.content_markdown || item.contentMarkdown,14,"Поддерживаются заголовки и обычный текст. Предпросмотр ниже."),
    renderField("SEO title","seoMetaTitle",item.seo_meta_title||item.seoMetaTitle,"text","","Заголовок для поисковых систем."),
    renderField("SEO description","seoMetaDescription",item.seo_meta_description||item.seoMetaDescription,"text","","Описание для поисковых систем."),
    renderImageField("SEO OG-изображение","seoOgImage",item.seo_og_image||item.seoOgImage,"Превью ссылки в соцсетях и мессенджерах."),
    `<p class='form-error' id='pages-form-error'></p>`
  ];
}

function hydrateTabDefaults(tab){
  if(tab === "users" && cmsState.caches.userCurrent){ const form = document.getElementById("users-form"); if(form){ form.role.value = cmsState.caches.userCurrent.role || 'editor'; form.isActive.checked = Boolean(cmsState.caches.userCurrent.is_active); } }
  if(tab === "pages"){ updateMarkdownPreview(); }
}

async function submitProductForm(form){
  const id = form.dataset.id;
  const fd = new FormData(form);
  const images = [...form.querySelectorAll('.cms-image-row')].map((row, idx)=>({
    url: row.querySelector('[data-image-field="url"]').value,
    alt: row.querySelector('[data-image-field="alt"]').value,
    sortOrder: parseNum(row.querySelector('[data-image-field="sortOrder"]').value || idx),
    mediaId: row.querySelector('[data-image-field="mediaId"]').value || null,
    isCover: String(form.querySelector('input[name="coverIndex"]:checked')?.value||"") === String(idx)
  })).filter((img) => String(img.url || "").trim());
  const stoneIds = fd.getAll("stoneIds").map(Number).filter(Number.isFinite);
  const body = {
    name: fd.get("name"), slug: fd.get("slug"), type: fd.get("type"), collectionId: fd.get("collectionId") || null,
    price: Number(fd.get("price") || 0), status: fd.get("status"), leadTime: fd.get("leadTime"), metal: fd.get("metal"),
    weight: fd.get("weight"), color: fd.get("color"), position: Number(fd.get("position") || 0),
    seoMetaTitle: fd.get("seoMetaTitle"), seoMetaDescription: fd.get("seoMetaDescription"), seoOgImage: fd.get("seoOgImage"),
    description: fd.get("description"), stoneStory: fd.get("stoneStory"), care: fd.get("care"),
    dimensions: { length: fd.get("dimLength") || "", diameter: fd.get("dimDiameter") || "", adjustable: fd.get("dimAdjustable") || "" },
    occasion: parseCsv(fd.get("occasion")),
    badges: parseCsv(fd.get("badges")),
    variations: parseVariationsText(fd.get("variationsText")),
    images, stoneIds
  };
  const url = id ? `/api/admin/cms/products/${id}` : "/api/admin/cms/products";
  const method = id ? "PUT" : "POST";
  return api(url, { method, body: JSON.stringify(body) });
}

async function submitSimpleForm(kind, form){
  const id = form.dataset.id; const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  if(kind === "stones"){
    body.shades = parseCsv(body.shades);
    const cover = String(body.textureCoverImage || "").trim();
    const extra = parseLines(body.textureImages);
    body.textureImages = [cover, ...extra].filter(Boolean).filter((x, idx, arr) => arr.indexOf(x) === idx);
    delete body.textureCoverImage;
  }
  if(kind === "collections"){ body.palette = parseCsv(body.palette); body.keyStones = fd.getAll("keyStoneIds"); }
  if(kind === "pages"){}
  const url = id ? `/api/admin/cms/${kind}/${id}` : `/api/admin/cms/${kind}`;
  const method = id ? "PUT" : "POST";
  return api(url, { method, body: JSON.stringify(body) });
}

function updateMarkdownPreview(){
  const ta = document.querySelector('#pages-form textarea[name="contentMarkdown"]');
  const preview = document.getElementById('pages-preview');
  if(!ta || !preview) return;
  const raw = ta.value || "";
  preview.innerHTML = esc(raw).replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>').replace(/\n\n/g, '<br/><br/>');
}

async function fetchEntityById(kind, id){
  const data = await api(`/api/admin/cms/${kind}/${id}`);
  if(kind === "products") cmsState.caches.productCurrent = data.item;
  if(kind === "stones") cmsState.caches.stoneCurrent = data.item;
  if(kind === "collections") cmsState.caches.collectionCurrent = data.item;
  if(kind === "reviews") cmsState.caches.reviewCurrent = data.item;
  if(kind === "pages") cmsState.caches.pageCurrent = data.item;
  if(kind === "users") cmsState.caches.userCurrent = (cmsState.caches.users?.items || []).find(x => String(x.id) === String(id)) || null;
}

function clearCurrent(kind){
  if(kind === "products") cmsState.caches.productCurrent = null;
  if(kind === "stones") cmsState.caches.stoneCurrent = null;
  if(kind === "collections") cmsState.caches.collectionCurrent = null;
  if(kind === "reviews") cmsState.caches.reviewCurrent = null;
  if(kind === "pages") cmsState.caches.pageCurrent = null;
  if(kind === "users") cmsState.caches.userCurrent = null;
}
function closeHelpPopovers(){
  document.querySelectorAll('.cms-help.open').forEach((wrap)=>{
    wrap.classList.remove('open');
    const btn = wrap.querySelector('.cms-help-btn');
    if(btn) btn.setAttribute('aria-expanded', 'false');
  });
}

function bindEvents(){
  nodes.loginForm?.addEventListener("submit", async (e)=>{
    e.preventDefault(); nodes.loginError.textContent = "";
    const fd = new FormData(nodes.loginForm);
    try {
      const data = await api("/api/admin/cms/auth/login", { method:"POST", body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }) });
      cmsState.user = data.user; cmsState.csrfToken = data.csrfToken; enterApp();
    } catch (err) { nodes.loginError.textContent = err.message; }
  });

  nodes.logout?.addEventListener("click", async ()=>{
    try { await api("/api/admin/cms/auth/logout", { method:"POST" }); } catch {}
    cmsState.user = null; cmsState.csrfToken = null; enterLogin();
  });

  nodes.tabs?.addEventListener("click", (e)=>{ const btn = e.target.closest("[data-tab]"); if(btn) setActiveTab(btn.dataset.tab); });

  document.addEventListener("input", (e)=>{
    const t = e.target;
    if(t.matches('#cms-product-form input[name="name"]')){
      const slug = document.querySelector('#cms-product-form input[name="slug"]');
      if(slug && !slug.dataset.edited){ slug.value = slugify(t.value); }
    }
    if(t.matches('#cms-product-form input[name="slug"]')) t.dataset.edited = "1";
    if(t.matches('#pages-form textarea[name="contentMarkdown"]')) updateMarkdownPreview();
  });

  document.addEventListener("click", async (e)=>{
    if(!e.target.closest(".cms-help")) closeHelpPopovers();
    const btn = e.target.closest("[data-action]");
    if(!btn) return;
    const action = btn.dataset.action;
    try {
      if(action === "help:toggle"){
        const wrap = btn.closest(".cms-help");
        if(!wrap) return;
        const willOpen = !wrap.classList.contains("open");
        closeHelpPopovers();
        if(willOpen){
          wrap.classList.add("open");
          btn.setAttribute("aria-expanded", "true");
        }
        return;
      }
      if(action === "products:new"){ clearCurrent("products"); renderTab(); return; }
      if(action === "products:edit"){ await fetchEntityById("products", btn.dataset.id); renderTab(); return; }
      if(action === "products:delete"){ if(!confirm("Архивировать товар?")) return; await api(`/api/admin/cms/products/${btn.dataset.id}`, { method:"DELETE" }); showToast("Товар архивирован"); await loadProducts(); refreshDashboard(); renderTab(); return; }
      if(action === "products:filter"){ const f = cmsState.filters.products; f.search=document.getElementById('products-search').value; f.status=document.getElementById('products-status').value; f.collectionId=document.getElementById('products-collection').value; f.stoneId=document.getElementById('products-stone').value; f.page=1; await loadProducts(); renderTab(); return; }
      if(action === "products:reset-filters"){ cmsState.filters.products = { search:"", status:"", collectionId:"", stoneId:"", page:1, pageSize:20 }; await loadProducts(); renderTab(); return; }
      if(action === "products:select"){ const id=Number(btn.dataset.id); if(btn.checked) cmsState.selections.products.add(id); else cmsState.selections.products.delete(id); return; }
      if(action === "toggle-all"){
        const table = btn.closest("table");
        if(!table) return;
        const rowChecks = [...table.querySelectorAll("tbody input[type='checkbox'][data-action$=':select']")];
        rowChecks.forEach((cb)=>{
          cb.checked = btn.checked;
          const id = Number(cb.dataset.id);
          if(cb.dataset.action === "products:select"){
            if(btn.checked) cmsState.selections.products.add(id); else cmsState.selections.products.delete(id);
          }
          if(cb.dataset.action === "reviews:select"){
            if(btn.checked) cmsState.selections.reviews.add(id); else cmsState.selections.reviews.delete(id);
          }
        });
        return;
      }
      if(action === "products:bulk"){ const ids=[...cmsState.selections.products]; const bulk=document.getElementById('products-bulk-action').value; if(!ids.length || !bulk) return showToast("Выберите товары и действие","error"); await api('/api/admin/cms/products/bulk',{ method:'POST', body: JSON.stringify({ ids, action: bulk }) }); cmsState.selections.products.clear(); showToast('Пакетное действие выполнено'); await loadProducts(); refreshDashboard(); renderTab(); return; }
      if(action === "products:page"){ cmsState.filters.products.page = Number(btn.dataset.page||1); await loadProducts(); renderTab(); return; }
      if(action === "product:add-image-row"){ const list = document.getElementById('product-images-list'); const rows=[...list.querySelectorAll('.cms-image-row')].length; list.insertAdjacentHTML('beforeend', renderProductImageRows([{url:'',alt:'',sortOrder:rows,isCover:false,mediaId:''}])); return; }
      if(action === "product:remove-image-row"){ btn.closest('.cms-image-row')?.remove(); return; }

      if(action.endsWith(':search')){ cmsState.filters.generic.search = document.getElementById(`${action.split(':')[0]}-search`)?.value || cmsState.filters.generic.search; cmsState.filters.generic.page = 1; renderTab(); return; }
      if(action.match(/^(stones|collections|pages):new$/)){ clearCurrent(action.split(':')[0]); renderTab(); return; }
      if(action.match(/^(stones|collections|pages):edit$/)){ const kind=action.split(':')[0]; await fetchEntityById(kind, btn.dataset.id); renderTab(); return; }
      if(action.match(/^(stones|collections|pages):delete$/)){ const kind=action.split(':')[0]; if(!confirm('Удалить запись?')) return; await api(`/api/admin/cms/${kind}/${btn.dataset.id}`,{method:'DELETE'}); showToast('Удалено'); clearCurrent(kind); refreshDashboard(); renderTab(); return; }

      if(action === 'reviews:new'){ clearCurrent('reviews'); renderTab(); return; }
      if(action === 'reviews:edit'){ await fetchEntityById('reviews', btn.dataset.id); renderTab(); return; }
      if(action === 'reviews:delete'){ if(!confirm('Удалить отзыв?')) return; await api(`/api/admin/cms/reviews/${btn.dataset.id}`,{method:'DELETE'}); showToast('Отзыв удален'); refreshDashboard(); renderTab(); return; }
      if(action === 'reviews:filter'){ const f=cmsState.filters.reviews; f.search=document.getElementById('reviews-search').value; f.status=document.getElementById('reviews-status').value; f.page=1; await loadReviews(); renderTab(); return; }
      if(action === 'reviews:select'){ const id=Number(btn.dataset.id); if(btn.checked) cmsState.selections.reviews.add(id); else cmsState.selections.reviews.delete(id); return; }
      if(action === 'reviews:bulk-approve' || action === 'reviews:bulk-reject'){ const ids=[...cmsState.selections.reviews]; if(!ids.length) return showToast('Нет выбранных отзывов','error'); await api('/api/admin/cms/reviews/bulk',{method:'POST', body: JSON.stringify({ ids, action: action.endsWith('approve') ? 'approve' : 'reject' })}); cmsState.selections.reviews.clear(); showToast('Модерация выполнена'); refreshDashboard(); renderTab(); return; }
      if(action === 'reviews:page'){ cmsState.filters.reviews.page = Number(btn.dataset.page || 1); await loadReviews(); renderTab(); return; }

      if(action === 'media:search'){ cmsState.filters.generic.search = document.getElementById('media-search')?.value || ''; await loadMedia(); renderTab(); return; }
      if(action === 'media:pick-into-field'){
        const wrap = btn.closest('[data-inline-media-wrap]');
        const select = wrap?.querySelector('[data-media-pick-select]');
        const input = wrap?.querySelector('[data-image-url-input]');
        if(!select || !input) return;
        if(!select.value) return showToast('Выберите файл из медиабиблиотеки','error');
        input.value = select.value;
        const row = btn.closest('.cms-image-row');
        const mediaIdInput = row?.querySelector('[data-image-field="mediaId"]');
        if(mediaIdInput){
          const optText = select.options[select.selectedIndex]?.textContent || "";
          const match = optText.match(/^#(\d+)/);
          if(match) mediaIdInput.value = match[1];
        }
        showToast('Ссылка на изображение подставлена');
        return;
      }
      if(action === 'media:delete'){ if(!confirm('Удалить медиа?')) return; await api(`/api/admin/cms/media/${btn.dataset.id}`,{method:'DELETE'}); showToast('Медиа удалено'); await loadMedia(); renderTab(); return; }
      if(action === 'media:page'){ cmsState.filters.generic.page = Number(btn.dataset.page || 1); await loadMedia(); renderTab(); return; }

      if(action === 'users:edit'){ await fetchEntityById('users', btn.dataset.id); renderTab(); return; }
      if(action === 'users:delete'){ if(!confirm('Удалить пользователя?')) return; await api(`/api/admin/cms/users/${btn.dataset.id}`,{method:'DELETE'}); showToast('Пользователь удален'); clearCurrent('users'); await loadUsers(); renderTab(); return; }
      if(action === 'audit:page'){ cmsState.filters.generic.page = Number(btn.dataset.page || 1); await loadAudit(); renderTab(); return; }
    } catch(err){ showToast(err.message,'error'); }
  });

  document.addEventListener("submit", async (e)=>{
    const form = e.target;
    try {
      if(form.id === 'cms-product-form'){ e.preventDefault(); await submitProductForm(form); showToast('Товар сохранен'); clearCurrent('products'); await loadProducts(); refreshDashboard(); renderTab(); return; }
      if(form.id === 'stones-form' || form.id === 'collections-form' || form.id === 'pages-form'){ e.preventDefault(); const kind=form.id.replace('-form',''); await submitSimpleForm(kind, form); showToast('Сохранено'); clearCurrent(kind); refreshDashboard(); renderTab(); return; }
      if(form.id === 'reviews-form'){ e.preventDefault(); const fd=new FormData(form); const body = Object.fromEntries(fd.entries()); const id=form.dataset.id; await api(id ? `/api/admin/cms/reviews/${id}` : '/api/admin/cms/reviews', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }); showToast('Отзыв сохранен'); clearCurrent('reviews'); refreshDashboard(); renderTab(); return; }
      if(form.id === 'settings-form'){
        e.preventDefault();
        const fd=new FormData(form);
        const currentRaw = (cmsState.caches.settings?.items || []).find(x => x.key === "site")?.value_json || {};
        const current = currentRaw?.value || currentRaw;
        const parsedProcessSteps = parseProcessStepsText(fd.get('processStepsText'));
        const body={
          ...current,
          brandName: fd.get('brandName'),
          contacts:{ ...(current.contacts || {}), email: fd.get('contactEmail'), telegram: fd.get('contactTelegram') },
          seoDefaults:{ ...(current.seoDefaults || {}), title: fd.get('seoDefaultTitle') || "", description: fd.get('seoDefaultDescription') || "", ogImage: fd.get('seoDefaultOgImage') || "" },
          orderCta:{
            ...(current.orderCta || {}),
            primaryLabel: fd.get('orderPrimaryLabel') || "Заказать",
            primaryHref: fd.get('orderPrimaryHref') || "/policies/custom-order?source=primary&product={slug}",
            secondaryLabel: fd.get('orderSecondaryLabel') || "Запросить",
            secondaryHref: fd.get('orderSecondaryHref') || "/policies/custom-order?source=secondary&product={slug}"
          },
          processSteps: parsedProcessSteps,
          packagingPhoto: String(fd.get('packagingPhoto') || "").trim(),
          homepage:{ ...(current.homepage || {}), heroCollectionSlug: fd.get('homeHeroCollectionSlug') || "", heroBadge: fd.get('homeHeroBadge') || "Новая коллекция" },
          featureFlags:{ ...(current.featureFlags || {}), showProcess: fd.get('ffShowProcess') === 'on', showReviews: fd.get('ffShowReviews') === 'on', showStoneGuide: fd.get('ffShowStoneGuide') === 'on' }
        };
        await api('/api/admin/cms/settings/site',{method:'PUT', body: JSON.stringify({ value: body })});
        showToast('Настройки сохранены'); await loadSettings(); renderTab(); return;
      }
      if(form.id === 'users-form'){ e.preventDefault(); const fd=new FormData(form); const body={ email: fd.get('email'), role: fd.get('role'), isActive: fd.get('isActive') === 'on' }; if(fd.get('password')) body.password = fd.get('password'); const id=form.dataset.id; await api(id ? `/api/admin/cms/users/${id}` : '/api/admin/cms/users', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }); showToast('Пользователь сохранен'); clearCurrent('users'); await loadUsers(); renderTab(); return; }
    } catch(err){ const errNode = form.querySelector('.form-error'); if(errNode) errNode.textContent = err.message; else showToast(err.message,'error'); }
  });

  document.addEventListener('change', (e)=>{
    const t=e.target;
    if(t.id === 'media-file-input'){ uploadMediaFiles([...t.files]).catch(()=>{}); }
    if(t.matches('[data-inline-upload]')){
      const files = [...(t.files || [])];
      if(!files.length) return;
      uploadMediaFiles(files).then((resp)=>{
        const item = resp?.items?.[0];
        if(!item) return;
        const wrap = t.closest('[data-inline-media-wrap]');
        const input = wrap?.querySelector('[data-image-url-input]');
        const select = wrap?.querySelector('[data-media-pick-select]');
        if(input) input.value = item.public_url || item.preview_url || "";
        if(select){
          refreshLookups().then(()=>{
            select.innerHTML = mediaSelectOptions(item.public_url || "");
            if(item.public_url) select.value = item.public_url;
          });
        }
        const row = t.closest('.cms-image-row');
        const mediaIdInput = row?.querySelector('[data-image-field="mediaId"]');
        if(mediaIdInput && item.id) mediaIdInput.value = item.id;
      }).catch((err)=> showToast(err.message,'error')).finally(()=>{ t.value = ""; });
    }
  });

  document.addEventListener('dragover', (e)=>{ const dz=e.target.closest('#media-dropzone'); if(dz){ e.preventDefault(); dz.classList.add('drag'); } });
  document.addEventListener('dragleave', (e)=>{ const dz=e.target.closest('#media-dropzone'); if(dz) dz.classList.remove('drag'); });
  document.addEventListener('drop', (e)=>{ const dz=e.target.closest('#media-dropzone'); if(dz){ e.preventDefault(); dz.classList.remove('drag'); uploadMediaFiles([...(e.dataTransfer?.files || [])]); } });
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closeHelpPopovers(); });
}

async function uploadMediaFiles(files){
  if(!files.length) return;
  const fd = new FormData(); files.forEach(f=>fd.append('files', f));
  try {
    const resp = await api('/api/admin/cms/media/upload', { method:'POST', body: fd });
    showToast(`Загружено файлов: ${files.length}`);
    if(cmsState.activeTab==='media'){ await loadMedia(); renderTab(); }
    await refreshLookups();
    return resp;
  } catch(err){ showToast(err.message,'error'); throw err; }
}

checkSession();
bindEvents();
