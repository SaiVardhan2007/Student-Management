# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.1.0] — 2026-10-03

### Added
- **Deployment**: multi-stage `Dockerfile` (non-root, read-only filesystem, health check), `docker-compose.yml` with MongoDB on a private
  volume, `.env.example`, backup/restore scripts, and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **Operations**: `/api/ready` readiness endpoint, `X-Request-Id` on every response, JSON logs in production, gzip compression,
  immutable caching for hashed assets, graceful shutdown that closes MongoDB, configurable proxy trust / CORS origins / rate limits.
- `npm run create-admin` — production-safe first-administrator bootstrap (no demo data).
- `npm run smoke` — boots the real server in production mode and verifies it.
- **Quality gates**: ESLint + Prettier for the whole repository, editor config, coverage reporting, GitHub Actions CI
  (lint, tests, audit, end-to-end, Docker build + smoke test) and Dependabot.
- **End-to-end tests** (Playwright): auth/session flows, every page for every role, WCAG 2.1 A/AA scans (axe-core), mobile layout.
- 33 new API tests (cookie auth, lockout, sanitising, operations, user/faculty/settings/calendar/material administration) and 39 new UI tests (API client, auth flows, hooks, pages, formatters). Coverage thresholds guard against regressions (server ≈85% line coverage).
- Web app manifest, SVG favicon, `robots.txt`.
- `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE` (MIT).

### Changed
- **Security**: refresh token moved to an `httpOnly; SameSite=Strict` cookie and the access token to memory only (nothing sensitive in
  `localStorage`); sessions are restored on reload through the cookie.
- **Security**: accounts lock for 15 minutes after 5 consecutive failed logins (HTTP 429).
- **Security**: requests containing `$`-operator or dotted keys are now rejected with 400 instead of being silently stripped.
- Accessibility: progress bars have accessible names; faint text and sidebar group labels meet WCAG AA contrast.
- Dependencies: `multer` 1 → 2, `csv-parse` 6 → 7, `react-router-dom` 6 → 7, Vite 5 → 8, Vitest 2 → 4, Jest 29 → 30,
  jsdom 24 → 30. `nodemon` replaced by `node --watch`. **`npm audit` reports 0 vulnerabilities** (all packages, including dev).
- Project documentation moved to `docs/PROJECT_DOCUMENTATION.md` and brought up to date; README and API reference updated.
- Code reformatted with Prettier.

### Fixed
- Removed an accidental circular `file:..` dependency from the server and client `package.json` files.
- Several lint findings (unused variable, unescaped entities, irregular whitespace in the CSV importer).

## [1.0.0] — 2026-09-30

Initial release: authentication and RBAC, students/faculty, academic structure, attendance, marks, exams, assignments, timetable,
notices, materials, documents, complaints, achievements, fees, placements, library, reports, bulk import, audit logs and settings.
