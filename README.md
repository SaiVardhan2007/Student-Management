# Student Management System

A complete college academic-management platform built with **Next.js (App Router) + React + TypeScript**, **MongoDB** and **Mongoose**.
It runs **entirely on your own computer** — no cloud accounts, external databases or paid APIs. Uploaded files are stored on local disk
(`uploads/`) and MongoDB stores only metadata and paths.

> Roles: **Admin**, **Faculty**, **Student**, **Parent**. Every rule is enforced on the server — the UI only mirrors it.

- Frontend: Next.js / React · Backend: Next.js Route Handlers + service layer · Database: MongoDB · ODM: Mongoose
- Migrated from a React + Express codebase with identical features, roles, data and API URLs (see `MIGRATION_PLAN.md`, `FEATURE_PARITY.md`).

## Features

| Area | What you get |
|---|---|
| Auth | Login/logout, httpOnly-cookie JWT sessions with rotating refresh tokens, bcrypt, forgot/reset/change password, lockout, rate limiting |
| People | Students & faculty (profiles, search/filter/sort/pagination, CSV export, soft-delete), parent accounts linked to children, user admin |
| Structure | Departments, programs, academic years, semesters, sections, subjects, automatic enrolment |
| Attendance | Marking, audit trail, threshold warnings, summaries, correction requests with approval |
| Marks | Components, configurable grade scale, SGPA/CGPA, class performance |
| Exams / Timetable | Room-clash detection, publishing, seating; faculty/room/section conflict detection |
| Assignments & Materials | Attachments, submissions, late detection, evaluation, deadline reminders, per-subject access |
| Communication | Targeted notices, notifications, academic calendar |
| Services | Documents verification, support tickets, achievements, fees (simulated payments), placements, library |
| Admin | Dashboards, reports (JSON/CSV/PDF), CSV bulk import, audit logs, settings |

## Quick start

Requirements: Node.js 20.19+ and MongoDB running locally (`mongodb://localhost:27017`).

```bash
npm install
cp .env.example .env.local     # set JWT_SECRET and JWT_REFRESH_SECRET
npm run seed                   # optional demo data
npm run dev                    # http://localhost:3000
```

Demo accounts (password = `SEED_PASSWORD`, default `ChangeMe@123`; **never reuse in production**):

| Role | Login |
|---|---|
| Admin | `admin@college.local` |
| Faculty | `meera.iyer@college.local` (also `arjun.nair`, `kavita.sharma`, `rahul.verma`, `sana.khan` @college.local) |
| Student | `s250001@college.local` … `s250030@college.local` |
| Parent | `parent@college.local` |

Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
No email server is configured: **Forgot password** prints the reset link to the server console (and shows it on screen in development).

## Commands

| Command | Description |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Development / production build / production server |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | 103 API integration tests (Vitest, in-memory MongoDB) |
| `npm run seed` / `npm run seed:reset` | Demo data |
| `npm run create-admin` | First administrator in any environment (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`) |

## Documentation

`docs/PROJECT_DOCUMENTATION.md` (full reference) · `docs/API.md` · `docs/DEPLOYMENT.md` (Docker, HTTPS, backups) · `MIGRATION_PLAN.md` · `FEATURE_PARITY.md` · `SECURITY.md`
