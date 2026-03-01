import json, os, secrets
from pathlib import Path
from datetime import date
from flask import Flask, jsonify, request, send_from_directory, session
from psycopg import connect
from psycopg.rows import dict_row
from psycopg.types.json import Json
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.exceptions import HTTPException
from werkzeug.utils import secure_filename

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / 'public'
UPLOADS = ROOT / 'uploads'
DATA = ROOT / 'data' / 'products.json'
PORT = int(os.getenv('PORT', '3000'))
DB = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@postgres:5432/jewelry_shop')
ADMIN_EMAIL = (os.getenv('ADMIN_EMAIL') or 'admin@example.com').strip().lower()
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD') or 'super-secret-password'
SESSION_SECRET = os.getenv('SESSION_SECRET') or 'replace-with-long-random-secret'

PERMS = {
  'admin': {'*': {'read','create','update','delete','moderate'}},
  'editor': {
    'products': {'read','create','update'},
    'stones': {'read','create','update'},
    'collections': {'read','create','update'},
    'reviews': {'read','create','update'},
    'users': {'read'},
    'dashboard': {'read'},
    'lookups': {'read'}
  },
  'moderator': {'reviews': {'read','update','moderate'}, 'dashboard': {'read'}, 'lookups': {'read'}}
}

def conn():
  return connect(DB, row_factory=dict_row)

def ok(v):
  return jsonify(v)

def err(msg, code=400):
  return jsonify({'error': msg}), code

def j(v,d):
  if v is None: return d
  if isinstance(v,(dict,list)): return v
  try: return json.loads(v)
  except Exception: return d

def b(v):
  if isinstance(v,bool): return v
  return str(v or '').strip().lower() in {'1','true','yes','on'}

def slug(v):
  s=''.join(ch.lower() if ch.isalnum() else '-' for ch in str(v or ''))
  while '--' in s: s=s.replace('--','-')
  return s.strip('-')

def can(role, action, entity):
  g=PERMS.get(role,{})
  return action in g.get('*',set()) or action in g.get(entity,set())

def auth():
  u=session.get('cms_user')
  if not u: return None, err('Требуется вход в админку',401)
  return u, None

def perm(action, entity):
  u,e=auth()
  if e: return None,e
  if not can(u.get('role'),action,entity): return None, err('Недостаточно прав',403)
  return u,None

def csrf():
  if request.method in {'GET','HEAD','OPTIONS'}: return None
  t=session.get('cms_csrf'); h=request.headers.get('x-csrf-token')
  if not t or not h or t!=h: return err('CSRF token invalid',403)
  return None

def normalize_product(p):
  stones = j(p.get('stoneIds'),[]) if isinstance(p.get('stoneIds'),str) else (p.get('stoneIds') or [])
  images = j(p.get('images'),[]) if isinstance(p.get('images'),str) else (p.get('images') or [])
  vars_ = j(p.get('variations'),[]) if isinstance(p.get('variations'),str) else (p.get('variations') or [])
  return {
    'name': str(p.get('name') or '').strip(),
    'slug': str(p.get('slug') or slug(p.get('name'))).strip(),
    'type': str(p.get('type') or '').strip(),
    'collectionId': int(p.get('collectionId')) if str(p.get('collectionId') or '').isdigit() else None,
    'price': int(float(p.get('price') or 0)),
    'status': str(p.get('status') or 'draft').strip(),
    'description': str(p.get('description') or '').strip(),
    'dimensions': p.get('dimensions') or {},
    'stoneIds': [int(x) for x in stones if str(x).isdigit()],
    'images': [x for x in images if isinstance(x,dict) and str(x.get('url') or '').strip()],
    'variations': [x for x in vars_ if isinstance(x,dict) and str(x.get('label') or '').strip()]
  }

def review_transition(old, new):
  allow={'pending':{'pending','approved','rejected'},'approved':{'approved'},'rejected':{'rejected','approved'}}
  return new in allow.get(old,{old})

def audit(c, user, action, entity, entity_id=None, payload=None):
  if not user: return
  with c.cursor() as cur:
    cur.execute('INSERT INTO audit_log (user_id,action,entity,entity_id,payload_json) VALUES (%s,%s,%s,%s,%s)',
      (user.get('id'), action, entity, entity_id, Json(payload or {})))

def init_db():
  UPLOADS.mkdir(parents=True, exist_ok=True)
  (UPLOADS / 'cms').mkdir(parents=True, exist_ok=True)
  with conn() as c:
    with c.cursor() as cur:
      cur.execute('''
      CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY,name TEXT NOT NULL,stone TEXT NOT NULL,price INTEGER NOT NULL,image_url TEXT,description TEXT NOT NULL,in_stock BOOLEAN NOT NULL DEFAULT TRUE,featured BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY,value JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_users (id BIGSERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'admin',is_active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS cms_stones (id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,slug TEXT UNIQUE NOT NULL,description TEXT DEFAULT '',symbolism TEXT DEFAULT '',shades_json JSONB NOT NULL DEFAULT '[]'::jsonb,texture_images_json JSONB NOT NULL DEFAULT '[]'::jsonb,position INTEGER NOT NULL DEFAULT 0,deleted_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS cms_collections (id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,slug TEXT UNIQUE NOT NULL,concept TEXT DEFAULT '',inspiration TEXT DEFAULT '',palette_json JSONB NOT NULL DEFAULT '[]'::jsonb,key_stones_json JSONB NOT NULL DEFAULT '[]'::jsonb,position INTEGER NOT NULL DEFAULT 0,deleted_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS cms_products (id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,slug TEXT UNIQUE NOT NULL,type TEXT NOT NULL,collection_id BIGINT REFERENCES cms_collections(id),price INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'draft',description TEXT DEFAULT '',dimensions_json JSONB NOT NULL DEFAULT '{}'::jsonb,deleted_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS cms_product_stones (product_id BIGINT NOT NULL REFERENCES cms_products(id) ON DELETE CASCADE,stone_id BIGINT NOT NULL REFERENCES cms_stones(id),position INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS cms_product_variations (id BIGSERIAL PRIMARY KEY,product_id BIGINT NOT NULL REFERENCES cms_products(id) ON DELETE CASCADE,variation_key TEXT NOT NULL,label TEXT NOT NULL,price_delta INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS cms_product_images (id BIGSERIAL PRIMARY KEY,product_id BIGINT NOT NULL REFERENCES cms_products(id) ON DELETE CASCADE,url TEXT NOT NULL,alt TEXT DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,is_cover BOOLEAN NOT NULL DEFAULT FALSE);
      CREATE TABLE IF NOT EXISTS cms_reviews (id BIGSERIAL PRIMARY KEY,product_id BIGINT REFERENCES cms_products(id),name TEXT NOT NULL,city TEXT DEFAULT '',text TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',source TEXT NOT NULL DEFAULT 'manual',occasion TEXT DEFAULT '',photo_url TEXT DEFAULT '',review_date DATE,deleted_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS cms_pages (id BIGSERIAL PRIMARY KEY,title TEXT NOT NULL,slug TEXT UNIQUE NOT NULL,content_markdown TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'published',seo_meta_title TEXT DEFAULT '',seo_meta_description TEXT DEFAULT '',seo_og_image TEXT DEFAULT '',deleted_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS cms_settings (key TEXT PRIMARY KEY,value_json JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS cms_media (id BIGSERIAL PRIMARY KEY,original_name TEXT NOT NULL,public_url TEXT NOT NULL,preview_url TEXT NOT NULL,size_bytes BIGINT NOT NULL DEFAULT 0,file_path TEXT NOT NULL,meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS audit_log (id BIGSERIAL PRIMARY KEY,user_id BIGINT,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT,payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      ''')
      cur.execute('INSERT INTO site_settings (key,value) VALUES (%s,%s) ON CONFLICT (key) DO NOTHING', ('heroCollection', Json({'badge':'Новая коллекция','title':'Северный свет','description':'Опал, лунный камень, кварц и серебро в спокойной палитре.','stones':['Опал','Агат','Турмалин','Кварц']})))
      cur.execute('SELECT COUNT(*) AS c FROM products')
      if (cur.fetchone() or {}).get('c',0)==0 and DATA.exists():
        p=json.loads(DATA.read_text(encoding='utf-8'))
        for it in p.get('items',[]):
          cur.execute('INSERT INTO products (id,name,stone,price,image_url,description,in_stock,featured) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING',
            (int(it.get('id') or 0) or None, str(it.get('name') or '').strip(), str(it.get('stone') or '').strip(), int(it.get('price') or 0), str(it.get('imageUrl') or '') or None, str(it.get('description') or '').strip(), b(it.get('inStock')), b(it.get('featured'))))
      cur.execute("INSERT INTO cms_settings (key,value_json,updated_at) VALUES (%s,%s,NOW()) ON CONFLICT (key) DO NOTHING", (
        'site',
        Json({
          'brandName': 'Stone Atelier',
          'contacts': {'email': 'hello@stoneatelier.local', 'telegram': '@stoneatelier'},
          'seoDefaults': {'title': '', 'description': '', 'ogImage': ''},
          'homepage': {'heroCollectionSlug': '', 'heroBadge': 'Новая коллекция'},
          'featureFlags': {'showProcess': True, 'showReviews': True, 'showStoneGuide': True},
          'orderCta': {
            'primaryLabel': 'Заказать',
            'secondaryLabel': 'Запросить',
            'primaryHref': '/policies/custom-order?source=primary&product={slug}',
            'secondaryHref': '/policies/custom-order?source=secondary&product={slug}'
          }
        })
      ))
      cur.execute("SELECT COUNT(*) AS c FROM cms_collections WHERE deleted_at IS NULL")
      if int((cur.fetchone() or {}).get('c') or 0) == 0:
        cur.execute("INSERT INTO cms_collections (name,slug,concept,inspiration,palette_json,key_stones_json,position) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",
          ('Базовая коллекция', 'base-collection', 'Тестовая коллекция', 'Автосид из products', Json(['нейтральный']), Json([]), 0))
        collection_id = cur.fetchone()['id']
        cur.execute("SELECT COUNT(*) AS c FROM cms_stones WHERE deleted_at IS NULL")
        if int((cur.fetchone() or {}).get('c') or 0) == 0:
          cur.execute("SELECT DISTINCT stone FROM products WHERE TRIM(COALESCE(stone,'')) <> '' ORDER BY 1")
          for idx, row in enumerate(cur.fetchall()):
            stone_name = str(row.get('stone') or '').strip()
            cur.execute("INSERT INTO cms_stones (name,slug,description,symbolism,shades_json,texture_images_json,position) VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (slug) DO NOTHING",
              (stone_name, slug(stone_name), '', '', Json([]), Json([]), idx))
        cur.execute("SELECT COUNT(*) AS c FROM cms_products WHERE deleted_at IS NULL")
        if int((cur.fetchone() or {}).get('c') or 0) == 0:
          cur.execute("SELECT id,name,stone,price,image_url,description,in_stock,featured FROM products ORDER BY id")
          products_seed = cur.fetchall()
          for idx, row in enumerate(products_seed):
            name = str(row.get('name') or '').strip()
            slug_val = slug(name) or f"product-{row['id']}"
            status = 'published' if bool(row.get('in_stock')) else 'draft'
            cur.execute("INSERT INTO cms_products (name,slug,type,collection_id,price,status,description,dimensions_json,position) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
              (name, slug_val, 'украшение', collection_id, int(row.get('price') or 0), status, str(row.get('description') or ''), Json({}), idx))
            cms_product_id = cur.fetchone()['id']
            image_url = str(row.get('image_url') or '').strip()
            if image_url:
              cur.execute("INSERT INTO cms_product_images (product_id,url,alt,sort_order,is_cover) VALUES (%s,%s,%s,%s,%s)",
                (cms_product_id, image_url, name, 0, True))
            stone_name = str(row.get('stone') or '').strip()
            if stone_name:
              cur.execute("SELECT id FROM cms_stones WHERE slug=%s AND deleted_at IS NULL", (slug(stone_name),))
              stone_row = cur.fetchone()
              if stone_row:
                cur.execute("INSERT INTO cms_product_stones (product_id,stone_id,position) VALUES (%s,%s,%s)",
                  (cms_product_id, stone_row['id'], 0))
      cur.execute('SELECT id FROM admin_users WHERE email=%s', (ADMIN_EMAIL,))
      if not cur.fetchone():
        cur.execute('INSERT INTO admin_users (email,password_hash,role,is_active) VALUES (%s,%s,%s,TRUE)', (ADMIN_EMAIL, generate_password_hash(ADMIN_PASSWORD), 'admin'))
    c.commit()
def rels(c, ids):
  if not ids: return {},{},{}
  ids=list({int(x) for x in ids})
  with c.cursor() as cur:
    cur.execute('SELECT ps.product_id,ps.stone_id,s.name,s.slug FROM cms_product_stones ps JOIN cms_stones s ON s.id=ps.stone_id WHERE ps.product_id = ANY(%s::bigint[]) ORDER BY ps.position,s.id', (ids,)); a=cur.fetchall()
    cur.execute('SELECT product_id,id,variation_key,label,price_delta,sort_order FROM cms_product_variations WHERE product_id = ANY(%s::bigint[]) ORDER BY sort_order,id', (ids,)); b_=cur.fetchall()
    cur.execute('SELECT product_id,id,url,alt,sort_order,is_cover FROM cms_product_images WHERE product_id = ANY(%s::bigint[]) ORDER BY sort_order,id', (ids,)); c_=cur.fetchall()
  s,v,i={},{},{}
  for r in a: s.setdefault(str(r['product_id']),[]).append({'id':r['stone_id'],'name':r['name'],'slug':r['slug']})
  for r in b_: v.setdefault(str(r['product_id']),[]).append({'id':r['id'],'variationKey':r['variation_key'],'label':r['label'],'priceDelta':int(r.get('price_delta') or 0),'sortOrder':int(r.get('sort_order') or 0)})
  for r in c_: i.setdefault(str(r['product_id']),[]).append({'id':r['id'],'url':r['url'],'alt':r.get('alt') or '','sortOrder':int(r.get('sort_order') or 0),'isCover':bool(r.get('is_cover'))})
  return s,v,i

def dto(r,s,v,i):
  k=str(r['id'])
  return {
    'id':r['id'],'name':r['name'],'slug':r['slug'],'type':r['type'],'collectionId':r.get('collection_id'),'price':int(r.get('price') or 0),'status':r.get('status') or 'draft',
    'description':r.get('description') or '','dimensions':j(r.get('dimensions_json'),{}),'stones':s.get(k,[]),'variations':v.get(k,[]),'images':i.get(k,[]),
    'createdAt':str(r.get('created_at') or ''),'updatedAt':str(r.get('updated_at') or '')
  }

def save_rels(c, pid, p):
  with c.cursor() as cur:
    cur.execute('DELETE FROM cms_product_stones WHERE product_id=%s', (pid,))
    for idx,sid in enumerate(p['stoneIds']): cur.execute('INSERT INTO cms_product_stones (product_id,stone_id,position) VALUES (%s,%s,%s)', (pid,sid,idx))
    cur.execute('DELETE FROM cms_product_variations WHERE product_id=%s', (pid,))
    for idx,v in enumerate(p['variations']):
      cur.execute('INSERT INTO cms_product_variations (product_id,variation_key,label,price_delta,sort_order) VALUES (%s,%s,%s,%s,%s)',
        (pid, str(v.get('id') or v.get('variationKey') or f'var-{idx+1}'), str(v.get('label') or '').strip(), int(v.get('priceDelta') or 0), int(v.get('sortOrder') or idx)))
    cur.execute('DELETE FROM cms_product_images WHERE product_id=%s', (pid,))
    cover=False
    for idx,img in enumerate(p['images']):
      ic=bool(img.get('isCover'))
      if not cover and (ic or idx==0): ic=True; cover=True
      cur.execute('INSERT INTO cms_product_images (product_id,url,alt,sort_order,is_cover) VALUES (%s,%s,%s,%s,%s)',
        (pid, str(img.get('url') or '').strip(), str(img.get('alt') or '').strip(), int(img.get('sortOrder') or idx), ic))

def app_factory():
  app=Flask(__name__, static_folder=str(PUBLIC), static_url_path='')
  app.secret_key=SESSION_SECRET

  @app.before_request
  def secure_admin_api():
    if not request.path.startswith('/api/admin/cms') or request.path.startswith('/api/admin/cms/auth/'): return None
    if not session.get('cms_user'): return err('Требуется вход в админку',401)
    c=csrf()
    if c: return c
    return None

  @app.get('/')
  def home(): return send_from_directory(str(PUBLIC), 'index.html')
  @app.get('/catalog')
  def page_catalog(): return send_from_directory(str(PUBLIC), 'catalog.html')
  @app.get('/products/<slug_>')
  def page_product(slug_): return send_from_directory(str(PUBLIC), 'product.html')
  @app.get('/stones/<slug_>')
  def page_stone(slug_): return send_from_directory(str(PUBLIC), 'stone.html')
  @app.get('/collections/<slug_>')
  def page_collection(slug_): return send_from_directory(str(PUBLIC), 'collection.html')
  @app.get('/about')
  def page_about(): return send_from_directory(str(PUBLIC), 'about.html')
  @app.get('/size-guide')
  def page_size(): return send_from_directory(str(PUBLIC), 'size-guide.html')
  @app.get('/packaging')
  def page_pack(): return send_from_directory(str(PUBLIC), 'packaging.html')
  @app.get('/policies/<slug_>')
  def page_policy(slug_): return send_from_directory(str(PUBLIC), 'policy.html')
  @app.get('/admin')
  def page_admin(): return send_from_directory(str(PUBLIC), 'admin-panel.html')
  @app.get('/uploads/<path:filename>')
  def uploads(filename): return send_from_directory(str(UPLOADS), filename)

  @app.get('/api/products')
  def api_products():
    with conn() as c:
      with c.cursor() as cur:
        cur.execute('SELECT id,name,stone,price,image_url,description,in_stock,featured FROM products ORDER BY featured DESC,id DESC')
        items=[{'id':r['id'],'name':r['name'],'stone':r['stone'],'price':int(r['price'] or 0),'imageUrl':r.get('image_url') or '','description':r.get('description') or '','inStock':bool(r.get('in_stock')),'featured':bool(r.get('featured'))} for r in cur.fetchall()]
        cur.execute('SELECT value FROM site_settings WHERE key=%s', ('heroCollection',)); row=cur.fetchone(); hero=j((row or {}).get('value'),{})
    return ok({'items':items,'heroCollection':hero})

  @app.post('/api/admin/cms/auth/login')
  def login():
    p=request.get_json(silent=True) or {}
    email=str(p.get('email') or '').strip().lower(); pwd=str(p.get('password') or '')
    if not email or not pwd: return err('Email и пароль обязательны')
    with conn() as c:
      with c.cursor() as cur:
        cur.execute('SELECT id,email,password_hash,role,is_active FROM admin_users WHERE email=%s', (email,)); u=cur.fetchone()
    if not u or not u.get('is_active') or not check_password_hash(u['password_hash'], pwd): return err('Неверные учетные данные',401)
    token=secrets.token_urlsafe(24)
    session['cms_user']={'id':u['id'],'email':u['email'],'role':u['role']}; session['cms_csrf']=token
    return ok({'user':session['cms_user'],'csrfToken':token})

  @app.get('/api/admin/cms/auth/me')
  def me():
    u,e=auth();
    if e: return e
    if not session.get('cms_csrf'): session['cms_csrf']=secrets.token_urlsafe(24)
    return ok({'user':u,'csrfToken':session['cms_csrf']})

  @app.post('/api/admin/cms/auth/logout')
  def logout():
    _,e=auth();
    if e: return e
    c=csrf();
    if c: return c
    session.pop('cms_user',None); session.pop('cms_csrf',None)
    return ok({'ok':True})

  @app.get('/api/admin/cms/dashboard')
  def dashboard():
    _,e=perm('read','dashboard')
    if e: return e
    with conn() as c:
      with c.cursor() as cur:
        cur.execute('SELECT COUNT(*) AS c FROM cms_products WHERE deleted_at IS NULL'); p=int((cur.fetchone() or {}).get('c') or 0)
        cur.execute('SELECT COUNT(*) AS c FROM cms_stones WHERE deleted_at IS NULL'); s_=int((cur.fetchone() or {}).get('c') or 0)
        cur.execute('SELECT COUNT(*) AS c FROM cms_collections WHERE deleted_at IS NULL'); c_=int((cur.fetchone() or {}).get('c') or 0)
        cur.execute("SELECT COUNT(*) AS c FROM cms_reviews WHERE deleted_at IS NULL AND status='pending'"); r_=int((cur.fetchone() or {}).get('c') or 0)
    return ok({'counters':{'products':p,'stones':s_,'collections':c_,'reviewsPending':r_}})

  @app.get('/api/admin/cms/lookups')
  def lookups():
    _,e=perm('read','lookups')
    if e: return e
    can_users=can(session.get('cms_user',{}).get('role'),'read','users')
    with conn() as c:
      with c.cursor() as cur:
        cur.execute('SELECT id,name,slug FROM cms_stones WHERE deleted_at IS NULL ORDER BY position,id'); stones=cur.fetchall()
        cur.execute('SELECT id,name,slug FROM cms_collections WHERE deleted_at IS NULL ORDER BY position,id'); cols=cur.fetchall()
        cur.execute('SELECT id,name,slug,status FROM cms_products WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1000'); products=cur.fetchall()
        users=[]
        if can_users: cur.execute('SELECT id,email,role,is_active FROM admin_users ORDER BY id'); users=cur.fetchall()
    return ok({'stones':stones,'collections':cols,'products':products,'media':[],'users':users})
  @app.route('/api/admin/cms/users', methods=['GET','POST'])
  def users_root():
    if request.method=='GET':
      _,e=perm('read','users')
      if e: return e
      with conn() as c:
        with c.cursor() as cur: cur.execute('SELECT id,email,role,is_active,created_at FROM admin_users ORDER BY id'); items=cur.fetchall()
      return ok({'items':items})
    u,e=perm('create','users')
    if e: return e
    p=request.get_json(silent=True) or {}
    email=str(p.get('email') or '').strip().lower(); pwd=str(p.get('password') or ''); role=str(p.get('role') or 'editor')
    if not email or not pwd: return err('email и password обязательны')
    with conn() as c:
      with c.cursor() as cur:
        cur.execute('INSERT INTO admin_users (email,password_hash,role,is_active) VALUES (%s,%s,%s,TRUE) RETURNING id,email,role,is_active', (email,generate_password_hash(pwd),role)); item=cur.fetchone()
        audit(c,u,'create','users',str(item['id']),{'email':email,'role':role})
      c.commit()
    return ok({'item':item})

  @app.route('/api/admin/cms/users/<int:item_id>', methods=['PUT','DELETE'])
  def users_item(item_id):
    if request.method=='PUT':
      u,e=perm('update','users')
      if e: return e
      p=request.get_json(silent=True) or {}
      with conn() as c:
        with c.cursor() as cur:
          if p.get('password'):
            cur.execute('UPDATE admin_users SET email=%s,role=%s,is_active=%s,password_hash=%s,updated_at=NOW() WHERE id=%s RETURNING id,email,role,is_active',
              (str(p.get('email') or '').strip().lower(),str(p.get('role') or 'editor'),b(p.get('isActive',True)),generate_password_hash(str(p.get('password'))),item_id))
          else:
            cur.execute('UPDATE admin_users SET email=%s,role=%s,is_active=%s,updated_at=NOW() WHERE id=%s RETURNING id,email,role,is_active',
              (str(p.get('email') or '').strip().lower(),str(p.get('role') or 'editor'),b(p.get('isActive',True)),item_id))
          item=cur.fetchone()
          if not item: return err('Пользователь не найден',404)
          audit(c,u,'update','users',str(item_id),p)
        c.commit()
      return ok({'item':item})
    u,e=perm('delete','users')
    if e: return e
    with conn() as c:
      with c.cursor() as cur:
        cur.execute('DELETE FROM admin_users WHERE id=%s', (item_id,))
        if cur.rowcount==0: return err('Пользователь не найден',404)
        audit(c,u,'delete','users',str(item_id))
      c.commit()
    return ok({'ok':True})

  def list_simple(table):
    search=str(request.args.get('search') or '').strip(); page=max(1,int(request.args.get('page') or 1)); size=max(1,min(100,int(request.args.get('pageSize') or 20))); off=(page-1)*size
    with conn() as c:
      with c.cursor() as cur:
        if search:
          like=f'%{search}%'; cur.execute(f'SELECT COUNT(*) AS c FROM {table} WHERE deleted_at IS NULL AND (name ILIKE %s OR slug ILIKE %s)', (like,like)); total=int((cur.fetchone() or {}).get('c') or 0)
          cur.execute(f'SELECT * FROM {table} WHERE deleted_at IS NULL AND (name ILIKE %s OR slug ILIKE %s) ORDER BY position,id DESC LIMIT %s OFFSET %s', (like,like,size,off)); items=cur.fetchall()
        else:
          cur.execute(f'SELECT COUNT(*) AS c FROM {table} WHERE deleted_at IS NULL'); total=int((cur.fetchone() or {}).get('c') or 0)
          cur.execute(f'SELECT * FROM {table} WHERE deleted_at IS NULL ORDER BY position,id DESC LIMIT %s OFFSET %s', (size,off)); items=cur.fetchall()
    return ok({'items':items,'total':total,'page':page,'pageSize':size})

  @app.route('/api/admin/cms/stones', methods=['GET','POST'])
  def stones_root():
    if request.method=='GET':
      _,e=perm('read','stones');
      if e: return e
      return list_simple('cms_stones')
    u,e=perm('create','stones')
    if e: return e
    p=request.get_json(silent=True) or {}
    name=str(p.get('name') or '').strip(); sl=str(p.get('slug') or slug(name)).strip()
    if not name or not sl: return err('name и slug обязательны')
    with conn() as c:
      with c.cursor() as cur:
        cur.execute('INSERT INTO cms_stones (name,slug,description,symbolism,shades_json,texture_images_json,position) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *',
          (name,sl,str(p.get('description') or ''),str(p.get('symbolism') or ''),Json(p.get('shades') or []),Json(p.get('textureImages') or []),int(p.get('position') or 0))); item=cur.fetchone(); audit(c,u,'create','stones',str(item['id']),{'name':name})
      c.commit()
    return ok({'item':item})

  @app.route('/api/admin/cms/stones/<int:item_id>', methods=['GET','PUT','DELETE'])
  def stones_item(item_id):
    if request.method=='GET':
      _,e=perm('read','stones');
      if e: return e
      with conn() as c:
        with c.cursor() as cur:
          cur.execute('SELECT * FROM cms_stones WHERE id=%s AND deleted_at IS NULL', (item_id,)); item=cur.fetchone()
      if not item: return err('Камень не найден',404)
      return ok({'item':item})
    if request.method=='PUT':
      u,e=perm('update','stones');
      if e: return e
      p=request.get_json(silent=True) or {}
      with conn() as c:
        with c.cursor() as cur:
          cur.execute('UPDATE cms_stones SET name=%s,slug=%s,description=%s,symbolism=%s,shades_json=%s,texture_images_json=%s,position=%s,updated_at=NOW() WHERE id=%s AND deleted_at IS NULL RETURNING *',
            (str(p.get('name') or '').strip(),str(p.get('slug') or slug(p.get('name') or '')).strip(),str(p.get('description') or ''),str(p.get('symbolism') or ''),Json(p.get('shades') or []),Json(p.get('textureImages') or []),int(p.get('position') or 0),item_id)); item=cur.fetchone()
          if not item: return err('Камень не найден',404)
          audit(c,u,'update','stones',str(item_id),p)
        c.commit()
      return ok({'item':item})
    u,e=perm('delete','stones');
    if e: return e
    with conn() as c:
      with c.cursor() as cur: cur.execute('UPDATE cms_stones SET deleted_at=NOW() WHERE id=%s AND deleted_at IS NULL', (item_id,));
      c.commit()
    return ok({'ok':True})

  @app.route('/api/admin/cms/collections', methods=['GET','POST'])
  def collections_root():
    if request.method=='GET':
      _,e=perm('read','collections');
      if e: return e
      return list_simple('cms_collections')
    u,e=perm('create','collections');
    if e: return e
    p=request.get_json(silent=True) or {}
    name=str(p.get('name') or '').strip(); sl=str(p.get('slug') or slug(name)).strip()
    if not name or not sl: return err('name и slug обязательны')
    with conn() as c:
      with c.cursor() as cur:
        cur.execute('INSERT INTO cms_collections (name,slug,concept,inspiration,palette_json,key_stones_json,position) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *',
          (name,sl,str(p.get('concept') or ''),str(p.get('inspiration') or ''),Json(p.get('palette') or []),Json(p.get('keyStones') or []),int(p.get('position') or 0))); item=cur.fetchone(); audit(c,u,'create','collections',str(item['id']),{'name':name})
      c.commit()
    return ok({'item':item})

  @app.route('/api/admin/cms/collections/<int:item_id>', methods=['GET','PUT','DELETE'])
  def collections_item(item_id):
    if request.method=='GET':
      _,e=perm('read','collections');
      if e: return e
      with conn() as c:
        with c.cursor() as cur:
          cur.execute('SELECT * FROM cms_collections WHERE id=%s AND deleted_at IS NULL', (item_id,)); item=cur.fetchone()
      if not item: return err('Коллекция не найдена',404)
      return ok({'item':item})
    if request.method=='PUT':
      u,e=perm('update','collections');
      if e: return e
      p=request.get_json(silent=True) or {}
      with conn() as c:
        with c.cursor() as cur:
          cur.execute('UPDATE cms_collections SET name=%s,slug=%s,concept=%s,inspiration=%s,palette_json=%s,key_stones_json=%s,position=%s,updated_at=NOW() WHERE id=%s AND deleted_at IS NULL RETURNING *',
            (str(p.get('name') or '').strip(),str(p.get('slug') or slug(p.get('name') or '')).strip(),str(p.get('concept') or ''),str(p.get('inspiration') or ''),Json(p.get('palette') or []),Json(p.get('keyStones') or []),int(p.get('position') or 0),item_id)); item=cur.fetchone()
          if not item: return err('Коллекция не найдена',404)
          audit(c,u,'update','collections',str(item_id),p)
        c.commit()
      return ok({'item':item})
    u,e=perm('delete','collections');
    if e: return e
    with conn() as c:
      with c.cursor() as cur: cur.execute('UPDATE cms_collections SET deleted_at=NOW() WHERE id=%s AND deleted_at IS NULL', (item_id,));
      c.commit()
    return ok({'ok':True})
  @app.route('/api/admin/cms/products', methods=['GET','POST'])
  def products_root():
    if request.method=='GET':
      _,e=perm('read','products')
      if e: return e
      page=max(1,int(request.args.get('page') or 1)); size=max(1,min(100,int(request.args.get('pageSize') or 20))); off=(page-1)*size
      search=str(request.args.get('search') or '').strip(); status=str(request.args.get('status') or '').strip(); cid=request.args.get('collectionId'); sid=request.args.get('stoneId')
      w=['p.deleted_at IS NULL']; params=[]
      if status: w.append('p.status=%s'); params.append(status)
      if cid and str(cid).isdigit(): w.append('p.collection_id=%s'); params.append(int(cid))
      if sid and str(sid).isdigit(): w.append('EXISTS (SELECT 1 FROM cms_product_stones ps WHERE ps.product_id=p.id AND ps.stone_id=%s)'); params.append(int(sid))
      if search: like=f'%{search}%'; w.append('(p.name ILIKE %s OR p.slug ILIKE %s OR p.description ILIKE %s)'); params.extend([like,like,like])
      where=' AND '.join(w)
      with conn() as c:
        with c.cursor() as cur:
          cur.execute(f'SELECT COUNT(*) AS c FROM cms_products p WHERE {where}', params); total=int((cur.fetchone() or {}).get('c') or 0)
          cur.execute(f'''SELECT p.*,c.name AS collection_name FROM cms_products p LEFT JOIN cms_collections c ON c.id=p.collection_id WHERE {where} ORDER BY p.id DESC LIMIT %s OFFSET %s''', [*params,size,off]); rows=cur.fetchall(); s,v,i=rels(c,[r['id'] for r in rows])
      items=[]
      for r in rows:
        x=dto(r,s,v,i); x['collectionName']=r.get('collection_name'); items.append(x)
      return ok({'items':items,'total':total,'page':page,'pageSize':size})
    u,e=perm('create','products')
    if e: return e
    p=normalize_product(request.get_json(silent=True) or {})
    if not p['name'] or not p['slug'] or not p['type']: return err('name, slug, type обязательны')
    with conn() as c:
      with c.cursor() as cur:
        cur.execute('SELECT id FROM cms_products WHERE slug=%s', (p['slug'],))
        if cur.fetchone(): return err('Slug уже используется',409)
        cur.execute('INSERT INTO cms_products (name,slug,type,collection_id,price,status,description,dimensions_json) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *',
          (p['name'],p['slug'],p['type'],p['collectionId'],p['price'],p['status'],p['description'],Json(p['dimensions']))); row=cur.fetchone(); save_rels(c,row['id'],p); s,v,i=rels(c,[row['id']]); item=dto(row,s,v,i); audit(c,u,'create','products',str(row['id']),{'name':p['name']})
      c.commit()
    return ok({'item':item})

  @app.route('/api/admin/cms/products/<int:item_id>', methods=['GET','PUT','DELETE'])
  def products_item(item_id):
    if request.method=='GET':
      _,e=perm('read','products');
      if e: return e
      with conn() as c:
        with c.cursor() as cur:
          cur.execute('SELECT * FROM cms_products WHERE id=%s AND deleted_at IS NULL', (item_id,)); row=cur.fetchone()
          if not row: return err('Товар не найден',404)
          s,v,i=rels(c,[item_id])
      return ok({'item':dto(row,s,v,i)})
    if request.method=='PUT':
      u,e=perm('update','products');
      if e: return e
      p=normalize_product(request.get_json(silent=True) or {})
      with conn() as c:
        with c.cursor() as cur:
          cur.execute('''UPDATE cms_products SET name=%s,slug=%s,type=%s,collection_id=%s,price=%s,status=%s,description=%s,dimensions_json=%s,updated_at=NOW() WHERE id=%s AND deleted_at IS NULL RETURNING *''',
            (p['name'],p['slug'],p['type'],p['collectionId'],p['price'],p['status'],p['description'],Json(p['dimensions']),item_id)); row=cur.fetchone()
          if not row: return err('Товар не найден',404)
          save_rels(c,item_id,p); s,v,i=rels(c,[item_id]); item=dto(row,s,v,i); audit(c,u,'update','products',str(item_id),p)
        c.commit()
      return ok({'item':item})
    u,e=perm('delete','products')
    if e: return e
    with conn() as c:
      with c.cursor() as cur:
        cur.execute("UPDATE cms_products SET deleted_at=NOW(),status='archived' WHERE id=%s AND deleted_at IS NULL", (item_id,))
        if cur.rowcount==0: return err('Товар не найден',404)
        audit(c,u,'delete','products',str(item_id))
      c.commit()
    return ok({'ok':True})

  @app.post('/api/admin/cms/reviews/bulk')
  def reviews_bulk():
    u,e=perm('moderate','reviews')
    if e: return e
    p=request.get_json(silent=True) or {}
    ids=[int(x) for x in (p.get('ids') or []) if str(x).isdigit()]
    action=str(p.get('action') or '')
    if not ids: return err('ids обязательны')
    if action=='approve': status='approved'
    elif action=='reject': status='rejected'
    else: return err('Неподдерживаемое действие')
    with conn() as c:
      with c.cursor() as cur:
        cur.execute('UPDATE cms_reviews SET status=%s,updated_at=NOW() WHERE id = ANY(%s::bigint[]) AND deleted_at IS NULL', (status,ids)); audit(c,u,'bulk','reviews',None,{'ids':ids,'action':action})
      c.commit()
    return ok({'ok':True})

  @app.route('/api/admin/cms/reviews', methods=['GET','POST'])
  def reviews_root():
    if request.method=='GET':
      _,e=perm('read','reviews')
      if e: return e
      search=str(request.args.get('search') or '').strip(); status=str(request.args.get('status') or '').strip(); page=max(1,int(request.args.get('page') or 1)); size=max(1,min(100,int(request.args.get('pageSize') or 20))); off=(page-1)*size
      w=['deleted_at IS NULL']; params=[]
      if status: w.append('status=%s'); params.append(status)
      if search: like=f'%{search}%'; w.append('(name ILIKE %s OR text ILIKE %s)'); params.extend([like,like])
      where=' AND '.join(w)
      with conn() as c:
        with c.cursor() as cur:
          cur.execute(f'SELECT COUNT(*) AS c FROM cms_reviews WHERE {where}', params); total=int((cur.fetchone() or {}).get('c') or 0)
          cur.execute(f'SELECT * FROM cms_reviews WHERE {where} ORDER BY id DESC LIMIT %s OFFSET %s', [*params,size,off]); items=cur.fetchall()
      return ok({'items':items,'total':total,'page':page,'pageSize':size})
    u,e=perm('create','reviews')
    if e: return e
    p=request.get_json(silent=True) or {}
    with conn() as c:
      with c.cursor() as cur:
        cur.execute('INSERT INTO cms_reviews (product_id,name,city,text,status,source,occasion,photo_url,review_date) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *',
          (int(p.get('productId')) if str(p.get('productId') or '').isdigit() else None,str(p.get('name') or '').strip(),str(p.get('city') or '').strip(),str(p.get('text') or '').strip(),str(p.get('status') or 'pending'),str(p.get('source') or 'manual'),str(p.get('occasion') or '').strip(),str(p.get('photoUrl') or p.get('photo_url') or '').strip(),p.get('reviewDate') or p.get('review_date') or date.today().isoformat())); item=cur.fetchone(); audit(c,u,'create','reviews',str(item['id']),{'name':item['name']})
      c.commit()
    return ok({'item':item})

  @app.route('/api/admin/cms/reviews/<int:item_id>', methods=['GET','PUT','DELETE'])
  def reviews_item(item_id):
    if request.method=='GET':
      _,e=perm('read','reviews');
      if e: return e
      with conn() as c:
        with c.cursor() as cur: cur.execute('SELECT * FROM cms_reviews WHERE id=%s AND deleted_at IS NULL', (item_id,)); item=cur.fetchone()
      if not item: return err('Отзыв не найден',404)
      return ok({'item':item})
    if request.method=='PUT':
      u,e=perm('update','reviews');
      if e: return e
      p=request.get_json(silent=True) or {}
      with conn() as c:
        with c.cursor() as cur:
          cur.execute('SELECT status FROM cms_reviews WHERE id=%s AND deleted_at IS NULL', (item_id,)); old=cur.fetchone()
          if not old: return err('Отзыв не найден',404)
          ns=str(p.get('status') or old['status'])
          if not review_transition(old['status'], ns): return err('Недопустимый переход статуса',400)
          cur.execute('UPDATE cms_reviews SET product_id=%s,name=%s,city=%s,text=%s,status=%s,source=%s,occasion=%s,photo_url=%s,review_date=%s,updated_at=NOW() WHERE id=%s RETURNING *',
            (int(p.get('productId')) if str(p.get('productId') or '').isdigit() else None,str(p.get('name') or '').strip(),str(p.get('city') or '').strip(),str(p.get('text') or '').strip(),ns,str(p.get('source') or 'manual'),str(p.get('occasion') or '').strip(),str(p.get('photoUrl') or p.get('photo_url') or '').strip(),p.get('reviewDate') or p.get('review_date') or date.today().isoformat(),item_id)); item=cur.fetchone(); audit(c,u,'update','reviews',str(item_id),p)
        c.commit()
      return ok({'item':item})
    u,e=perm('delete','reviews')
    if e: return e
    with conn() as c:
      with c.cursor() as cur: cur.execute('UPDATE cms_reviews SET deleted_at=NOW() WHERE id=%s AND deleted_at IS NULL', (item_id,));
      c.commit()
    return ok({'ok':True})

  @app.route('/api/admin/cms/pages', methods=['GET','POST'])
  def pages_root():
    if request.method=='GET':
      _,e=perm('read','pages')
      if e: return e
      search=str(request.args.get('search') or '').strip(); page=max(1,int(request.args.get('page') or 1)); size=max(1,min(100,int(request.args.get('pageSize') or 20))); off=(page-1)*size
      with conn() as c:
        with c.cursor() as cur:
          if search:
            like=f'%{search}%'; cur.execute("SELECT COUNT(*) AS c FROM cms_pages WHERE deleted_at IS NULL AND (title ILIKE %s OR slug ILIKE %s)", (like,like)); total=int((cur.fetchone() or {}).get('c') or 0)
            cur.execute("SELECT * FROM cms_pages WHERE deleted_at IS NULL AND (title ILIKE %s OR slug ILIKE %s) ORDER BY id DESC LIMIT %s OFFSET %s", (like,like,size,off)); items=cur.fetchall()
          else:
            cur.execute("SELECT COUNT(*) AS c FROM cms_pages WHERE deleted_at IS NULL"); total=int((cur.fetchone() or {}).get('c') or 0)
            cur.execute("SELECT * FROM cms_pages WHERE deleted_at IS NULL ORDER BY id DESC LIMIT %s OFFSET %s", (size,off)); items=cur.fetchall()
      return ok({'items':items,'total':total,'page':page,'pageSize':size})
    u,e=perm('create','pages')
    if e: return e
    p=request.get_json(silent=True) or {}
    with conn() as c:
      with c.cursor() as cur:
        cur.execute("INSERT INTO cms_pages (title,slug,content_markdown,status,seo_meta_title,seo_meta_description,seo_og_image) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *",
          (str(p.get('title') or '').strip(), str(p.get('slug') or slug(p.get('title') or '')).strip(), str(p.get('content_markdown') or p.get('contentMarkdown') or ''), str(p.get('status') or 'published'), str(p.get('seo_meta_title') or p.get('seoMetaTitle') or ''), str(p.get('seo_meta_description') or p.get('seoMetaDescription') or ''), str(p.get('seo_og_image') or p.get('seoOgImage') or '')))
        item=cur.fetchone(); audit(c,u,'create','pages',str(item['id']),{'title':item['title']})
      c.commit()
    return ok({'item':item})

  @app.route('/api/admin/cms/pages/<int:item_id>', methods=['GET','PUT','DELETE'])
  def pages_item(item_id):
    if request.method=='GET':
      _,e=perm('read','pages')
      if e: return e
      with conn() as c:
        with c.cursor() as cur:
          cur.execute("SELECT * FROM cms_pages WHERE id=%s AND deleted_at IS NULL", (item_id,)); item=cur.fetchone()
      if not item: return err('Страница не найдена',404)
      return ok({'item':item})
    if request.method=='PUT':
      u,e=perm('update','pages')
      if e: return e
      p=request.get_json(silent=True) or {}
      with conn() as c:
        with c.cursor() as cur:
          cur.execute("UPDATE cms_pages SET title=%s,slug=%s,content_markdown=%s,status=%s,seo_meta_title=%s,seo_meta_description=%s,seo_og_image=%s,updated_at=NOW() WHERE id=%s AND deleted_at IS NULL RETURNING *",
            (str(p.get('title') or '').strip(), str(p.get('slug') or slug(p.get('title') or '')).strip(), str(p.get('content_markdown') or p.get('contentMarkdown') or ''), str(p.get('status') or 'published'), str(p.get('seo_meta_title') or p.get('seoMetaTitle') or ''), str(p.get('seo_meta_description') or p.get('seoMetaDescription') or ''), str(p.get('seo_og_image') or p.get('seoOgImage') or ''), item_id))
          item=cur.fetchone()
          if not item: return err('Страница не найдена',404)
          audit(c,u,'update','pages',str(item_id),p)
        c.commit()
      return ok({'item':item})
    u,e=perm('delete','pages')
    if e: return e
    with conn() as c:
      with c.cursor() as cur: cur.execute("UPDATE cms_pages SET deleted_at=NOW() WHERE id=%s AND deleted_at IS NULL", (item_id,))
      c.commit()
    return ok({'ok':True})

  @app.get('/api/admin/cms/settings')
  def settings_get():
    _,e=perm('read','settings')
    if e: return e
    with conn() as c:
      with c.cursor() as cur: cur.execute("SELECT key,value_json,updated_at FROM cms_settings ORDER BY key"); items=cur.fetchall()
    return ok({'items':items})

  @app.put('/api/admin/cms/settings/<key>')
  def settings_put(key):
    u,e=perm('update','settings')
    if e: return e
    p=request.get_json(silent=True)
    if isinstance(p, dict) and 'value' in p and len(p.keys()) == 1:
      value = p.get('value') if isinstance(p.get('value'), dict) else {'value': p.get('value')}
    else:
      value = p if isinstance(p,dict) else {'value':p}
    with conn() as c:
      with c.cursor() as cur:
        cur.execute("INSERT INTO cms_settings (key,value_json,updated_at) VALUES (%s,%s,NOW()) ON CONFLICT (key) DO UPDATE SET value_json=EXCLUDED.value_json, updated_at=NOW() RETURNING key,value_json,updated_at", (key, Json(value)))
        item=cur.fetchone(); audit(c,u,'update','settings',key,value)
      c.commit()
    return ok({'item':item})

  @app.route('/api/admin/cms/media', methods=['GET'])
  def media_list():
    _,e=perm('read','media')
    if e: return e
    search=str(request.args.get('search') or '').strip(); page=max(1,int(request.args.get('page') or 1)); size=max(1,min(100,int(request.args.get('pageSize') or 20))); off=(page-1)*size
    with conn() as c:
      with c.cursor() as cur:
        if search:
          like=f'%{search}%'; cur.execute("SELECT COUNT(*) AS c FROM cms_media WHERE original_name ILIKE %s OR public_url ILIKE %s", (like,like)); total=int((cur.fetchone() or {}).get('c') or 0)
          cur.execute("SELECT * FROM cms_media WHERE original_name ILIKE %s OR public_url ILIKE %s ORDER BY id DESC LIMIT %s OFFSET %s", (like,like,size,off)); items=cur.fetchall()
        else:
          cur.execute("SELECT COUNT(*) AS c FROM cms_media"); total=int((cur.fetchone() or {}).get('c') or 0)
          cur.execute("SELECT * FROM cms_media ORDER BY id DESC LIMIT %s OFFSET %s", (size,off)); items=cur.fetchall()
    return ok({'items':items,'total':total,'page':page,'pageSize':size})

  @app.post('/api/admin/cms/media/upload')
  def media_upload():
    u,e=perm('create','media')
    if e: return e
    files = []
    if request.files.get('file'):
      files.append(request.files.get('file'))
    files.extend(request.files.getlist('files') or [])
    files = [x for x in files if x and x.filename]
    if not files: return err('file обязателен')
    items = []
    with conn() as c:
      with c.cursor() as cur:
        for f in files:
          base=secure_filename(f.filename)
          ext=Path(base).suffix.lower() or '.bin'
          name=f"{int(date.today().strftime('%Y%m%d'))}-{secrets.token_hex(6)}{ext}"
          rel=f"cms/{name}"
          path=UPLOADS / rel
          path.parent.mkdir(parents=True, exist_ok=True)
          f.save(path)
          size=path.stat().st_size
          cur.execute("INSERT INTO cms_media (original_name,public_url,preview_url,size_bytes,file_path,meta_json) VALUES (%s,%s,%s,%s,%s,%s) RETURNING *",
            (f.filename, f"/uploads/{rel}", f"/uploads/{rel}", size, str(path), Json({})))
          item=cur.fetchone()
          items.append(item)
          audit(c,u,'create','media',str(item['id']),{'name':f.filename})
      c.commit()
    return ok({'item':items[0], 'items':items})

  @app.delete('/api/admin/cms/media/<int:item_id>')
  def media_delete(item_id):
    u,e=perm('delete','media')
    if e: return e
    with conn() as c:
      with c.cursor() as cur:
        cur.execute("SELECT * FROM cms_media WHERE id=%s", (item_id,)); row=cur.fetchone()
        if not row: return err('Медиа не найдено',404)
        cur.execute("DELETE FROM cms_media WHERE id=%s", (item_id,)); audit(c,u,'delete','media',str(item_id))
      c.commit()
    try:
      p=Path(row.get('file_path') or '')
      if p.exists(): p.unlink()
    except Exception:
      pass
    return ok({'ok':True})

  @app.get('/api/admin/cms/audit-log')
  def audit_log():
    _,e=perm('read','audit-log')
    if e: return e
    page=max(1,int(request.args.get('page') or 1)); size=max(1,min(100,int(request.args.get('pageSize') or 20))); off=(page-1)*size
    with conn() as c:
      with c.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS c FROM audit_log"); total=int((cur.fetchone() or {}).get('c') or 0)
        cur.execute("SELECT l.*,u.email AS user_email FROM audit_log l LEFT JOIN admin_users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT %s OFFSET %s", (size,off)); rows=cur.fetchall()
    items = []
    for r in rows:
      items.append({
        'id': r.get('id'),
        'created_at': r.get('created_at'),
        'actor_email': r.get('user_email') or '',
        'actor_role': '',
        'action': r.get('action') or '',
        'entity_type': r.get('entity') or '',
        'entity_id': r.get('entity_id') or '',
        'diff_json': r.get('payload_json') or {}
      })
    return ok({'items':items,'total':total,'page':page,'pageSize':size})

  @app.get('/favicon.ico')
  def favicon():
    p=PUBLIC / 'favicon.ico'
    if p.exists(): return send_from_directory(str(PUBLIC), 'favicon.ico')
    return '', 204

  @app.get('/site-content.js')
  def site_content_js():
    p=PUBLIC / 'site-content.js'
    site_settings = {}
    with conn() as c:
      with c.cursor() as cur:
        cur.execute("SELECT value_json FROM cms_settings WHERE key=%s", ('site',))
        row = cur.fetchone()
        raw = (row or {}).get('value_json') or {}
        site_settings = raw.get('value') if isinstance(raw, dict) and 'value' in raw and isinstance(raw.get('value'), dict) else raw
    base = p.read_text(encoding='utf-8') if p.exists() else "window.StoneAtelierContent={products:[],stones:[],collections:[],reviews:[]};"
    patch = (
      "\nwindow.StoneAtelierContent = window.StoneAtelierContent || {};\n"
      f"window.StoneAtelierContent.siteSettings = {json.dumps(site_settings, ensure_ascii=False)};\n"
    )
    return app.response_class(base + patch, mimetype='application/javascript')

  @app.get('/<path:path>')
  def static_file(path):
    p=PUBLIC / path
    if p.exists() and p.is_file(): return send_from_directory(str(PUBLIC), path)
    return 'Not found',404

  @app.errorhandler(Exception)
  def all_errors(ex):
    if isinstance(ex, HTTPException):
      return ex
    print('Unhandled error:', ex)
    return err('Внутренняя ошибка сервера',500)

  return app

init_db()
app = app_factory()

if __name__ == '__main__':
  app.run(host='0.0.0.0', port=PORT)
