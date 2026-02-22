const path = require("path");
const fs = require("fs");
let sharp = null;
try { sharp = require("sharp"); } catch {}
const { CMS_SESSION_KEY, canRole, verifyPassword, slugify, normalizeProductPayload, validateProductPayload, validateReviewStatusTransition, buildAuthRateLimiter, createMediaUploader, buildCsrfToken, adminError, auditLog, parseBool, hashPassword } = require("./cms-admin");

function asyncHandler(fn){ return (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next); }
function ensureCms(req){ if(!req.session.cms) req.session.cms = {}; return req.session.cms; }
function requireCmsAuth(req,res,next){ return req.session?.[CMS_SESSION_KEY] ? next() : adminError(res,401,"Требуется вход в админку"); }
function requireCsrf(req,res,next){ const m=(req.method||"GET").toUpperCase(); if(["GET","HEAD","OPTIONS"].includes(m)) return next(); const t=req.headers["x-csrf-token"]; const s=req.session?.cms?.csrfToken; return (t && s && t===s) ? next() : adminError(res,403,"CSRF token invalid"); }
function requireRole(action, entity){ return (req,res,next)=> canRole(req.session?.[CMS_SESSION_KEY]?.role, action, entity) ? next() : adminError(res,403,"Недостаточно прав"); }
function paged(q){ const page=Math.max(1,Number(q.page||1)||1); const pageSize=Math.min(100,Math.max(1,Number(q.pageSize||20)||20)); return {page,pageSize,offset:(page-1)*pageSize}; }
function search(q){ return String(q.search||"").trim(); }
function arr(raw){ if(Array.isArray(raw)) return raw; if(raw==null||raw==="") return []; try { const p=JSON.parse(String(raw)); return Array.isArray(p)?p:[]; } catch { return []; } }
function escLike(v){ return String(v || "").replace(/[%_]/g, "\\$&"); }

async function optimizeImageVariants(file, cmsMediaDir){
  const originalRel = `/uploads/cms/${file.filename}`;
  const info = { originalUrl: originalRel, previewUrl: originalRel, width: null, height: null, meta: { variants: {}, optimized: false, engine: sharp ? "sharp" : "none" } };
  if(!sharp) return info;
  try {
    const src = file.path || path.join(cmsMediaDir, file.filename);
    const meta = await sharp(src).metadata();
    info.width = meta.width || null; info.height = meta.height || null;
    const base = path.parse(file.filename).name;
    const thumbWebp = `${base}-thumb.webp`; const thumbAvif = `${base}-thumb.avif`; const fullWebp = `${base}.webp`; const fullAvif = `${base}.avif`;
    await sharp(src).rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(cmsMediaDir, thumbWebp));
    info.meta.variants.thumbWebp = `/uploads/cms/${thumbWebp}`; info.previewUrl = info.meta.variants.thumbWebp;
    try { await sharp(src).rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).avif({ quality: 55 }).toFile(path.join(cmsMediaDir, thumbAvif)); info.meta.variants.thumbAvif = `/uploads/cms/${thumbAvif}`; } catch {}
    await sharp(src).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toFile(path.join(cmsMediaDir, fullWebp)); info.meta.variants.fullWebp = `/uploads/cms/${fullWebp}`;
    try { await sharp(src).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).avif({ quality: 58 }).toFile(path.join(cmsMediaDir, fullAvif)); info.meta.variants.fullAvif = `/uploads/cms/${fullAvif}`; } catch {}
    info.meta.optimized = true; return info;
  } catch (e) { info.meta.optimizationError = e.message; return info; }
}

async function collectMediaUsage(pool, media){
  const mediaId = Number(media.id);
  const urls = [media.public_url, media.preview_url];
  const variants = media.meta_json?.variants || {};
  Object.values(variants).forEach((v)=>{ if(v) urls.push(v); });
  const cleanUrls = [...new Set(urls.filter(Boolean))];
  const usage = [];
  const byMediaId = await pool.query("SELECT product_id, id FROM cms_product_images WHERE media_id = $1 LIMIT 20", [mediaId]);
  if(byMediaId.rowCount) usage.push({ entity: "cms_product_images.media_id", count: byMediaId.rowCount, sample: byMediaId.rows });
  for (const url of cleanUrls) {
    const like = `%${escLike(url)}%`;
    const checks = await Promise.all([
      pool.query("SELECT id FROM cms_product_images WHERE url = $1 LIMIT 10", [url]),
      pool.query("SELECT id FROM cms_products WHERE seo_og_image = $1 LIMIT 10", [url]),
      pool.query("SELECT id FROM cms_stones WHERE seo_og_image = $1 LIMIT 10", [url]),
      pool.query("SELECT id FROM cms_collections WHERE hero_image_url = $1 OR mood_image_url = $1 OR seo_og_image = $1 LIMIT 10", [url]),
      pool.query("SELECT id FROM cms_pages WHERE seo_og_image = $1 OR content_markdown ILIKE $2 ESCAPE '\\' LIMIT 10", [url, like]),
      pool.query("SELECT id FROM cms_stones WHERE texture_images_json::text ILIKE $1 ESCAPE '\\' LIMIT 10", [like]),
      pool.query("SELECT id FROM cms_settings WHERE value_json::text ILIKE $1 ESCAPE '\\' LIMIT 10", [like])
    ]);
    const names = ["cms_product_images.url","cms_products.seo_og_image","cms_stones.seo_og_image","cms_collections.images","cms_pages","cms_stones.texture_images_json","cms_settings.value_json"];
    checks.forEach((r, idx)=>{ if(r.rowCount) usage.push({ entity: names[idx], url, count: r.rowCount, sample: r.rows }); });
  }
  return usage;
}

function removeMediaFiles(media, cmsMediaDir){
  const paths = new Set();
  [media.file_path, media.public_url, media.preview_url].forEach((u)=>{ if(String(u||"").startsWith("/uploads/cms/")) paths.add(path.join(cmsMediaDir, path.basename(u))); });
  const variants = media.meta_json?.variants || {};
  Object.values(variants).forEach((u)=>{ if(String(u||"").startsWith("/uploads/cms/")) paths.add(path.join(cmsMediaDir, path.basename(u))); });
  for(const p of paths){ try { if(fs.existsSync(p)) fs.unlinkSync(p); } catch {} }
}

async function listEntity(pool, table, req, cfg={}){
  const {page,pageSize,offset}=paged(req.query); const s=search(req.query); const where=[]; const params=[]; let i=1;
  if(cfg.softDelete) where.push("deleted_at IS NULL");
  if(s && cfg.searchColumns?.length){ const p=[]; for(const col of cfg.searchColumns){ p.push(`${col} ILIKE $${i}`); } params.push(`%${s}%`); i+=1; where.push(`(${p.join(" OR ")})`); }
  for(const f of (cfg.extraFilters||[])){ const v=req.query[f.queryKey]; if(v==null||v==="") continue; where.push(`${f.column} = $${i++}`); params.push(f.cast==="int"?Number(v):v); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortBy = cfg.sortBy || "id"; const sortDir = String(req.query.sortDir||cfg.sortDir||"desc").toLowerCase()==="asc"?"ASC":"DESC";
  const total=(await pool.query(`SELECT COUNT(*)::int AS count FROM ${table} ${whereSql}`, params)).rows[0].count;
  const rows=(await pool.query(`SELECT * FROM ${table} ${whereSql} ORDER BY ${sortBy} ${sortDir} LIMIT $${i++} OFFSET $${i++}`, [...params,pageSize,offset])).rows;
  return {items:rows,total,page,pageSize};
}

async function loadProductRelations(pool, ids){
  if(!ids.length) return {productStones:{},variations:{},images:{}};
  const v = ids.map(Number).filter(Number.isFinite);
  const [stonesRes, varsRes, imgsRes] = await Promise.all([
    pool.query(`SELECT ps.product_id, ps.stone_id, s.name, s.slug, ps.position FROM cms_product_stones ps JOIN cms_stones s ON s.id=ps.stone_id WHERE ps.product_id = ANY($1::bigint[]) ORDER BY ps.position, s.id`, [v]),
    pool.query(`SELECT product_id, id, variation_key, label, price_delta, sort_order FROM cms_product_variations WHERE product_id = ANY($1::bigint[]) ORDER BY sort_order, id`, [v]),
    pool.query(`SELECT product_id, id, media_id, url, alt, sort_order, is_cover FROM cms_product_images WHERE product_id = ANY($1::bigint[]) ORDER BY sort_order, id`, [v])
  ]);
  const out = {productStones:{},variations:{},images:{}};
  for(const r of stonesRes.rows){ const k=String(r.product_id); (out.productStones[k] ||= []).push({id:r.stone_id,name:r.name,slug:r.slug}); }
  for(const r of varsRes.rows){ const k=String(r.product_id); (out.variations[k] ||= []).push({id:r.id,variationKey:r.variation_key,label:r.label,priceDelta:r.price_delta,sortOrder:r.sort_order}); }
  for(const r of imgsRes.rows){ const k=String(r.product_id); (out.images[k] ||= []).push({id:r.id,mediaId:r.media_id,url:r.url,alt:r.alt,sortOrder:r.sort_order,isCover:r.is_cover}); }
  return out;
}
function productDto(r, rel){ const key=String(r.id); return { id:r.id,name:r.name,slug:r.slug,type:r.type,collectionId:r.collection_id,price:Number(r.price),status:r.status,leadTime:r.lead_time||"",metal:r.metal||"",dimensions:r.dimensions_json||{},weight:r.weight||"",description:r.description||"",stoneStory:r.stone_story||"",care:r.care||"",color:r.color||"",occasion:r.occasion_json||[],badges:r.badges_json||[],seoMetaTitle:r.seo_meta_title||"",seoMetaDescription:r.seo_meta_description||"",seoOgImage:r.seo_og_image||"",position:r.position||0,createdAt:r.created_at,updatedAt:r.updated_at,stones:rel.productStones[key]||[],variations:rel.variations[key]||[],images:rel.images[key]||[] }; }
async function writeProductRelations(pool, productId, payload){
  await pool.query("DELETE FROM cms_product_stones WHERE product_id=$1", [productId]);
  for(let i=0;i<payload.stoneIds.length;i++) await pool.query("INSERT INTO cms_product_stones (product_id, stone_id, position) VALUES ($1,$2,$3)",[productId,payload.stoneIds[i],i]);
  await pool.query("DELETE FROM cms_product_variations WHERE product_id=$1", [productId]);
  for(let i=0;i<payload.variations.length;i++){ const v=payload.variations[i]; if(!v.label) continue; await pool.query("INSERT INTO cms_product_variations (product_id, variation_key, label, price_delta, sort_order) VALUES ($1,$2,$3,$4,$5)",[productId,String(v.id||`var-${i+1}`),String(v.label),Number(v.priceDelta||0),Number(v.sortOrder??i)||i]); }
  await pool.query("DELETE FROM cms_product_images WHERE product_id=$1", [productId]);
  let cover=false;
  for(let i=0;i<payload.images.length;i++){ const img=payload.images[i]; if(!img.url) continue; const isCover = !cover && (parseBool(img.isCover) || i===0); if(isCover) cover=true; await pool.query("INSERT INTO cms_product_images (product_id, media_id, url, alt, sort_order, is_cover) VALUES ($1,$2,$3,$4,$5,$6)",[productId, img.mediaId?Number(img.mediaId):null, String(img.url), String(img.alt||""), Number(img.sortOrder??i)||i, isCover]); }
}

function registerCmsRoutes(app, deps){
  const { pool, publicDir, uploadsDir } = deps;
  const cmsMediaDir = path.join(uploadsDir || path.join(process.cwd(), "uploads"), "cms");
  const upload = createMediaUploader(cmsMediaDir);
  const authLimiter = buildAuthRateLimiter();

  app.get("/admin", (_req,res)=>res.sendFile(path.join(publicDir, "admin-panel.html")));

  app.post("/api/admin/cms/auth/login", authLimiter, asyncHandler(async (req,res)=>{
    const email=String(req.body?.email||"").trim().toLowerCase();
    const password=String(req.body?.password||"");
    if(!email||!password) return adminError(res,400,"Email и пароль обязательны");
    const q=await pool.query("SELECT id,email,password_hash,role,is_active FROM admin_users WHERE email=$1", [email]);
    const u=q.rows[0];
    if(!u || !u.is_active || !verifyPassword(password, u.password_hash)) return adminError(res,401,"Неверные учетные данные");
    req.session[CMS_SESSION_KEY] = { id:u.id, email:u.email, role:u.role };
    ensureCms(req).csrfToken = buildCsrfToken();
    res.json({ user:req.session[CMS_SESSION_KEY], csrfToken:req.session.cms.csrfToken });
  }));

  app.get("/api/admin/cms/auth/me", requireCmsAuth, (req,res)=>{ const cms=ensureCms(req); if(!cms.csrfToken) cms.csrfToken = buildCsrfToken(); res.json({ user:req.session[CMS_SESSION_KEY], csrfToken:cms.csrfToken }); });
  app.post("/api/admin/cms/auth/logout", requireCmsAuth, requireCsrf, (req,res)=>{ delete req.session[CMS_SESSION_KEY]; if(req.session.cms) req.session.cms.csrfToken = null; res.json({ok:true}); });

  app.use("/api/admin/cms", requireCmsAuth);
  app.use("/api/admin/cms", requireCsrf);

  app.get("/api/admin/cms/dashboard", requireRole("read","dashboard"), asyncHandler(async (req,res)=>{
    const [p,s,c,r] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM cms_products WHERE deleted_at IS NULL"),
      pool.query("SELECT COUNT(*)::int AS count FROM cms_stones WHERE deleted_at IS NULL"),
      pool.query("SELECT COUNT(*)::int AS count FROM cms_collections WHERE deleted_at IS NULL"),
      pool.query("SELECT COUNT(*)::int AS count FROM cms_reviews WHERE status='pending'")
    ]);
    res.json({ counters:{ products:p.rows[0].count, stones:s.rows[0].count, collections:c.rows[0].count, reviewsPending:r.rows[0].count } });
  }));

  app.get("/api/admin/cms/lookups", asyncHandler(async (req,res)=>{
    const canReadUsers = canRole(req.session?.[CMS_SESSION_KEY]?.role, "settings", "settings");
    const [stones, collections, products, media, users] = await Promise.all([
      pool.query("SELECT id,name,slug FROM cms_stones WHERE deleted_at IS NULL ORDER BY position,id"),
      pool.query("SELECT id,name,slug FROM cms_collections WHERE deleted_at IS NULL ORDER BY position,id"),
      pool.query("SELECT id,name,slug,status FROM cms_products WHERE deleted_at IS NULL ORDER BY position,id DESC LIMIT 1000"),
      pool.query("SELECT id,original_name,public_url FROM cms_media ORDER BY id DESC LIMIT 200"),
      canReadUsers
        ? pool.query("SELECT id,email,role,is_active FROM admin_users ORDER BY id")
        : Promise.resolve({ rows: [] })
    ]);
    res.json({ stones:stones.rows, collections:collections.rows, products:products.rows, media:media.rows, users:users.rows });
  }));

  app.get("/api/admin/cms/products", requireRole("read","products"), asyncHandler(async (req,res)=>{
    const {page,pageSize,offset}=paged(req.query); const params=[]; const where=["p.deleted_at IS NULL"]; let i=1; const s=search(req.query);
    if(req.query.status){ where.push(`p.status=$${i++}`); params.push(String(req.query.status)); }
    if(req.query.collectionId){ where.push(`p.collection_id=$${i++}`); params.push(Number(req.query.collectionId)); }
    if(req.query.stoneId){ where.push(`EXISTS (SELECT 1 FROM cms_product_stones ps WHERE ps.product_id=p.id AND ps.stone_id=$${i++})`); params.push(Number(req.query.stoneId)); }
    if(s){ where.push(`(p.name ILIKE $${i} OR p.slug ILIKE $${i} OR p.description ILIKE $${i})`); params.push(`%${s}%`); i++; }
    const whereSql=`WHERE ${where.join(" AND ")}`;
    const total=(await pool.query(`SELECT COUNT(*)::int AS count FROM cms_products p ${whereSql}`, params)).rows[0].count;
    const rows=(await pool.query(`SELECT p.*, c.name AS collection_name FROM cms_products p LEFT JOIN cms_collections c ON c.id=p.collection_id ${whereSql} ORDER BY p.position ASC, p.id DESC LIMIT $${i++} OFFSET $${i++}`,[...params,pageSize,offset])).rows;
    const rel=await loadProductRelations(pool, rows.map(x=>x.id));
    res.json({ items: rows.map(x=>({ ...productDto(x,rel), collectionName:x.collection_name||null })), total, page, pageSize });
  }));

  app.get("/api/admin/cms/products/:id", requireRole("read","products"), asyncHandler(async (req,res)=>{
    const id=Number(req.params.id); const row=(await pool.query("SELECT * FROM cms_products WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
    if(!row) return adminError(res,404,"Товар не найден"); const rel=await loadProductRelations(pool,[id]); res.json({ item: productDto(row,rel) });
  }));

  app.post("/api/admin/cms/products", requireRole("create","products"), asyncHandler(async (req,res)=>{
    const p = normalizeProductPayload(req.body||{}); const err = validateProductPayload(p); if(err) return adminError(res,400,err);
    const dup=await pool.query("SELECT id FROM cms_products WHERE slug=$1", [p.slug]); if(dup.rowCount) return adminError(res,409,"Slug уже используется");
    await pool.query("BEGIN");
    try {
      const ins=(await pool.query(`INSERT INTO cms_products (name,slug,type,collection_id,price,status,lead_time,metal,dimensions_json,weight,description,stone_story,care,color,occasion_json,badges_json,seo_meta_title,seo_meta_description,seo_og_image,position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19,$20) RETURNING *`, [p.name,p.slug,p.type,p.collectionId,p.price,p.status,p.leadTime,p.metal, typeof p.dimensions === "string" ? p.dimensions : JSON.stringify(p.dimensions||{}), p.weight,p.description,p.stoneStory,p.care,p.color,JSON.stringify(p.occasion||[]),JSON.stringify(p.badges||[]),p.seoMetaTitle,p.seoMetaDescription,p.seoOgImage,p.position])).rows[0];
      await writeProductRelations(pool, ins.id, p);
      await auditLog(pool, req.session[CMS_SESSION_KEY], "create", "product", ins.id, { after:{ name:p.name, slug:p.slug } });
      await pool.query("COMMIT");
      const rel=await loadProductRelations(pool,[ins.id]); res.status(201).json({ item: productDto(ins,rel) });
    } catch(e){ await pool.query("ROLLBACK"); throw e; }
  }));

  app.put("/api/admin/cms/products/:id", requireRole("update","products"), asyncHandler(async (req,res)=>{
    const id=Number(req.params.id); const current=(await pool.query("SELECT * FROM cms_products WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0]; if(!current) return adminError(res,404,"Товар не найден");
    const p=normalizeProductPayload(req.body||{}); const err=validateProductPayload(p); if(err) return adminError(res,400,err);
    const dup=await pool.query("SELECT id FROM cms_products WHERE slug=$1 AND id<>$2", [p.slug,id]); if(dup.rowCount) return adminError(res,409,"Slug уже используется");
    await pool.query("BEGIN");
    try {
      const row=(await pool.query(`UPDATE cms_products SET name=$2,slug=$3,type=$4,collection_id=$5,price=$6,status=$7,lead_time=$8,metal=$9,dimensions_json=$10::jsonb,weight=$11,description=$12,stone_story=$13,care=$14,color=$15,occasion_json=$16::jsonb,badges_json=$17::jsonb,seo_meta_title=$18,seo_meta_description=$19,seo_og_image=$20,position=$21,updated_at=NOW() WHERE id=$1 RETURNING *`, [id,p.name,p.slug,p.type,p.collectionId,p.price,p.status,p.leadTime,p.metal, typeof p.dimensions === "string" ? p.dimensions : JSON.stringify(p.dimensions||{}), p.weight,p.description,p.stoneStory,p.care,p.color,JSON.stringify(p.occasion||[]),JSON.stringify(p.badges||[]),p.seoMetaTitle,p.seoMetaDescription,p.seoOgImage,p.position])).rows[0];
      await writeProductRelations(pool, id, p);
      await auditLog(pool, req.session[CMS_SESSION_KEY], "update", "product", id, { before:{ slug: current.slug }, after:{ slug:p.slug } });
      await pool.query("COMMIT");
      const rel=await loadProductRelations(pool,[id]); res.json({ item: productDto(row,rel) });
    } catch(e){ await pool.query("ROLLBACK"); throw e; }
  }));

  app.post("/api/admin/cms/products/bulk", requireRole("bulk","products"), asyncHandler(async (req,res)=>{
    const ids=arr(req.body?.ids).map(Number).filter(Number.isFinite); const action=String(req.body?.action||""); if(!ids.length) return adminError(res,400,"Нужны ids");
    if(action==="publish") await pool.query("UPDATE cms_products SET status='published',updated_at=NOW() WHERE id=ANY($1::bigint[])",[ids]);
    else if(action==="archive") await pool.query("UPDATE cms_products SET status='archived',updated_at=NOW() WHERE id=ANY($1::bigint[])",[ids]);
    else if(action==="delete") await pool.query("UPDATE cms_products SET deleted_at=NOW(),status='archived',updated_at=NOW() WHERE id=ANY($1::bigint[])",[ids]);
    else return adminError(res,400,"Неизвестное bulk-действие");
    await auditLog(pool, req.session[CMS_SESSION_KEY], "bulk", "product", ids.join(","), { action, ids });
    res.json({ok:true});
  }));

  app.delete("/api/admin/cms/products/:id", requireRole("delete","products"), asyncHandler(async (req,res)=>{
    const id=Number(req.params.id); const r=await pool.query("UPDATE cms_products SET deleted_at=NOW(),status='archived',updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING id", [id]);
    if(!r.rowCount) return adminError(res,404,"Товар не найден"); await auditLog(pool, req.session[CMS_SESSION_KEY], "delete", "product", id, { softDelete:true }); res.json({ok:true});
  }));

  function registerSimpleEntity(cfg){
    const base = `/api/admin/cms/${cfg.base}`;
    app.get(base, requireRole("read", cfg.rbac), asyncHandler(async (req,res)=>{
      const result = await listEntity(pool, cfg.table, req, cfg.listOptions); res.json({ ...result, items: cfg.mapList ? cfg.mapList(result.items) : result.items });
    }));
    app.get(`${base}/:id`, requireRole("read", cfg.rbac), asyncHandler(async (req,res)=>{
      const q=await pool.query(`SELECT * FROM ${cfg.table} WHERE id=$1 ${cfg.softDelete ? "AND deleted_at IS NULL" : ""}`, [Number(req.params.id)]);
      if(!q.rowCount) return adminError(res,404,"Не найдено"); res.json({ item: cfg.mapOne ? cfg.mapOne(q.rows[0]) : q.rows[0] });
    }));
    app.post(base, requireRole("create", cfg.rbac), asyncHandler(async (req,res)=>{
      const p=cfg.normalize(req.body||{}); const e=cfg.validate?.(p); if(e) return adminError(res,400,e); const row=await cfg.insert(pool,p,req); await auditLog(pool, req.session[CMS_SESSION_KEY], "create", cfg.rbac, row.id, { after:p }); res.status(201).json({ item: cfg.mapOne ? cfg.mapOne(row) : row });
    }));
    app.put(`${base}/:id`, requireRole("update", cfg.rbac), asyncHandler(async (req,res)=>{
      const id=Number(req.params.id); const p=cfg.normalize(req.body||{}); const e=cfg.validate?.(p); if(e) return adminError(res,400,e); const row=await cfg.update(pool,id,p,req); if(!row) return adminError(res,404,"Не найдено"); await auditLog(pool, req.session[CMS_SESSION_KEY], "update", cfg.rbac, id, { after:p }); res.json({ item: cfg.mapOne ? cfg.mapOne(row) : row });
    }));
    app.delete(`${base}/:id`, requireRole("delete", cfg.rbac), asyncHandler(async (req,res)=>{
      const id=Number(req.params.id); const ok=await cfg.remove(pool,id,req); if(!ok) return adminError(res,404,"Не найдено"); await auditLog(pool, req.session[CMS_SESSION_KEY], "delete", cfg.rbac, id, { softDelete: !!cfg.softDelete }); res.json({ok:true});
    }));
  }

  registerSimpleEntity({
    base:"stones", table:"cms_stones", rbac:"stones", softDelete:true,
    listOptions:{ softDelete:true, searchColumns:["name","slug","description"], sortBy:"position" },
    normalize:(b)=>({ name:String(b.name||"").trim(), slug:slugify(b.slug||b.name||""), description:String(b.description||"").trim(), symbolism:String(b.symbolism||"").trim(), shadesJson:JSON.stringify(arr(b.shades)), origin:String(b.origin||"").trim(), howToWear:String(b.howToWear||"").trim(), care:String(b.care||"").trim(), textureImagesJson:JSON.stringify(arr(b.textureImages)), seoMetaTitle:String(b.seoMetaTitle||"").trim(), seoMetaDescription:String(b.seoMetaDescription||"").trim(), seoOgImage:String(b.seoOgImage||"").trim(), position:Number(b.position||0)||0 }),
    validate:(p)=> !p.name ? "Название камня обязательно" : !p.slug ? "Slug обязателен" : null,
    insert: async (pool,p)=> (await pool.query(`INSERT INTO cms_stones (name,slug,description,symbolism,shades_json,origin,how_to_wear,care,texture_images_json,seo_meta_title,seo_meta_description,seo_og_image,position) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,$12,$13) RETURNING *`, [p.name,p.slug,p.description,p.symbolism,p.shadesJson,p.origin,p.howToWear,p.care,p.textureImagesJson,p.seoMetaTitle,p.seoMetaDescription,p.seoOgImage,p.position])).rows[0],
    update: async (pool,id,p)=> (await pool.query(`UPDATE cms_stones SET name=$2,slug=$3,description=$4,symbolism=$5,shades_json=$6::jsonb,origin=$7,how_to_wear=$8,care=$9,texture_images_json=$10::jsonb,seo_meta_title=$11,seo_meta_description=$12,seo_og_image=$13,position=$14,updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`, [id,p.name,p.slug,p.description,p.symbolism,p.shadesJson,p.origin,p.howToWear,p.care,p.textureImagesJson,p.seoMetaTitle,p.seoMetaDescription,p.seoOgImage,p.position])).rows[0] || null,
    remove: async (pool,id)=> (await pool.query("UPDATE cms_stones SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL", [id])).rowCount>0
  });

  registerSimpleEntity({
    base:"collections", table:"cms_collections", rbac:"collections", softDelete:true,
    listOptions:{ softDelete:true, searchColumns:["name","slug","concept","inspiration"], sortBy:"position" },
    normalize:(b)=>({ name:String(b.name||"").trim(), slug:slugify(b.slug||b.name||""), concept:String(b.concept||"").trim(), inspiration:String(b.inspiration||"").trim(), paletteJson:JSON.stringify(arr(b.palette)), keyStonesJson:JSON.stringify(arr(b.keyStones)), heroImageUrl:String(b.heroImageUrl||"").trim(), moodImageUrl:String(b.moodImageUrl||"").trim(), seoMetaTitle:String(b.seoMetaTitle||"").trim(), seoMetaDescription:String(b.seoMetaDescription||"").trim(), seoOgImage:String(b.seoOgImage||"").trim(), position:Number(b.position||0)||0 }),
    validate:(p)=> !p.name ? "Название коллекции обязательно" : !p.slug ? "Slug обязателен" : null,
    insert: async (pool,p)=> (await pool.query(`INSERT INTO cms_collections (name,slug,concept,inspiration,palette_json,key_stones_json,hero_image_url,mood_image_url,seo_meta_title,seo_meta_description,seo_og_image,position) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12) RETURNING *`, [p.name,p.slug,p.concept,p.inspiration,p.paletteJson,p.keyStonesJson,p.heroImageUrl,p.moodImageUrl,p.seoMetaTitle,p.seoMetaDescription,p.seoOgImage,p.position])).rows[0],
    update: async (pool,id,p)=> (await pool.query(`UPDATE cms_collections SET name=$2,slug=$3,concept=$4,inspiration=$5,palette_json=$6::jsonb,key_stones_json=$7::jsonb,hero_image_url=$8,mood_image_url=$9,seo_meta_title=$10,seo_meta_description=$11,seo_og_image=$12,position=$13,updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`, [id,p.name,p.slug,p.concept,p.inspiration,p.paletteJson,p.keyStonesJson,p.heroImageUrl,p.moodImageUrl,p.seoMetaTitle,p.seoMetaDescription,p.seoOgImage,p.position])).rows[0] || null,
    remove: async (pool,id)=> (await pool.query("UPDATE cms_collections SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL", [id])).rowCount>0
  });

  app.get("/api/admin/cms/reviews", requireRole("read","reviews"), asyncHandler(async (req,res)=>{
    const result = await listEntity(pool, "cms_reviews", req, { searchColumns:["name","city","text","source"], extraFilters:[{queryKey:"status",column:"status"},{queryKey:"productId",column:"product_id",cast:"int"}], sortBy:"created_at" }); res.json(result);
  }));
  app.get("/api/admin/cms/reviews/:id", requireRole("read","reviews"), asyncHandler(async (req,res)=>{
    const row = (await pool.query("SELECT * FROM cms_reviews WHERE id=$1", [Number(req.params.id)])).rows[0];
    if(!row) return adminError(res,404,"Отзыв не найден");
    res.json({ item: row });
  }));
  app.post("/api/admin/cms/reviews", requireRole("create","reviews"), asyncHandler(async (req,res)=>{
    const b=req.body||{}; const status=["pending","approved","rejected"].includes(String(b.status))?String(b.status):"pending"; const source=["site","instagram","telegram","manual"].includes(String(b.source))?String(b.source):"manual";
    const name=String(b.name||"").trim(); const text=String(b.text||"").trim();
    if(!name) return adminError(res,400,"Имя обязательно");
    if(!text) return adminError(res,400,"Текст отзыва обязателен");
    const row=(await pool.query(`INSERT INTO cms_reviews (product_id,name,city,text,photo_url,occasion,status,source,review_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [b.productId?Number(b.productId):null,name,String(b.city||"").trim(),text,String(b.photoUrl||"").trim(),String(b.occasion||"").trim(),status,source,b.reviewDate||null])).rows[0];
    await auditLog(pool, req.session[CMS_SESSION_KEY], "create", "reviews", row.id, { after:{ status } }); res.status(201).json({ item: row });
  }));
  app.put("/api/admin/cms/reviews/:id", requireRole("update","reviews"), asyncHandler(async (req,res)=>{
    const id=Number(req.params.id); const cur=(await pool.query("SELECT * FROM cms_reviews WHERE id=$1", [id])).rows[0]; if(!cur) return adminError(res,404,"Отзыв не найден");
    const nextStatus=String(req.body?.status||cur.status); if(!validateReviewStatusTransition(cur.status,nextStatus)) return adminError(res,400,"Некорректный переход статуса модерации");
    const nextName=String(req.body?.name??cur.name).trim(); const nextText=String(req.body?.text??cur.text).trim();
    if(!nextName) return adminError(res,400,"Имя обязательно");
    if(!nextText) return adminError(res,400,"Текст отзыва обязателен");
    const row=(await pool.query(`UPDATE cms_reviews SET product_id=$2,name=$3,city=$4,text=$5,photo_url=$6,occasion=$7,status=$8,source=$9,review_date=$10,updated_at=NOW() WHERE id=$1 RETURNING *`, [id, req.body?.productId ? Number(req.body.productId) : cur.product_id, nextName, String(req.body?.city??cur.city??"").trim(), nextText, String(req.body?.photoUrl??cur.photo_url??"").trim(), String(req.body?.occasion??cur.occasion??"").trim(), nextStatus, ["site","instagram","telegram","manual"].includes(String(req.body?.source||cur.source))?String(req.body?.source||cur.source):cur.source, req.body?.reviewDate || cur.review_date])).rows[0];
    await auditLog(pool, req.session[CMS_SESSION_KEY], "update", "reviews", id, { before:{ status:cur.status }, after:{ status:nextStatus } }); res.json({ item: row });
  }));
  app.post("/api/admin/cms/reviews/bulk", requireRole("moderate","reviews"), asyncHandler(async (req,res)=>{ const ids=arr(req.body?.ids).map(Number).filter(Number.isFinite); const action=String(req.body?.action||""); const status = action==="approve"?"approved":action==="reject"?"rejected":null; if(!ids.length || !status) return adminError(res,400,"Некорректный bulk запрос"); const existing=(await pool.query("SELECT id,status FROM cms_reviews WHERE id=ANY($1::bigint[])",[ids])).rows; const invalid=existing.filter((x)=>!validateReviewStatusTransition(x.status,status)).map((x)=>x.id); if(invalid.length) return adminError(res,400,"Некорректный переход статуса модерации", { ids: invalid, toStatus: status }); await pool.query("UPDATE cms_reviews SET status=$2,updated_at=NOW() WHERE id=ANY($1::bigint[])",[ids,status]); await auditLog(pool, req.session[CMS_SESSION_KEY], "bulk", "reviews", ids.join(","), { action, ids }); res.json({ok:true}); }));
  app.delete("/api/admin/cms/reviews/:id", requireRole("delete","reviews"), asyncHandler(async (req,res)=>{ const id=Number(req.params.id); const r=await pool.query("DELETE FROM cms_reviews WHERE id=$1 RETURNING id", [id]); if(!r.rowCount) return adminError(res,404,"Отзыв не найден"); await auditLog(pool, req.session[CMS_SESSION_KEY], "delete", "reviews", id, {}); res.json({ok:true}); }));

  app.get("/api/admin/cms/pages", requireRole("read","pages"), asyncHandler(async (req,res)=>{ res.json(await listEntity(pool, "cms_pages", req, { searchColumns:["slug","title","content_markdown"], sortBy:"updated_at" })); }));
  app.get("/api/admin/cms/pages/:id", requireRole("read","pages"), asyncHandler(async (req,res)=>{ const row=(await pool.query("SELECT * FROM cms_pages WHERE id=$1", [Number(req.params.id)])).rows[0]; if(!row) return adminError(res,404,"Страница не найдена"); res.json({item:row}); }));
  app.post("/api/admin/cms/pages", requireRole("create","pages"), asyncHandler(async (req,res)=>{
    const b=req.body||{}; const title=String(b.title||"").trim(); const slug=slugify(b.slug||b.title||"");
    if(!title) return adminError(res,400,"Название страницы обязательно");
    if(!slug) return adminError(res,400,"Slug обязателен");
    const row=(await pool.query(`INSERT INTO cms_pages (slug,title,content_markdown,seo_meta_title,seo_meta_description,seo_og_image,updated_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [slug, title, String(b.contentMarkdown||"").trim(), String(b.seoMetaTitle||""), String(b.seoMetaDescription||""), String(b.seoOgImage||""), req.session[CMS_SESSION_KEY].id])).rows[0];
    await auditLog(pool, req.session[CMS_SESSION_KEY], "create", "pages", row.id, { slug: row.slug }); res.status(201).json({item:row});
  }));
  app.put("/api/admin/cms/pages/:id", requireRole("update","pages"), asyncHandler(async (req,res)=>{
    const id=Number(req.params.id); const b=req.body||{}; const title=String(b.title||"").trim(); const slug=slugify(b.slug||b.title||"");
    if(!title) return adminError(res,400,"Название страницы обязательно");
    if(!slug) return adminError(res,400,"Slug обязателен");
    const row=(await pool.query(`UPDATE cms_pages SET slug=$2,title=$3,content_markdown=$4,seo_meta_title=$5,seo_meta_description=$6,seo_og_image=$7,updated_by_user_id=$8,updated_at=NOW() WHERE id=$1 RETURNING *`, [id, slug, title, String(b.contentMarkdown||"").trim(), String(b.seoMetaTitle||""), String(b.seoMetaDescription||""), String(b.seoOgImage||""), req.session[CMS_SESSION_KEY].id])).rows[0];
    if(!row) return adminError(res,404,"Страница не найдена"); await auditLog(pool, req.session[CMS_SESSION_KEY], "update", "pages", id, { slug: row.slug }); res.json({item:row});
  }));
  app.delete("/api/admin/cms/pages/:id", requireRole("delete","pages"), asyncHandler(async (req,res)=>{ const id=Number(req.params.id); const r=await pool.query("DELETE FROM cms_pages WHERE id=$1 RETURNING id", [id]); if(!r.rowCount) return adminError(res,404,"Страница не найдена"); await auditLog(pool, req.session[CMS_SESSION_KEY], "delete", "pages", id, {}); res.json({ok:true}); }));

  app.get("/api/admin/cms/settings", requireRole("settings","settings"), asyncHandler(async (_req,res)=>{ res.json({ items:(await pool.query("SELECT * FROM cms_settings ORDER BY key")).rows }); }));
  app.put("/api/admin/cms/settings/:key", requireRole("settings","settings"), asyncHandler(async (req,res)=>{ const key=String(req.params.key); const val=req.body?.value ?? req.body ?? {}; const row=(await pool.query(`INSERT INTO cms_settings (key,value_json,updated_by_user_id,updated_at) VALUES ($1,$2::jsonb,$3,NOW()) ON CONFLICT (key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW() RETURNING *`, [key, JSON.stringify(val), req.session[CMS_SESSION_KEY].id])).rows[0]; await auditLog(pool, req.session[CMS_SESSION_KEY], "update", "settings", key, { key }); res.json({item:row}); }));

  app.get("/api/admin/cms/media", requireRole("read","media"), asyncHandler(async (req,res)=>{ res.json(await listEntity(pool, "cms_media", req, { searchColumns:["original_name","file_name","mime_type"], sortBy:"created_at" })); }));
  app.post("/api/admin/cms/media/upload", requireRole("create","media"), upload.array("files", 20), asyncHandler(async (req,res)=>{
    const files=req.files||[]; if(!files.length) return adminError(res,400,"Нет файлов для загрузки"); const items=[];
    for(const file of files){
      const rel=`/uploads/cms/${file.filename}`;
      const optimized = await optimizeImageVariants(file, cmsMediaDir);
      const row=(await pool.query(
        `INSERT INTO cms_media (file_name,original_name,mime_type,storage_disk,file_path,public_url,preview_url,width,height,size_bytes,meta_json,created_by_user_id)
         VALUES ($1,$2,$3,'local',$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,
        [
          file.filename,
          file.originalname||file.filename,
          file.mimetype||"application/octet-stream",
          rel,
          optimized.originalUrl || rel,
          optimized.previewUrl || rel,
          optimized.width,
          optimized.height,
          Number(file.size||0),
          JSON.stringify(optimized.meta || {}),
          req.session[CMS_SESSION_KEY].id
        ]
      )).rows[0];
      items.push(row);
    }
    await auditLog(pool, req.session[CMS_SESSION_KEY], "create", "media", items.map(x=>x.id).join(","), { count: items.length }); res.status(201).json({ items });
  }));
  app.delete("/api/admin/cms/media/:id", requireRole("delete","media"), asyncHandler(async (req,res)=>{
    const id=Number(req.params.id); const media=(await pool.query("SELECT * FROM cms_media WHERE id=$1", [id])).rows[0]; if(!media) return adminError(res,404,"Медиа не найдено");
    const usage = await collectMediaUsage(pool, media); if(usage.length) return adminError(res,409,"Медиа используется в сущностях", { usage });
    await pool.query("DELETE FROM cms_media WHERE id=$1", [id]);
    removeMediaFiles(media, cmsMediaDir);
    await auditLog(pool, req.session[CMS_SESSION_KEY], "delete", "media", id, {}); res.json({ok:true});
  }));

  app.get("/api/admin/cms/users", requireRole("settings","settings"), asyncHandler(async (_req,res)=>{ res.json({ items:(await pool.query("SELECT id,email,role,is_active,created_at,updated_at FROM admin_users ORDER BY id")).rows }); }));
  app.post("/api/admin/cms/users", requireRole("settings","settings"), asyncHandler(async (req,res)=>{
    const email=String(req.body?.email||"").trim().toLowerCase(); const password=String(req.body?.password||""); const role=String(req.body?.role||"editor");
    const isActive=req.body?.isActive==null ? true : parseBool(req.body.isActive);
    if(!email||!password) return adminError(res,400,"Email и пароль обязательны"); if(!["admin","editor","moderator"].includes(role)) return adminError(res,400,"Некорректная роль");
    const row=(await pool.query("INSERT INTO admin_users (email,password_hash,role,is_active) VALUES ($1,$2,$3,$4) RETURNING id,email,role,is_active,created_at,updated_at", [email, hashPassword(password), role, isActive])).rows[0];
    await auditLog(pool, req.session[CMS_SESSION_KEY], "create", "users", row.id, { email, role }); res.status(201).json({ item: row });
  }));
  app.put("/api/admin/cms/users/:id", requireRole("settings","settings"), asyncHandler(async (req,res)=>{
    const id=Number(req.params.id); const cur=(await pool.query("SELECT * FROM admin_users WHERE id=$1", [id])).rows[0]; if(!cur) return adminError(res,404,"Пользователь не найден");
    const email=String(req.body?.email||cur.email).trim().toLowerCase(); const role=String(req.body?.role||cur.role); const isActive=req.body?.isActive==null ? cur.is_active : parseBool(req.body.isActive); const passHash=req.body?.password ? hashPassword(String(req.body.password)) : cur.password_hash;
    if(!["admin","editor","moderator"].includes(role)) return adminError(res,400,"Некорректная роль");
    const row=(await pool.query("UPDATE admin_users SET email=$2,role=$3,is_active=$4,password_hash=$5,updated_at=NOW() WHERE id=$1 RETURNING id,email,role,is_active,created_at,updated_at", [id,email,role,isActive,passHash])).rows[0];
    await auditLog(pool, req.session[CMS_SESSION_KEY], "update", "users", id, { email, role, isActive }); res.json({ item: row });
  }));
  app.delete("/api/admin/cms/users/:id", requireRole("settings","settings"), asyncHandler(async (req,res)=>{ const id=Number(req.params.id); if(id===req.session[CMS_SESSION_KEY].id) return adminError(res,400,"Нельзя удалить текущего пользователя"); const r=await pool.query("DELETE FROM admin_users WHERE id=$1 RETURNING id", [id]); if(!r.rowCount) return adminError(res,404,"Пользователь не найден"); await auditLog(pool, req.session[CMS_SESSION_KEY], "delete", "users", id, {}); res.json({ok:true}); }));

  app.get("/api/admin/cms/audit-log", requireRole("read","dashboard"), asyncHandler(async (req,res)=>{ const {page,pageSize,offset}=paged(req.query); const total=(await pool.query("SELECT COUNT(*)::int AS count FROM audit_log")).rows[0].count; const rows=(await pool.query("SELECT * FROM audit_log ORDER BY id DESC LIMIT $1 OFFSET $2", [pageSize,offset])).rows; res.json({ items:rows, total, page, pageSize }); }));

  app.use("/api/admin/cms", (err,_req,res,_next)=>{ if(err?.code==="LIMIT_FILE_SIZE") return adminError(res,400,"Файл слишком большой"); if(err?.code==="23505") return adminError(res,409,"Значение уже существует", { constraint: err.constraint || null }); if(err?.code==="23503") return adminError(res,400,"Связанная сущность не найдена", { constraint: err.constraint || null }); if(err?.code==="22P02") return adminError(res,400,"Некорректный формат данных"); console.error(err); return adminError(res,500,err?.message||"Ошибка API"); });
}

module.exports = { registerCmsRoutes };




