> **Historical design notes.** The project was originally built as MERN (Express + React/Vite) and has since been migrated to a single
> Next.js App Router application. For the current architecture see `docs/PROJECT_DOCUMENTATION.md` and `MIGRATION_PLAN.md`.

# Student Management System — Project Plan

## 0. Repository state
Greenfield: the folder was empty at start. No existing code to reuse.
Constraint: **100% local** — Node.js + Express + local MongoDB + React (Vite). No cloud services.
Uploads live in `server/uploads/`; MongoDB stores metadata + relative path.

## 1. Architecture
```
Browser (React SPA, Vite :5173)  --HTTP/JSON (Axios, Bearer JWT)-->  Express API (:5000)  --Mongoose-->  MongoDB (localhost:27017)
                                                                     └── server/uploads (multer, local disk)
```
- Stateless API, short-lived access JWT (15 min, held in browser memory only) + refresh JWT (7 d, stored hashed in DB, rotated, delivered as an httpOnly SameSite=Strict cookie; revocable on logout). Account lockout after repeated failures.
- Layers: `routes → middleware(auth, rbac, validate) → controllers → services/models`.
- Central error handler (`AppError`, Mongoose/Zod/Multer mapping), consistent envelope:
  `{ success, message, data, meta? }` / `{ success:false, message, errors? }`.

## 2. Technology choices
| Concern | Choice |
|---|---|
| Language | Modern JavaScript (ESM) on both sides |
| Backend | Express 4, Mongoose 8, jsonwebtoken, bcryptjs, zod (validation), multer, helmet, cors, express-rate-limit, express-mongo-sanitize-style sanitizer (custom), morgan, pdfkit (PDF), csv-parse |
| Frontend | React 18, Vite, React Router 6, Axios, Recharts, react-hot-toast, plain CSS design system (tokens) |
| Tests | Jest + supertest + mongodb-memory-server (backend); Vitest + Testing Library (frontend) |

## 3. Folder structure
```
client/src/{api,components,context,hooks,layouts,pages,routes,styles,utils}
server/src/{config,controllers,middleware,models,routes,services,utils,validators,jobs}
server/uploads/  server/tests/  docs/
```

## 4. Roles & permission model
Roles: `admin`, `faculty`, `student`, `parent`.
- `authorize(...roles)` middleware on every route; plus **ownership scoping** in controllers
  (students only own data; faculty only assigned subjects/sections; parent only linked children).
- Account `isActive` flag checked on every request; deactivated users are rejected immediately.
- Matrix is documented in `docs/API.md`.

## 5. Database design (Mongoose)
User, Department, Program, AcademicYear, Semester, Section, Student, Faculty, Subject, Enrollment,
Attendance (unique: subject+section+date+student), AttendanceCorrection, Mark, GradeScale (in Settings),
Exam, Assignment, Submission, Timetable, Notice, Notification, Material, CalendarEvent, Document,
Complaint, FeeStructure, FeePayment, Company, JobPosting/Application, Achievement, Book/BookIssue,
AuditLog, Settings (singleton), RefreshToken/PasswordReset fields on User.
Indexes on: unique business keys, foreign keys used in filters, text search fields, date fields.

## 6. API structure
`/api/{auth,users,students,faculty,departments,programs,academic-years,semesters,sections,subjects,
enrollments,attendance,marks,exams,assignments,timetable,notices,notifications,materials,calendar,
reports,documents,complaints,fees,placements,achievements,library,audit-logs,settings,dashboard,import}`
Generic list contract: `?page&limit&search&sort&<filters>` → `{ data:[], meta:{page,limit,total,pages} }`.

## 7. Feature modules / phases
1. **Phase 1** – Architecture, auth (login/logout/refresh/forgot/reset/change pw), RBAC, models, seed, students, faculty, admin dashboard, app shell + design system.
2. **Phase 2** – Departments, programs, years, semesters, sections, subjects, enrollment, attendance (+corrections), marks/grades/SGPA/CGPA.
3. **Phase 3** – Exams, assignments/submissions, timetable (conflict detection), notices, notifications, materials, calendar.
4. **Phase 4** – Reports (CSV/PDF), documents, complaints, CSV bulk import (preview→confirm), audit logs, settings.
5. **Phase 5** – Fees (simulated payments), placements, library, achievements, parent portal.
6. **Phase 6** – Tests, security review, production build, README/API docs.

## 8. Testing strategy
Backend integration tests (supertest + in-memory MongoDB): auth, RBAC, student CRUD, validation,
attendance (duplicates, thresholds), marks/grades. Frontend: build check + smoke tests for key components.

## 9. Deployment strategy
Local only: `npm run seed`, `npm run dev` (server), `npm run dev` (client). Production-style:
`npm run build` in client; Express can serve `client/dist` when `SERVE_CLIENT=true`. Config through `.env`.

---

## Implementation status (end of build)

All six phases were implemented. Verified with: 70 API integration tests (Jest/Supertest), 16 UI tests (Vitest/Testing Library),
a production client build, a production-style single-server run (`SERVE_CLIENT=true`), and a manual UI sweep of every page for the
admin, faculty, student and parent roles on desktop and mobile widths against a seeded local MongoDB.

Deviations from the original plan:
* Password-reset e-mail is not sent (no mail server by design); the link is logged to the API console and shown in development.
* Originally tokens lived in `localStorage`; v1.1 moved the refresh token to an httpOnly cookie and the access token to memory (see CHANGELOG).
* Fee payments are simulated; there is no payment gateway.
* Tests use the local MongoDB test database and fall back to an in-memory server if none is running.
