# Stone Atelier (Demo)

Красивый сайт для продажи украшений из камней с:

- публичной витриной каталога
- CMS-админкой (`/admin`)
- CRUD операциями по товарам
- запуском в Docker (`docker-compose`)

## Запуск в Docker

1. Скопируйте `.env.example` в `.env` и задайте свои значения.
2. Запустите:

```bash
docker-compose up --build
```

3. Откройте сайт: `http://localhost:3000`
4. Откройте CMS-админку: `http://localhost:3000/admin`

## Новая CMS-админка (`/admin`)

Добавлен отдельный защищённый интерфейс CMS: `http://localhost:3000/admin`

Возможности:

- CRUD товаров, камней, коллекций, отзывов, контентных страниц
- медиа-библиотека (загрузка/удаление с проверкой использования)
- настройки сайта
- пользователи админки (RBAC: `admin` / `editor` / `moderator`)
- аудит изменений (`audit_log`)

### Как зайти в CMS

Укажите в `.env`:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

При первом запуске (если пользователя нет) он будет создан автоматически как `admin`.

## Медиа storage

- По умолчанию: локальное хранение в `./uploads/cms`
- В БД медиа хранится в таблице `cms_media`
- `preview_url` сейчас совпадает с `public_url` (без серверного ресайза/конвертации)

## Основные API эндпоинты CMS

Префикс: `/api/admin/cms`

- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`
- `GET /dashboard`
- `GET/POST/PUT/DELETE /products`
- `POST /products/bulk`
- `GET/POST/PUT/DELETE /stones`
- `GET/POST/PUT/DELETE /collections`
- `GET/POST/PUT/DELETE /reviews`
- `POST /reviews/bulk`
- `GET/POST/PUT/DELETE /pages`
- `GET /settings`
- `PUT /settings/:key`
- `GET /media`
- `POST /media/upload`
- `DELETE /media/:id`
- `GET /users`
- `POST /users`
- `PUT /users/:id`
- `DELETE /users/:id`
- `GET /audit-log`

## Интеграционные тесты CMS API

Тесты покрывают критичные сценарии:

- RBAC (`editor` не может удалить товар)
- модерация отзывов (`pending -> approved`)
- создание/чтение товара со связями (`stones`/`collection`)

### Подготовка

1. Установите зависимости:

```bash
npm install
```

2. Поднимите проект и PostgreSQL (например через Docker):

```bash
docker-compose up --build
```

3. Убедитесь, что создан админ-пользователь (`ADMIN_EMAIL` / `ADMIN_PASSWORD`)

### Запуск

```bash
CMS_TEST_BASE_URL=http://localhost:3000 \
CMS_TEST_ADMIN_EMAIL=admin@example.com \
CMS_TEST_ADMIN_PASSWORD=your_password \
npm run test:integration
```

## Python version (Flask)

If you need a runtime without Node/npm issues, use the Python stack:

```bash
docker compose -f docker-compose.py.yml up --build -d
```

App URL: `http://localhost:3000`
Admin URL: `http://localhost:3000/admin`
