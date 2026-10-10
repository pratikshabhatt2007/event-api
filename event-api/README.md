# Event Management & Registration API

REST API for discovering events, registering for them, and managing events as an admin.
Built for the **GDG RBU Recruitment Drive 2026-27 - Backend Web Developer** task.

**Stack:** Node.js 20+, Express, SQLite (`better-sqlite3`), JWT auth (`jsonwebtoken` + `bcryptjs`), Zod validation.

## Features

| Requirement | Implementation |
|---|---|
| User registration & login, JWT auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| CRUD for events (Title, Description, Date/Time, Venue, Capacity, Category) | Admin-only create/update/delete, public read |
| Register for events, no duplicates, no overbooking | Single DB transaction + `UNIQUE(user_id, event_id)` |
| Users view their registered events | `GET /api/me/registrations` |
| Admins create / update / delete events | Role-protected routes (`403` for normal users) |
| Search & filter for the React UI | `q`, `category`, `from`, `to`, `available`, `upcoming`, `sort`, pagination |
| **Bonus** rate limiting | Global + stricter limit on login/register |
| **Bonus** Docker | `Dockerfile` + `docker-compose.yml` |
| **Bonus** analytics | `GET /api/admin/analytics` |
| **Bonus** QR codes | `GET /api/me/registrations/:id/qr` (PNG ticket) |

### Business rules (all covered by tests)

- Duplicate registration -> `409`
- Event full -> `409` (checked inside the same transaction as the insert, so concurrent requests can never exceed capacity)
- Cannot register for an event that has already happened -> `400`
- Admin cannot lower capacity below the current number of registrations -> `409`
- Deleting an event removes its registrations (cascade)
- Public sign-up always creates a normal `user`; the `role` field in the body is ignored. Admins are created from env vars.
- Tokens are re-checked against the DB on every request, so deleted users lose access immediately.
- Login returns the same error for unknown email and wrong password.

## Setup

```bash
git clone <your-repo-url>
cd event-api
npm install
cp .env.example .env      # then edit JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run seed              # optional: adds 5 sample events
npm start                 # http://localhost:5000
```

Use `npm run dev` for auto-reload and `npm test` to run the test suite (needs no setup; uses an in-memory DB).

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `5000` | |
| `DB_FILE` | `data/events.db` | SQLite file, created automatically |
| `JWT_SECRET` | dev value | **Must be set in production** |
| `JWT_EXPIRES_IN` | `7d` | |
| `CORS_ORIGIN` | `*` | Comma-separated origins, e.g. your Vercel URL |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | - | Admin is created (or promoted) on startup |
| `RATE_LIMIT_MAX` | `200` | Requests per IP per 15 min on `/api` |
| `AUTH_RATE_LIMIT_MAX` | `20` | Login/register attempts per IP per 15 min |

### Docker

```bash
cp .env.example .env     # fill in values
docker compose up --build
```

Data persists in the `event-data` volume.

## API reference

Base URL: `http://localhost:5000/api`. Send `Authorization: Bearer <token>` for protected routes.
Errors look like `{ "error": { "message": "...", "details": [...] } }`.

### Auth
| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/auth/register` | - | `{ name, email, password (min 8) }` -> `201 { user, token }` |
| POST | `/auth/login` | - | `{ email, password }` -> `{ user, token }` |
| GET | `/auth/me` | user | -> `{ user }` |

### Events
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/events` | optional | List with filters (below). If a token is sent, each event includes `is_registered` |
| GET | `/events/categories` | - | Distinct categories (for a filter dropdown) |
| GET | `/events/:id` | optional | Event details with `registered_count`, `spots_left`, `is_full` |
| POST | `/events` | admin | `{ title, description?, date_time (ISO), venue, capacity, category }` |
| PUT | `/events/:id` | admin | Any subset of the fields above |
| DELETE | `/events/:id` | admin | `204` |
| POST | `/events/:id/register` | user | Register the logged-in user |
| DELETE | `/events/:id/register` | user | Unregister |
| GET | `/events/:id/registrations` | admin | Attendee list |

**`GET /events` query params:** `q` (title/description/venue), `category`, `from`, `to` (ISO dates),
`available=true` (not full), `upcoming=true`, `sort=date_asc|date_desc|newest`, `page`, `limit` (max 100).
Response: `{ data: [...], pagination: { page, limit, total, total_pages } }`.

### My registrations & extras
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/me/registrations` | user | Events the user is registered for |
| GET | `/me/registrations/:id/qr` | owner/admin | PNG QR ticket |
| GET | `/admin/analytics` | admin | Totals, top events by fill rate, registrations per category |
| GET | `/health` | - | Liveness check |

### Quick example

```bash
# sign up
curl -X POST localhost:5000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"Asha","email":"asha@example.com","password":"password123"}'

# register for event 1
curl -X POST localhost:5000/api/events/1/register -H "Authorization: Bearer $TOKEN"
```

## Using it from the React app

Set the frontend's API base URL to this server (e.g. `VITE_API_URL=https://your-api.onrender.com/api`) and set
`CORS_ORIGIN` here to your frontend URL. Store the token from login and send it as a Bearer header.
Admin screens should show only when `user.role === 'admin'` (the API enforces it regardless).

## Deploying

Any Node host works (Render, Railway, Fly.io). Set the env vars above, build command `npm install`,
start command `npm start`. SQLite needs a persistent disk/volume - on hosts with ephemeral disks, mount one
at the `DB_FILE` location.

## Project structure

```
src/
  app.js            Express app (middleware, routes, error handling)
  server.js         Entry point
  config.js         Env config
  db.js             Schema + admin seeding
  validation.js     Zod schemas
  errors.js         HttpError helpers
  middleware/auth.js  JWT + role guards
  routes/           auth, events, me (registrations/QR), admin (analytics)
scripts/seed-demo.js  Sample events
tests/api.test.js     11 integration tests
```
