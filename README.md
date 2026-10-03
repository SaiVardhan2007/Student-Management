# Student Management System

A complete college academic-management platform built on the **MERN** stack (MongoDB · Express · React · Node).
It runs **entirely on your own computer** — no cloud accounts, external databases or paid APIs. Uploaded files are stored on
local disk (`server/uploads/`) and MongoDB stores only the metadata and path.

> Roles: **Admin**, **Faculty**, **Student**, **Parent**. Every rule is enforced by the API — the UI only mirrors it.

## Features

| Area | What you get |
|---|---|
| Auth | Login/logout, JWT access + rotating refresh tokens, bcrypt hashing, forgot/reset/change password, account (de)activation, rate limiting |
| People | Students & faculty (full profiles, search/filter/sort/pagination, CSV export, soft-delete), parent accounts linked to children, user admin |
| Structure | Departments, programs, academic years, semesters, sections, subjects (all configurable — nothing hard-coded), automatic enrolment |
| Attendance | Faculty marking (present/absent/late/excused), duplicate-proof, audit trail, configurable warning threshold, student summaries (overall/subject/monthly), correction requests with approval |
| Marks | Assignment/quiz/internal/practical/mid/final components, configurable grade scale, SGPA/CGPA, class performance |
| Exams | Schedule with room-clash detection, publishing, invigilators, seating arrangement |
| Assignments | Create with attachments, submit (files/text), late detection, evaluate with marks + feedback |
| Timetable | Weekly grids for students/faculty, conflict detection (faculty, room, section) |
| Communication | Targeted notices (department/program/year/section), in-app notifications (read/unread/mark all), academic calendar |
| Content | Study materials with per-subject access control |
| Services | Documents with verification workflow, support tickets, achievements, fees (simulated payments + receipts), placements (eligibility rules, application tracking), library (issue/return/fines) |
| Admin | Dashboard with charts, reports (JSON/CSV/PDF with filters and date ranges), CSV bulk import (validate → preview → confirm), audit logs, settings (college name, logo, policies, grading) |
| UX | Responsive (desktop/tablet/mobile), design system, toasts, confirm dialogs, skeletons, empty/error states, keyboard-accessible, semantic HTML |

## Architecture

```
React SPA (Vite, :5173) ──/api (proxy)──▶ Express API (:5000) ──Mongoose──▶ MongoDB (localhost:27017)
                                             └── server/uploads/  (multer, local disk)
```

```
student_mng_sys/
├─ client/                React 18 + Vite + React Router + Axios + Recharts
│  └─ src/  api/ components/ context/ hooks/ layouts/ pages/ routes/ styles/ utils/ __tests__/
├─ server/                Node 18+ / Express 4 / Mongoose 8 (ESM)
│  ├─ src/  config/ controllers/ middleware/ models/ routes/ services/ validators/ utils/ jobs/ seed.js
│  ├─ tests/              Jest + Supertest integration tests
│  └─ uploads/            uploaded files (git-ignored)
├─ docs/API.md            endpoint reference
└─ PROJECT_PLAN.md        architecture & design notes
```

Layering on the API: `route → auth/RBAC/validation middleware → controller → service/model`. Zod validates every request body/query
(backend) and the same rules run in the browser (frontend). A central error handler returns a consistent envelope and never leaks stack traces in production.

## Prerequisites

1. **Node.js 18 or newer** (developed on Node 23) — <https://nodejs.org>
2. **MongoDB Community Server** running locally — <https://www.mongodb.com/try/download/community>
   (optional: **MongoDB Compass** to browse data — connect to `mongodb://localhost:27017`)

## Quick start

```bash
# 1. install dependencies
npm run install:all            # or: npm --prefix server install && npm --prefix client install

# 2. start MongoDB (Windows installs it as a service named "MongoDB"; check with: net start MongoDB)

# 3. configure the API
cp server/.env.example server/.env      # then edit values (see below)
#    optional: cp client/.env.example client/.env

# 4. load demo data (optional but recommended)
npm run seed                   # add  -- --reset  to wipe and reseed:  npm run seed:reset

# 5. run the API and the web app (two terminals)
npm run dev:server             # http://localhost:5000
npm run dev:client             # http://localhost:5173
```

Open <http://localhost:5173>.

### Development credentials (created by `npm run seed`)

The password for **every** seeded account is the `SEED_PASSWORD` in `server/.env` (`ChangeMe@123` in `.env.example`).
Seeding refuses to run when `NODE_ENV=production`. **Never reuse these accounts or password anywhere real.**

| Role | Login |
|---|---|
| Admin | `admin@college.local` |
| Faculty | `meera.iyer@college.local` (also `arjun.nair`, `kavita.sharma`, `rahul.verma`, `sana.khan` @college.local) |
| Student | `s250001@college.local` … `s250030@college.local` |
| Parent | `parent@college.local` (linked to S250001) |

Accounts created through the app get a random one-time **temporary password** (shown once) and must change it at first login.

## Environment variables (`server/.env`)

| Variable | Purpose | Default |
|---|---|---|
| `MONGODB_URI` | Local MongoDB connection string | `mongodb://localhost:27017/student_management` |
| `MONGODB_URI_TEST` | Database used by the test suite (**is wiped by tests**) | `mongodb://localhost:27017/student_management_test` |
| `PORT` | API port | `5000` |
| `CLIENT_URL` | Allowed browser origin (CORS) and reset-link base | `http://localhost:5173` |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Token signing keys — use long random values | dev-only fallbacks (production refuses to start with weak/missing values) |
| `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES_DAYS` | Token lifetimes | `15m`, `7` |
| `UPLOAD_DIR`, `MAX_FILE_SIZE_MB` | Local upload folder and size limit | `uploads`, `10` |
| `SERVE_CLIENT` | `true` → Express also serves `client/dist` | `false` |
| `SEED_PASSWORD` | Password for demo accounts | `ChangeMe@123` |

Generate a strong secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
`client/.env` (optional): `VITE_API_URL` (blank = use the Vite proxy) and `VITE_PROXY_TARGET`.

No email server is configured. **Forgot password** writes the reset link to the API console (and shows it on screen in development).

## Commands

| Command | Description |
|---|---|
| `npm run dev:server` / `npm run dev:client` | Development servers with hot reload |
| `npm run seed` / `npm run seed:reset` | Demo data |
| `npm test` | Server tests then client tests |
| `npm --prefix server test` | API tests (Jest + Supertest) |
| `npm --prefix client test` | UI tests (Vitest + Testing Library) |
| `npm run build` | Production build of the client (`client/dist`) |
| `npm start` | Start the API without nodemon |

### Testing

The API suite (≈70 tests) covers authentication, token rotation, RBAC (student/faculty/parent restrictions), student CRUD, validation,
attendance (duplicates, thresholds, corrections), marks/grades/SGPA, exams/timetable conflicts, assignments and uploads, notices targeting,
documents, complaints, import, fees, library, placements, reports and dashboards. Tests use `MONGODB_URI_TEST` on your local MongoDB;
if none is reachable they fall back to an in-memory MongoDB (this requires a one-time binary download and is only used for testing).

### Production-style local run

```bash
npm run build                                   # builds client/dist
# in server/.env: NODE_ENV=production, SERVE_CLIENT=true, strong JWT secrets, CLIENT_URL=http://localhost:5000
npm start                                       # everything on http://localhost:5000
```

For a LAN/college deployment put the same setup behind a reverse proxy with HTTPS and set `CLIENT_URL` to the public origin.
Take regular backups with `mongodump` and copy `server/uploads/`.

## Security notes

* Passwords hashed with bcrypt; never returned by the API or written to logs/audit entries.
* Short-lived access tokens; refresh tokens are stored **hashed**, rotate on use and are revoked on logout, password change/reset and deactivation.
  Changing a password invalidates all older access tokens.
* Authorization is enforced in the API on every route (role checks plus ownership scoping for students, parents and faculty).
* Input validated with Zod on the server; Mongo operator injection stripped; search text escaped; sort fields allow-listed; pagination capped.
* `helmet` headers and CSP, strict single-origin CORS, request-size limits, login/API rate limiting, identical responses for unknown users (no account enumeration).
* Uploads: extension + MIME + file-signature checks, random filenames, size limits, stored outside the web root and served only via an authenticated route with per-owner checks for sensitive categories.
* CSV exports neutralise spreadsheet formulas.
* Tokens are kept in `localStorage` (a common trade-off for SPAs); the CSP and React's output escaping mitigate XSS. For internet-facing deployments consider httpOnly cookies.

## Known limitations / notes

* Dropdowns load up to 100 options (departments, subjects, students, …). Fine for a college-sized dataset; a searchable async select would be the next step for very large lists.
* Fee payments are **simulated** (no gateway). Email/SMS delivery is not implemented (in-app notifications only).
* Refresh-token sessions and import previews are held per API process; run a single API instance (normal for local use).
* Seating arrangement is a simple ordered assignment per exam; multi-room allocation is not implemented.

## License

Educational / internal college use.
