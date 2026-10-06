# Feature Parity — MERN → Next.js

Old locations refer to tag `pre-nextjs-migration` (`client/src/pages/*`, `server/src/routes|controllers/*`).
"Tested" = covered by the ported Vitest API suite (103 tests, in-process against the real Route Handlers) and/or the live smoke test on `next start` (login, RBAC, page gating, data, PDF, logout). UI-only behaviour is tested by build + typecheck + live page serving, not browser automation (see Open items).

| Existing feature | Existing location | Next.js location | Migrated | Tested |
|---|---|---|---|---|
| Login / logout / session refresh | Login.jsx, auth routes | `(auth)/login`, `api/auth/*`, `services/auth.service.ts` | Yes | Yes |
| Register (student self sign-up, auto-link) | Register.jsx | `(auth)/register`, `auth.service.register` | Yes | Yes |
| Forgot / reset / change password, lockout | ForgotPassword, ResetPassword, Profile | `(auth)/*`, `(dashboard)/profile` | Yes | Yes |
| Role-based access (admin/faculty/student/parent) | `authorize`, `Protected` | `route({roles})`, `proxy.ts`, `lib/permissions.ts` | Yes | Yes |
| Dashboards (admin / faculty / student+parent) | Dashboard.jsx, dashboard.routes | `(dashboard)/page.tsx`, `dashboard.service.ts` | Yes | Yes |
| User accounts admin | Users.jsx | `(dashboard)/users`, `user.service.ts` | Yes | Yes |
| Students CRUD, export, photo, activate | Students/StudentDetail | `(dashboard)/students`, `student.service.ts` | Yes | Yes |
| Parent "My children" | Students.jsx | `(dashboard)/my-children` | Yes | Yes |
| Faculty CRUD, subjects, export | Faculty.jsx | `(dashboard)/faculty`, `faculty.service.ts` | Yes | Yes |
| Departments/programs/years/semesters/sections | AcademicSetup.jsx | `(dashboard)/academic-setup`, `academic.service.ts` | Yes | Yes |
| Subjects, enrolments, electives | Subjects.jsx | `(dashboard)/subjects`, `api/enrollments` | Yes | Yes |
| Timetable (+conflicts) | Timetable.jsx | `(dashboard)/timetable`, `schedule.service.ts` | Yes | Yes |
| Attendance (mark, summary, history, class report, corrections) | Attendance.jsx | `(dashboard)/attendance`, `attendance.service.ts` | Yes | Yes |
| Marks entry, class sheet, performance, results | Marks.jsx, Results.jsx | `(dashboard)/marks|results`, `marks.service.ts` | Yes | Yes |
| Exams (clash detection, publish, seating) | Exams.jsx | `(dashboard)/exams`, `schedule.service.ts` | Yes | Yes |
| Assignments, submissions, evaluation, reminders | Assignments*.jsx, jobs | `(dashboard)/assignments`, `assignment.service.ts`, `jobs.ts` | Yes | Yes |
| Study materials | Materials.jsx | `(dashboard)/materials`, `material.service.ts` | Yes | Yes |
| Notices (targeting) / Notifications / Calendar | Notices, Notifications, Calendar | `(dashboard)/notices|notifications|calendar` | Yes | Yes |
| Documents verification | Documents.jsx | `(dashboard)/documents`, `student-services.service.ts` | Yes | Yes |
| Support tickets | Complaints.jsx | `(dashboard)/complaints` | Yes | Yes |
| Achievements | Achievements.jsx | `(dashboard)/achievements` | Yes | Yes |
| Fees (structures, assign, pay, receipt) | Fees.jsx | `(dashboard)/fees`, `fee.service.ts` | Yes | Yes |
| Placements | Placements.jsx | `(dashboard)/placements`, `placement.service.ts` | Yes | Yes |
| Library | Library.jsx | `(dashboard)/library`, `library.service.ts` | Yes | Yes |
| Reports (JSON/CSV/PDF) | Reports.jsx | `(dashboard)/reports`, `report.service.ts` | Yes | Yes |
| Bulk import (preview → confirm) | Import.jsx | `(dashboard)/import`, `import.service.ts` | Yes | Yes |
| Audit logs | AuditLogs.jsx | `(dashboard)/audit-logs` | Yes | Yes |
| Settings (branding, policies, grade scale, logo) | Settings.jsx | `(dashboard)/settings`, `settings.service.ts` | Yes | Yes |
| File upload validation + protected serving | upload.js, files.controller | `lib/upload.ts`, `files.service.ts` | Yes | Yes |
| Search / filter / sort / pagination | `paginate` | `lib/query.ts` | Yes | Yes |
| Health / readiness | app.js | `api/health`, `api/ready` | Yes | Yes |
| Seed + create-admin scripts | seed.js, create-admin.js | `scripts/*.ts`, `lib/seed.ts` | Yes | Yes |

## Intentional differences
- Tokens are now **httpOnly cookies** for browsers (previously the access token was held in JS memory); the API still accepts `Bearer` tokens.
- Sidebar regrouped (Attendance & Exams, Coursework, Communication); the same pages, same roles. Calendar moved under Academics, Notifications added to the sidebar.
- Forged `$`/`.` keys anywhere in a key are rejected (slightly stricter than before).

## Open items (not verified here)
- No browser-automation run of the UI (the old Playwright suite was removed with Express); pages were verified by typecheck, lint, production build and HTTP smoke tests.
- Docker image/compose changes are untested (no Docker in this environment).
- Responsive layout and the CSS are carried over unchanged from the original; no visual redesign pass was done.
