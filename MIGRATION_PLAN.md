# Migration Plan — MERN → Next.js (App Router) + MongoDB

Checkpoint: git tag `pre-nextjs-migration` (the last commit of the MERN version). `git checkout pre-nextjs-migration` restores it.

## 1. Current architecture

```
React SPA (Vite :5173) ──/api proxy──▶ Express API (:5000) ──Mongoose──▶ MongoDB (localhost:27017/student_management)
                                         └── server/uploads/ (multer, local disk)
```

* `client/` — React 18, React Router 7, Axios, Recharts, react-hot-toast, hand-written CSS design system (`styles/index.css`, 1117 lines). 31 pages, JS/JSX.
* `server/` — Express 4, Mongoose 8, Zod, JWT (`jsonwebtoken`), `bcryptjs`, multer, pdfkit, csv-parse, helmet/cors/rate-limit. ESM JS.
* `e2e/` — Playwright suite; `server/tests` — Jest + Supertest (mongodb-memory-server); `client/src/__tests__` — Vitest.
* Root: Dockerfile / docker-compose, GitHub CI, docs (`README.md`, `docs/API.md`, `docs/PROJECT_DOCUMENTATION.md`, `docs/DEPLOYMENT.md`, `PROJECT_PLAN.md`).

## 2. Target architecture

One Next.js 16 (App Router, TypeScript) application at the repo root. No Express, no Vite, no separate server.

```
                NEXT.JS APPLICATION
        React UI (client components)  ─fetch─▶  Route Handlers (app/api/**/route.ts)
        Server Components / layouts   ─────────▶  Service layer (services/*.service.ts)
                                                     │
                                                  Mongoose (models/*)
                                                     │
                                              LOCAL MONGODB  (mongodb://localhost:27017/student_management)
```

* `app/(auth)` login/register/forgot/reset, `app/(dashboard)` every authenticated page, `app/api/**` route handlers.
* `middleware.ts` (named `proxy.ts` in Next 16) — redirects unauthenticated page requests, applies security headers.
* `lib/` — `mongodb.ts` (cached connection), `auth.ts` (JWT/cookies/session), `permissions.ts`, `api.ts` (route wrapper, response envelope, errors), `upload.ts`, `rate-limit.ts`, `csv.ts`, `env.ts`.
* `services/` — all business logic extracted from the Express controllers/route files.
* `validators/` — Zod schemas (same rules as before).
* `models/` — Mongoose models, hot-reload-safe registration.
* `instrumentation.ts` — starts the assignment-deadline reminder job (was `jobs/index.js`).

## 3. Current frontend structure (31 pages)

Public: Login, Register, ForgotPassword, ResetPassword, NotFound.
Shell: `AppLayout` (sidebar by role, topbar, notification bell, profile menu), `nav.js` (5 groups).
Pages: Dashboard (admin / faculty / student+parent variants), Profile, Students, StudentDetail, Faculty, Users, AcademicSetup (departments, programs, years, semesters, sections), Subjects, Timetable, Attendance (mark / records / class report / corrections), Marks, Results, Exams, Assignments, AssignmentDetail, Materials, Notices, Notifications, Calendar, Documents, Complaints, Achievements, Fees, Placements, Library, Reports, Import, AuditLogs, Settings.
Shared: `ui.jsx` (Button, Card, Modal, Badge, Field, Tabs, StatCard…), `DataTable`, `DynamicForm`, `ResourcePage`, `Confirm`, `FileLink`, `Icon`, `ErrorBoundary`; contexts `AuthContext`, `SettingsContext`; hooks `useFetch`, `useListQuery`, `useDebounce`, `useDismiss`.

## 4. Current backend structure

`routes/*.routes.js` (22 modules) → `middleware/` (`protect`, `authorize`, `validate`, `upload`, `security`, `error`) → `controllers/` (assignment, attendance, auth, faculty, files, marks, student, user + generic `crud.js` factory) → `services/` (access, accounts, attendance, audit, enrollment, grading, notify, scope) → `models/`.

## 5. Database structure (Mongoose, unchanged)

`User` (roles admin/faculty/student/parent, refreshTokens[], reset token, lockout), `Student`, `Faculty`, `Department`, `Program`, `AcademicYear`, `Semester`, `Section`, `Subject`, `Enrollment`, `Attendance`, `AttendanceCorrection`, `Mark`, `Exam`, `Assignment`, `Submission`, `Timetable`, `Notice`, `Notification`, `Material`, `CalendarEvent`, `StudentDocument`, `Complaint`, `Achievement`, `AuditLog`, `Settings`, `FeeStructure`, `Fee`, `Company`, `Job`, `Application`, `Book`, `BookIssue`. All fields, enums, indexes, virtuals and the `User` pre-save hashing hook are preserved verbatim. DB name stays `student_management`.

## 6. Existing API endpoints (all preserved at the same URL, method, and response envelope `{success,message,data,meta?}`)

| Module | Endpoints |
|---|---|
| auth | POST login, register, refresh, forgot-password, reset-password, logout, change-password; GET me |
| users (admin) | GET/POST `/users`, GET/PATCH `/users/:id`, POST `/users/:id/reset-password` |
| students | GET/POST `/students`; GET `/export`; GET/PATCH `/me`; POST `/me/photo`; GET/PUT/PATCH/DELETE `/:id`; GET `/:id/enrollments`; POST `/:id/photo`, `/:id/activate` |
| faculty | GET/POST `/faculty`; GET `/export`, `/me`; GET/PUT/PATCH/DELETE `/:id`; PUT `/:id/subjects`; POST `/:id/activate` |
| academic structure | CRUD (GET list/GET id/POST/PUT/PATCH/DELETE) for `/departments /programs /academic-years /semesters /sections /subjects`; POST `/subjects/:id/sync-enrollments`; `/enrollments` GET/POST, POST `/enrollments/sync`, DELETE `/enrollments/:id` |
| schedule | `/exams` CRUD + POST `/:id/seating` + GET `/:id/my-seat`; `/timetable` CRUD + GET `/me` |
| attendance | GET `/classes /roster /class-report`; POST `/`; GET/POST/PATCH `/corrections(/:id)`; GET `/student/:id/summary`, `/student/:id/history` |
| marks | POST `/`; GET `/subject/:id`, `/subject/:id/performance`, `/student/:id/results`; DELETE `/:id` |
| assignments | GET/POST `/`; GET/PATCH/DELETE `/:id`; GET `/:id/submissions`; POST `/:id/submit`; PATCH `/submissions/:id/evaluate` |
| notices | GET/POST `/`; GET/PATCH/DELETE `/:id` |
| notifications | GET `/`, `/unread-count`; POST `/read-all`; PATCH `/:id/read`; DELETE `/:id` |
| materials / calendar / documents / complaints / achievements | list/create/delete (+ review, respond, verify, update variants) |
| fees | structures CRUD + assign; list; POST `/:id/pay`; GET receipt |
| placements | companies CRUD; jobs CRUD + apply; applications list + status |
| library | books CRUD; issue; return; issues |
| reports | GET `/reports/:type` (json/csv/pdf) for students, faculty, attendance, marks, results, fees, placements, complaints |
| import | GET template; POST preview; POST confirm |
| dashboard | GET `/dashboard/admin`, `/faculty`, `/student` |
| settings / audit | GET `/settings(/public)`, PUT `/settings`, POST `/settings/logo`; GET `/audit-logs`, `/audit-logs/actions` |
| files / health | GET `/files/:category/:filename` (authorised); GET `/health`, `/ready` |

## 7. Authentication mechanism (current → new)

Current: bcrypt (cost 10); short-lived access JWT (15 min, carries role + password-changed stamp) kept **in browser memory** and sent as `Bearer`; rotating refresh JWT (7 days, hashed in `User.refreshTokens`, max 5 sessions) in an httpOnly cookie scoped to `/api/auth`; lockout after 5 failures / 15 min; forgot/reset (30 min token, link logged to console in dev); change password invalidates all sessions; deactivated accounts rejected on every request; per-IP auth rate limit; Mongo-operator-injection guard on body/query/params.

New (behaviour preserved, token transport hardened): both JWTs live in **httpOnly SameSite=Strict cookies** (`sms_access` path `/`, `sms_refresh` path `/api/auth`). `Authorization: Bearer` is still accepted by the API for non-browser clients. The browser client refreshes transparently on 401 exactly as before. `proxy.ts` (Next middleware) verifies the access JWT with `jose` (edge-safe) to redirect anonymous users and apply role gates to page routes; every route handler re-verifies and re-loads the user from MongoDB (authoritative). Remaining rules (lockout, token rotation, session cap, reset, password-changed invalidation, rate limits, input sanitising) are ported 1:1.

## 8. Existing features (inventory)

Roles: **admin, faculty, student, parent** (parent = read-only view of linked children).

1. Auth: login, register (student-role self sign-up, auto-links existing student record), logout, forgot/reset/change password, forced password change flag, lockout, session refresh.
2. User accounts (admin): list/search/filter, create (admin/parent, parent↔children link), activate/deactivate, role change (guarded), temporary-password reset.
3. Students: list/search/filter/sort/paginate, detail (profile, attendance, results, enrollments, documents…), create (with login account + temp password + auto-enrolment), edit, deactivate/activate, photo upload, CSV export, student self-profile edit, parent "My Children".
4. Faculty: list/search/filter, create (+account), edit, activate/deactivate, subject assignment, CSV export, "me".
5. Academic setup: departments, programs, academic years (single current), semesters (single current), sections; delete guards for dependants.
6. Subjects: CRUD, faculty/sections assignment, auto-enrolment, sync enrolments, elective enrolments (enrol/drop), `mine` filter.
7. Timetable: CRUD with faculty/room/section conflict detection, weekly "my timetable".
8. Attendance: class selector, roster, bulk mark (present/absent/late/excused), future-date guard, edit tracking, low-attendance warnings, class report, student summary (overall/subject/month, threshold), history, correction requests + review.
9. Marks: bulk entry per subject/component with validation, class sheet, performance stats, student results (SGPA/CGPA/grades), delete, notifications.
10. Exams: CRUD, room-clash detection, publish → notify, role-scoped visibility, seating generation, "my seat".
11. Assignments: CRUD with attachment, student submit (files/text, late detection, resubmit), submissions list, evaluate with marks/feedback, deadline reminder job.
12. Materials: upload/list/delete per subject with access control, notifications.
13. Notices: audience/department/program/year/section targeting, priority, expiry, attachment, faculty-limited publishing, notifications.
14. Notifications: list, unread count, mark one/all read, delete.
15. Calendar: events by type/audience, date-range filter.
16. Documents: student upload, admin verification workflow, deletion rules.
17. Support tickets (complaints): create with attachment, threaded replies, assignment, status workflow, notifications.
18. Achievements: submit with certificate, verify/reject, delete.
19. Fees: structures, assign to students, payments (simulated), receipts, status filters.
20. Placements: companies, jobs (eligibility), apply (CGPA/program rules), applications pipeline.
21. Library: books, issue/return, loan limit, fines, issue list.
22. Reports: 8 report types, filters, date ranges, JSON preview + CSV + PDF export.
23. Bulk import: CSV template → validate/preview → confirm.
24. Dashboards: admin (stats, attendance trend, performance, by-department, recent items), faculty, student/parent.
25. Settings: college name/contact/logo, attendance threshold, pass %, grade scale, library policy; public branding.
26. Audit logs: filter/search, action list.
27. Files: protected download/inline serving with per-category authorisation; upload validation (extension + MIME + magic bytes + size).
28. Cross-cutting: pagination/search/sort/filter everywhere, toasts, confirm dialogs, skeleton/empty/error states, responsive layout, a11y.

## 9. Migration mapping

| Old | New |
|---|---|
| `server/src/models/*.js` | `models/*.ts` (+ `models/index.ts`), registered with `mongoose.models.X ?? mongoose.model(...)` |
| `config/db.js` | `lib/mongodb.ts` (global-cached connection) |
| `config/env.js` | `lib/env.ts` |
| `middleware/auth.js` (`protect`, `authorize`, profiles) | `lib/auth.ts`, `lib/permissions.ts`, `lib/api.ts` (`route({roles})`) |
| `middleware/validate.js` | `validators/common.ts` + `route({body, query})` |
| `middleware/security.js` | `lib/security.ts` (operator-injection guard) + `lib/rate-limit.ts` |
| `middleware/upload.js` | `lib/upload.ts` (`request.formData()` + magic-byte check + local disk) |
| `middleware/error.js`, `AppError`, `utils/http.js` | `lib/errors.ts`, `lib/api.ts`, `lib/query.ts` (`paginate`, `filtersFromQuery`) |
| `controllers/*.js`, `routes/*.js` inline handlers, `crud.js` | `services/*.service.ts` + `app/api/**/route.ts` |
| `services/*.js` | `services/*.ts` |
| `validators/*.js` | `validators/*.ts` |
| `jobs/index.js` | `instrumentation.ts` + `services/jobs.ts` |
| `seed.js`, `scripts/create-admin.js` | `scripts/seed.ts`, `scripts/create-admin.ts` (run via `tsx`) |
| `client/src/pages/*.jsx` | `app/(dashboard)/**/page.tsx` (client components) |
| `client/src/components/*` | `components/ui/*`, `components/layout/*` |
| `client/src/api/client.js` (Axios) | `lib/api-client.ts` (fetch wrapper with the same `api.get/post/…` surface, cookie auth, silent refresh) |
| `context/*`, `hooks/*`, `utils/*` | `components/providers/*`, `hooks/*`, `lib/format.ts`, `lib/validation.ts` |
| `client/src/styles/index.css` | `app/globals.css` (same design tokens + refined navigation, dashboard and table styles) |
| React Router | Next.js file-system routing, `next/link`, `next/navigation` |
| `client/public/*` | `public/*` |
| `server/uploads/` | `uploads/` (git-ignored), served only through `/api/files/*` |

## 10. Files to move
Models, validators, services, utils, seed/create-admin scripts, CSS, icons, UI components, pages, public assets, docs.

## 11. Files to replace
Express `app.js/server.js`, all `routes/`, `controllers/`, `middleware/` (re-implemented), Axios client, React Router `App.jsx`/`main.jsx`, Vite config/index.html, Dockerfile/compose/CI, root `package.json`, ESLint config.

## 12. Files to delete only after migration is verified
`server/`, `client/`, root MERN `package.json` scripts, old `Dockerfile` stages, `.claude/launch.json` entries, old tests (ported first), `e2e/` (kept if still valid against Next on port 3000, otherwise ported). Nothing is deleted before `npm run build` and the ported tests pass.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Hundreds of endpoints re-implemented → behavioural drift | Port logic 1:1 into services, port the old Jest suites as route-handler integration tests, FEATURE_PARITY.md checklist |
| Mongoose model re-registration on HMR | `mongoose.models.X ?? model` helper, cached connection |
| `pdfkit`/`bcryptjs`/`mongoose` bundling in route handlers | `serverExternalPackages` in `next.config.ts` |
| File uploads (multer gone) | Re-implement with `formData()` + same extension/MIME/magic-byte/size rules |
| Cookie auth + CSRF | `SameSite=Strict` cookies, JSON/multipart only, no GET side effects |
| In-memory import previews & rate limiting need a single process | Same constraint as before (local, single instance); documented |
| Background job in a serverless-style framework | `instrumentation.ts` runs in the Node runtime of `next start` (documented) |
| Local MongoDB not installed on dev machine | Tests use `mongodb-memory-server`; smoke tests run against a temporary local `mongod` |

## 14. Testing strategy
* Vitest unit tests: validators, grading/attendance maths, CSV safety, format utils, security guard.
* Vitest + `mongodb-memory-server` integration tests that call route handlers directly with `Request` objects (ports of the old Supertest suites: auth, students-RBAC, attendance-marks, admin-modules, modules, hardening).
* Manual/automated smoke against `next start` + a real local `mongod` (login, role gates, CRUD, upload/download, reports, direct URL + refresh behaviour, logout).
* `npm run lint`, `npm run build`, `tsc --noEmit` must pass.

## 15. Migration phases
1 Analyse + plan + checkpoint ✔ → 2 Next.js scaffold (TS, App Router, Mongo) → 3 Models + DB → 4 Auth + RBAC → 5 Route handlers → 6 Services → 7 Pages/components → 8 Routing → 9 Forms/validation → 10 Files → 11 Remove Express/Vite/React Router → 12 Testing → 13 Lint/build → 14 Documentation + FEATURE_PARITY.md.

## UI direction
Same features and flows; clearer navigation (grouped sidebar with active state and collapsible mobile drawer, breadcrumbs/page headers), calmer dashboards (summary cards, "needs attention" panel, quick actions), consistent tables/forms, confirmations for destructive actions, explicit loading/empty/error/unauthorised states, accessible focus styles. Business rules are untouched.
