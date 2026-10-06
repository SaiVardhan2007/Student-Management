# Student Management System

**Project Documentation**

| | |
|---|---|
| Project type | Full-stack web application (Next.js App Router + MongoDB) |
| Package name | `student-management-system` (v2.0.0) |
| Frontend | Next.js / React (TypeScript) |
| Backend | Next.js server-side architecture: Route Handlers (`app/api`) + a service layer |
| Database | MongoDB, accessed through Mongoose (ODM) |

> Migrated from a MERN codebase (React + Express). Features, roles, permissions, data model and API URLs are unchanged;
> see `MIGRATION_PLAN.md` and `FEATURE_PARITY.md`.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Project Objectives](#2-project-objectives)
3. [Problem Statement](#3-problem-statement)
4. [Proposed Solution](#4-proposed-solution)
5. [Technology Stack](#5-technology-stack)
6. [System Architecture](#6-system-architecture)
7. [User Roles and Access Control](#7-user-roles-and-access-control)
8. [Functional Modules](#8-functional-modules)
9. [Database Design](#9-database-design)
10. [Backend Design](#10-backend-design)
11. [REST API Overview](#11-rest-api-overview)
12. [Frontend Design](#12-frontend-design)
13. [Security Implementation](#13-security-implementation)
14. [Configuration](#14-configuration)
15. [Installation and Running the Project](#15-installation-and-running-the-project)
16. [Testing](#16-testing)
17. [Project Structure](#17-project-structure)
18. [Current Limitations](#18-current-limitations)
19. [Possible Future Enhancements](#19-possible-future-enhancements)
20. [Conclusion](#20-conclusion)

---

## 1. Project Overview

The Student Management System (SMS) is a web application that manages the academic records and day-to-day activities of a college in one place. It is built with Next.js (React UI, Route Handlers and a service layer) on a local MongoDB database via Mongoose.

The system has four kinds of users: **administrators, faculty, students and parents**. Each user signs in with an account and sees only the screens and data that belong to their role. Administrators configure the institution and manage people. Faculty record attendance and marks and run assignments. Students view their own academic information and submit work. Parents view the records of their linked children.

The application covers student and faculty records, academic structure (departments, programs, semesters, sections, subjects), attendance, marks and results, examinations, assignments, timetables, notices, documents, fees, library, placements and reports. It runs locally with Node.js and a MongoDB database. Uploaded files are stored on the server's local disk, and MongoDB stores only their metadata and relative path.

## 2. Project Objectives

The objectives below correspond to functionality that exists in the code.

1. **Centralize institutional records.** Keep student, faculty, department, program, subject and enrollment data in a single database.
2. **Provide role-based access.** Restrict every API route by role (admin, faculty, student, parent) and restrict the data returned to what each user is permitted to see.
3. **Digitize attendance.** Let faculty mark attendance per subject, section and date. Calculate attendance percentages and flag students below a configurable threshold (default 75%). Let students request corrections.
4. **Digitize marks and results.** Record marks by assessment type and calculate subject percentage, grade, SGPA and CGPA from an administrator-configurable grade scale.
5. **Support academic operations.** Schedule exams with room-conflict detection, maintain weekly timetables, and manage assignments with submissions and evaluation.
6. **Improve communication.** Publish notices targeted by department, program, year or section, deliver in-app notifications, and maintain an academic calendar.
7. **Support student services.** Provide document upload and verification, support tickets, achievements, fee tracking, a library module and a placement module.
8. **Provide administration tools.** Offer dashboards, reports (JSON, CSV, PDF), bulk student import from CSV, audit logs and configurable institution settings.
9. **Protect data.** Apply authentication, input validation, rate limiting, upload checks and audit logging.

## 3. Problem Statement

Colleges commonly manage academic information with paper registers, spreadsheets and separate tools. This leads to several problems:

- **Scattered records.** Student details, attendance sheets, mark lists and fee records are kept in different files and formats, and are hard to keep consistent.
- **Slow retrieval and reporting.** Producing an attendance shortage list or a department-wise student list takes manual collation.
- **Calculation errors.** Attendance percentages, grades, SGPA and CGPA calculated by hand are error-prone and applied inconsistently.
- **Limited visibility for students and parents.** Students and parents often learn about attendance shortages or results late.
- **Weak access control.** Shared spreadsheets cannot reliably limit who sees or edits which records.
- **Scheduling conflicts.** Clashes between rooms, faculty and sections in timetables and exam schedules are noticed late.
- **No audit trail.** It is difficult to establish who changed an attendance entry or mark, and when.

## 4. Proposed Solution

SMS replaces these separate tools with one web application backed by one database.

**Workflow as implemented:**

1. **Setup (administrator).** The administrator signs in, then creates departments, programs, academic years, semesters and sections, and then subjects. Faculty and student records are created individually or imported from a CSV file. Creating a student or faculty record also creates a login account with a random temporary password, shown once, which the user must change at first login.
2. **Enrollment.** Students are enrolled automatically in the non-elective subjects of their program and semester (respecting any section restriction on the subject). Enrollment is re-run when a student or subject is created, and an administrator can trigger a manual sync.
3. **Daily operation (faculty).** Faculty see only the subjects assigned to them. They mark attendance for a class, enter marks, create assignments and evaluate submissions, upload study materials and publish notices.
4. **Student and parent access.** Students and parents sign in to see a dashboard, attendance summaries with threshold warnings, results (grades, SGPA, CGPA), exams, timetable, notices and notifications. Students can also submit assignments, upload documents, raise support tickets, record achievements, view and pay fees (simulated) and apply for jobs.
5. **Administration.** The administrator reviews dashboards, generates reports, verifies documents, handles tickets, manages fees, library and placements, and inspects the audit log.
6. **Automatic notifications.** A background job runs hourly (first run 30 seconds after the server starts) and notifies enrolled students who have not yet submitted an assignment due within 24 hours. Other events, such as assignment creation, published exams and notices, also create in-app notifications.

## 5. Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| UI | React components, hand-written CSS design system (`app/globals.css`), Recharts, react-hot-toast |
| API | Next.js Route Handlers (`app/api/**/route.ts`) |
| Business logic | Service modules (`services/*.ts`) |
| Validation | Zod (server-side for every body/query; mirrored in forms) |
| Database / ODM | MongoDB (local) / Mongoose 8 |
| Authentication | JWT (jose) in httpOnly cookies, bcryptjs password hashing |
| Files | Local disk (`uploads/`), served only through the authorised `/api/files` route |
| Reports | pdfkit (PDF), CSV |
| Tests | Vitest + mongodb-memory-server (route handlers called in-process) |


## 6. System Architecture

```
Browser: React UI (client components) --fetch /api--> Route Handlers --> Services --> Mongoose --> MongoDB (localhost:27017)
         Server Components / layouts (read the session cookie)                                   uploads/ (local disk)
```

- `proxy.ts` (Next middleware) gates **pages**: anonymous visitors go to `/login`, a role without access goes to the dashboard.
- `lib/api.ts` `route({ roles, body, query, upload }, handler)` wraps every Route Handler: rate limit, DB, authenticate,
  authorise, parse (JSON/form/multipart), operator-injection guard, Zod validation, service, standard envelope
  `{ success, message, data, meta? }`. Errors (AppError, Zod, Mongoose) become consistent JSON; stack traces are never sent in production.
- Authorisation is enforced on the server in two places: the `roles` option of each route and the data-scoping helpers in
  `services/access.ts` / `services/scope.ts`. Hiding links in the UI is never the only defence.
- **Sessions.** Login sets two httpOnly, SameSite=Strict cookies: `sms_access` (15 min JWT) and `sms_refresh` (7-day rotating
  token, hash stored in MongoDB, path `/api/auth`). The browser client refreshes silently on a 401. `Authorization: Bearer` is still accepted for non-browser clients.
- A background job (`instrumentation.ts` -> `services/jobs.ts`) sends assignment-deadline reminders hourly.


## 7. User Roles and Access Control

Four roles exist: `admin`, `faculty`, `student` and `parent`. Access is enforced in two places:

- **On the API.** The `protect` middleware verifies the JWT and loads the active user on every request. The `authorize(...roles)` middleware restricts each route to specific roles. Controllers and services additionally scope data by ownership: a student sees only their own records, a parent sees only linked children, and a faculty member sees only students enrolled in the subjects assigned to them.
- **In the UI.** `proxy.ts` redirects unauthenticated visitors to the login page and the app shell shows an "Access denied" page for disallowed roles. The sidebar (`lib/nav.ts`) shows only the entries allowed for the current role. The UI mirrors the API rules, which remain the authoritative check.

**Sidebar and page access by role** (taken from `lib/nav.ts` and `lib/permissions.ts`):

| Page | Admin | Faculty | Student | Parent |
|---|:-:|:-:|:-:|:-:|
| Dashboard, Notices, Academic Calendar, Timetable, Attendance, Examinations, Support Tickets, Achievements | ✔ | ✔ | ✔ | ✔ |
| Students | ✔ | ✔ | | |
| My Children | | | | ✔ |
| Faculty, User Accounts, Academic Setup | ✔ | | | |
| Subjects | ✔ | ✔ | ✔ | |
| Marks Entry | ✔ | ✔ | | |
| Results | | | ✔ | ✔ |
| Assignments, Study Materials | ✔ | ✔ | ✔ | |
| Documents, Fees, Library | ✔ | | ✔ | ✔ |
| Placements | ✔ | | ✔ | |
| Reports | ✔ | ✔ | | |
| Bulk Import, Audit Logs, Settings | ✔ | | | |

Some pages also depend on the role inside the page. For example, the Reports API restricts the `students`, `faculty`, `fees`, `placements` and `complaints` report types to administrators, and limits faculty to subjects they teach for the attendance, marks and results reports.

## 8. Functional Modules

Each module below exists in the code (backend routes and a matching frontend page).

### 8.1 Authentication and Account Management
- Login, logout, current-user lookup (`/auth/me`), token refresh, change password, forgot password and reset password.
- Short-lived access token (default 15 minutes) and refresh token (default 7 days). Refresh tokens are stored hashed in the database, rotate on use, and at most 5 concurrent sessions are kept per user. The browser app receives its refresh token as an `httpOnly`, `SameSite=Strict` cookie scoped to `/api/auth` (never readable by JavaScript); other API clients may receive it in the JSON body instead.
- Changing or resetting a password invalidates tokens issued earlier.
- Administrators can create, edit, activate and deactivate user accounts and reset passwords (`/users`). Deactivated users are rejected on every request.
- New accounts created by an administrator receive a random temporary password and are flagged `mustChangePassword`.

### 8.2 Student Management
- Student profile: ID, name, email, phone, date of birth, gender, photo, address, guardian and emergency contact, department, program, batch, academic year, semester, section, admission details and status (`active`, `inactive`, `graduated`, `suspended`, `dropped`).
- Administrators create, edit, deactivate and reactivate students (delete is a soft deactivation) and export students to CSV.
- Listing supports search, filters, sorting and pagination.
- Students can view their own profile, edit permitted fields and upload a profile photo.
- Creating a student also creates the linked login account.

### 8.3 Faculty Management
- Faculty profile: employee ID, name, email, phone, department, designation, status (`active`, `inactive`, `on_leave`), joining date and photo.
- Administrators create, edit, deactivate and reactivate faculty, assign subjects to a faculty member and export to CSV.
- A faculty user can view their own profile.

### 8.4 Academic Structure and Enrollment
- Departments, programs, academic years, semesters, sections and subjects, each with create, read, update and delete. Only administrators can change them; any signed-in user can read them.
- Rules enforced in the code include unique department/program/subject codes, a program belonging to the selected department, and only one current academic year.
- Subjects have a code, credits, type (`theory`, `practical`, `elective`), an assigned faculty member and optional section restriction.
- Enrollments are created automatically and can be synced manually per subject or globally. Administrators can also add or remove an enrollment manually.

### 8.5 Attendance
- Faculty (for their own subjects) and administrators mark attendance by subject, section and date with statuses `present`, `absent`, `late` and `excused`.
- A unique index prevents duplicate records for the same subject, student and date. Re-saving updates the record and stores who changed it.
- Attendance percentage = (present + late) ÷ (present + late + absent). Excused sessions are ignored.
- Student summaries show overall, per-subject and per-month figures, with a warning when below the configurable threshold.
- Students can submit correction requests with a reason. Staff approve or reject them.
- Faculty can view a class report and the class roster.

### 8.6 Marks and Results
- Mark components: `assignment`, `quiz`, `internal`, `practical`, `mid`, `final`. One record per student, subject and component.
- Only the assigned faculty member (or an administrator) can enter marks. Obtained marks cannot exceed the maximum.
- Results compute, per subject, the percentage, grade, grade points and pass/fail, and compute SGPA per semester and CGPA overall, weighted by subject credits.
- The grade scale and pass percentage are configurable in Settings. The default scale is O, A+, A, B+, B, C, F with grade points 10 to 0.
- Faculty can view subject-level performance summaries. Students and parents view results.

### 8.7 Examinations
- Exams have a type (`internal`, `mid`, `final`, `practical`), subject, program, semester, date, time range, room, invigilators and maximum marks.
- The system rejects an exam that overlaps in the same room on the same date.
- Exams are visible to students, parents and faculty only once published. Publishing creates notifications.
- Seating arrangements are stored per exam, and a student can look up their own seat.

### 8.8 Assignments and Submissions
- Faculty create assignments for their subjects, optionally for specific sections, with a deadline, maximum marks and an optional attachment.
- Students submit text and/or up to 5 files. Resubmission updates the submission. Submissions after the deadline are flagged `late`.
- Faculty evaluate submissions with marks and feedback.
- Students are notified when an assignment is created. The hourly job sends reminders for assignments due within 24 hours.

### 8.9 Timetable
- Weekly entries with day, time range, subject, faculty, room and section.
- The system detects conflicts for faculty, room and section.
- Students, parents and faculty can view their own timetable (`/timetable/me`). Administrators and faculty can list all entries.

### 8.10 Notices, Notifications and Academic Calendar
- Notices have an audience (`all`, `students`, `faculty`, `parents`), optional department/program/year/section targeting, priority, publish and expiry dates and an optional attachment. Expired and future-dated notices are hidden from non-staff users. Faculty can target only sections they teach.
- Notifications are in-app only: list, unread count, mark one or all as read, delete.
- Calendar events (`exam`, `holiday`, `assignment`, `seminar`, `event`, `deadline`) are created by administrators and visible to all.

### 8.11 Study Materials
- Faculty and administrators upload files for a subject, with a material type (`notes`, `pdf`, `assignment`, `question_paper`, `reference`). Read access is limited by subject (enrolled students, assigned faculty, administrators).

### 8.12 Student Documents
- Students upload documents (`certificate`, `marksheet`, `id_proof`, `internship`, `other`). Administrators review each with status `pending`, `verified`, `rejected` or `reupload_requested`, plus a note. Parents can view their child's documents.

### 8.13 Support Tickets (Complaints)
- Students raise a ticket with category, priority, description and optional attachment. Replies are added as responses. The status moves through `open`, `assigned`, `in_progress`, `resolved` and `closed`.

### 8.14 Achievements
- Students record achievements (category, description, date, optional certificate). Administrators or faculty verify or reject them.

### 8.15 Fees
- Administrators define fee structures per program and semester and assign them to students.
- Students can pay through a **simulated** payment (no real payment gateway). Overpayment is blocked, and receipts are generated with a receipt number.
- A fee's status (`paid`, `partial`, `pending`, `overdue`) is derived from the amounts and due date.

### 8.16 Library
- Administrators manage books (title, authors, ISBN, category, total and available copies) and issue and return them.
- Issuing decrements available copies and is blocked when none remain. Late returns incur a fine based on the configured fine per day (default 2) and loan period (default 14 days).
- Students and parents can view issue records.

### 8.17 Placements
- Administrators manage companies, job postings (package, deadline, eligibility such as minimum CGPA, programs and maximum active backlogs) and application status.
- Students see published jobs and apply. Eligibility is checked on application. Application status values are `applied`, `shortlisted`, `assessment`, `interview`, `selected` and `rejected`, with a status history.

### 8.18 Dashboards
- Separate dashboard endpoints and views for administrators, faculty, and students/parents, including charts built with Recharts.

### 8.19 Reports
- Report types: `students`, `faculty`, `attendance`, `marks`, `results`, `fees`, `placements`, `complaints`.
- Output formats: JSON (paginated, shown in the UI), CSV (formula-safe, with a UTF-8 byte-order mark) and PDF (generated with PDFKit). Reports support filters and date ranges, and are capped at 5,000 rows.

### 8.20 Bulk Import
- Administrators upload a CSV of students. The flow is template download, then preview with per-row validation errors, then confirm, which inserts only valid rows. The CSV is parsed in memory and not saved to disk.

### 8.21 Audit Logs
- Key actions (logins, failed logins, creations, changes, report generation and so on) are recorded with user, role, action, entity, details (sensitive keys such as passwords and tokens are redacted) and IP address. Administrators can browse them with filters.

### 8.22 Settings
- Administrators set college name, logo, contact details, attendance threshold, pass percentage, grade scale, library fine per day and loan days. A public endpoint (`/settings/public`) provides the branding shown on the login page.

## 9. Database Design

The database is MongoDB, accessed through Mongoose. Models are defined in `models/` and grouped by area (`people.ts`, `academic.ts`, `academics-ops.ts`, `campus.ts`, `extras.ts`).

### 9.1 Collections

| Model | Key fields | Notes |
|---|---|---|
| `User` | name, email (unique), password (hashed, not selected by default), role, isActive, mustChangePassword, children, refreshTokens, reset token fields, failedLogins and lockUntil (account lockout) | Linked to Student/Faculty; `children` is used by parent accounts |
| `Student` | studentId (unique), names, email (unique), department, program, semester, section, status, guardian | Indexes on name, and on department/program/semester/section |
| `Faculty` | employeeId (unique), names, email (unique), department, designation, status | |
| `Department` | name, code (both unique), head, isActive | |
| `Program` | name, code (unique), department, durationYears, totalSemesters | |
| `AcademicYear` | name (unique), startDate, endDate, isCurrent | |
| `Semester` | name, number, academicYear, dates, isCurrent | Unique on academic year + number |
| `Section` | name, program, department, batch, semester, capacity | Unique on program + batch + semester + name |
| `Subject` | code (unique), name, department, program, semester, credits, type, faculty, sections | |
| `Enrollment` | student, subject, semester, status | Unique on student + subject |
| `Attendance` | subject, section, student, date, status, remarks, markedBy, modifiedBy | Unique on subject + student + date |
| `AttendanceCorrection` | attendance, student, subject, requestedStatus, reason, status, reviewedBy | |
| `Mark` | student, subject, semester, examType, marksObtained, maxMarks, enteredBy | Unique on student + subject + examType |
| `Exam` | name, type, subject, program, semester, date, times, room, invigilators, isPublished, seating | |
| `Assignment` | title, subject, sections, deadline, maxMarks, attachment, createdBy, reminderSentAt | |
| `Submission` | assignment, student, text, files, status, marks, feedback | Unique on assignment + student |
| `Timetable` | day, startTime, endTime, subject, faculty, room, section | |
| `Notice` | title, description, audience, department/program/year/section, priority, publishDate, expiryDate | |
| `Notification` | user, title, message, type, link, isRead | Indexed on user + isRead + createdAt |
| `Material` | title, subject, type, file, uploadedBy | |
| `CalendarEvent` | title, type, startDate, endDate, audience | |
| `StudentDocument` | student, type, title, file, status, reviewNote | |
| `Complaint` | student, category, subject, description, priority, status, assignedTo, responses | |
| `Achievement` | student, title, category, certificate, status | |
| `FeeStructure`, `Fee` | structure: program, semester, amount, dueDate; fee: student, amountDue, amountPaid, payments | Fee is unique on student + structure; status is a virtual field |
| `Company`, `Job`, `Application` | job: company, package, eligibility, deadline, isPublished; application: job, student, status, history | Application is unique on job + student |
| `Book`, `BookIssue` | book: ISBN (unique), copies; issue: book, student, dueDate, returnedAt, fine | Text index on book title and authors |
| `AuditLog` | user, userName, role, action, entity, entityId, details, ip, timestamp | |
| `Settings` | singleton document (key `main`) with institution and policy values | |

Most models use Mongoose `timestamps`, which add `createdAt` and `updatedAt`.

### 9.2 Entity relationships (core entities)

```mermaid
erDiagram
    USER ||--o| STUDENT : "has profile"
    USER ||--o| FACULTY : "has profile"
    USER }o--o{ STUDENT : "parent children"
    DEPARTMENT ||--o{ PROGRAM : contains
    DEPARTMENT ||--o{ STUDENT : has
    DEPARTMENT ||--o{ FACULTY : has
    PROGRAM ||--o{ STUDENT : enrolls
    PROGRAM ||--o{ SECTION : has
    PROGRAM ||--o{ SUBJECT : offers
    SECTION ||--o{ STUDENT : groups
    FACULTY ||--o{ SUBJECT : teaches
    STUDENT ||--o{ ENROLLMENT : has
    SUBJECT ||--o{ ENROLLMENT : has
    STUDENT ||--o{ ATTENDANCE : has
    SUBJECT ||--o{ ATTENDANCE : tracks
    STUDENT ||--o{ MARK : receives
    SUBJECT ||--o{ MARK : has
    SUBJECT ||--o{ ASSIGNMENT : has
    ASSIGNMENT ||--o{ SUBMISSION : receives
    STUDENT ||--o{ SUBMISSION : makes
    STUDENT ||--o{ FEE : owes
    STUDENT ||--o{ APPLICATION : submits
    JOB ||--o{ APPLICATION : receives
    COMPANY ||--o{ JOB : posts
    BOOK ||--o{ BOOKISSUE : issued
    STUDENT ||--o{ BOOKISSUE : borrows
```

Relationships are implemented as ObjectId references with Mongoose `ref`, and joined with `populate` or `$lookup` aggregation.

## 10. Backend Design

| Path | Purpose |
|---|---|
| `app/api/**/route.ts` | Thin route handlers: declare roles, schemas and uploads, then call a service |
| `services/*.service.ts` | Business logic per module (auth, student, faculty, attendance, marks, assignment, schedule, notice, fee, placement, library, report, import, dashboard, settings, files...) |
| `services/{access,scope,accounts,attendance,audit,enrollment,grading,notify}.ts` | Shared domain helpers |
| `services/crud.ts`, `lib/crud-routes.ts` | Generic CRUD factory used by configuration-style resources |
| `models/*.ts` | Mongoose models (hot-reload safe via `registerModel`) |
| `validators/*.ts` | Zod schemas |
| `lib/` | `mongodb` (cached connection), `auth`, `api`, `permissions`, `upload`, `query`, `csv`, `security`, `rate-limit`, `env`, `seed` |


## 11. REST API Overview

All endpoints are served under `/api`. Except for login, token refresh, password reset requests, public settings and the health check, they require a session (httpOnly `sms_access` cookie, or `Authorization: Bearer <access token>` for API clients). The complete endpoint list is in [`docs/API.md`](docs/API.md). The table below summarizes the route groups implemented under `app/api/`.

| Base path | Purpose | Main access |
|---|---|---|
| `/auth` | login, refresh, logout, me, change/forgot/reset password | Public (login, refresh, forgot, reset); signed-in (others) |
| `/users` | account administration | Admin |
| `/students`, `/faculty` | profiles, CSV export, activate/deactivate | Admin (write); staff, student, parent (scoped read) |
| `/departments`, `/programs`, `/academic-years`, `/semesters`, `/sections`, `/subjects`, `/enrollments` | academic structure | Admin (write); signed-in (read) |
| `/attendance` | marking, class roster and reports, student summaries, corrections | Faculty and admin (write); scoped read |
| `/marks` | entry, subject marks, performance, student results | Faculty and admin (write); scoped read |
| `/exams`, `/timetable` | exam schedule, seating, timetable | Admin (write); scoped read |
| `/assignments` | assignments, submissions, evaluation | Faculty/admin (write); students submit |
| `/notices`, `/notifications`, `/calendar`, `/materials` | communication and content | Staff (write); scoped read |
| `/documents`, `/complaints`, `/achievements` | student services | Student (create); admin/staff (review) |
| `/fees`, `/library`, `/placements` | fees, library, placements | Admin (manage); student/parent (scoped read) |
| `/reports` | `GET /reports/:type?format=json\|csv\|pdf` | Admin and faculty |
| `/import` | student CSV import (template, preview, confirm) | Admin |
| `/dashboard` | `/admin`, `/faculty`, `/student` | Respective roles |
| `/settings`, `/audit-logs` | institution settings and audit trail | Admin (settings public subset open) |
| `/files/:category/:filename` | download an uploaded file | Signed-in, with per-file ownership checks |
| `/health` | liveness check | Public |

**Response format**

```json
{ "success": true, "message": "OK", "data": {}, "meta": { "page": 1, "limit": 15, "total": 30, "pages": 2 } }
```

```json
{ "success": false, "message": "Validation failed", "errors": [{ "field": "email", "message": "Invalid email address" }] }
```

## 12. Frontend Design

- Pages live in `app/(auth)` (login, register, forgot/reset password) and `app/(dashboard)` (every signed-in page).
- `app/(dashboard)/layout.tsx` is a Server Component that reads the session cookie and passes the user to `AuthProvider`, so pages
  render signed-in on first paint; `components/layout/app-shell.tsx` provides the grouped sidebar, breadcrumbs, notification bell and user menu.
- Navigation is defined in `lib/nav.ts` (groups: Overview, People, Academics, Attendance & Exams, Coursework, Communication, Student Services, Administration), filtered by role.
- Shared components: `components/ui` (Button, Card, Modal, Badge, Field, Tabs, StatCard, DataTable, DynamicForm, ResourcePage, FileLink, Icon), `components/providers`.
- `lib/api-client.ts` is the browser API client (cookie auth, single-flight silent refresh). Every list page supports server-side search, sort, filters and pagination; destructive actions use a confirmation dialog.


## 13. Security Implementation

Measures below are present in the source code.

| Area | Implementation |
|---|---|
| Password storage | bcrypt hashing (cost 10); the password field is excluded from queries and JSON output by default |
| Password policy | Minimum 8 characters, with at least one lowercase letter, one uppercase letter and one digit (Zod on the server, mirrored in the client) |
| Tokens | Signed JWT access token (default 15 min) kept in browser memory only; refresh token (default 7 days) delivered as an httpOnly, SameSite=Strict, path-scoped cookie (`Secure` when `COOKIE_SECURE=true`), stored in the database only as a SHA-256 hash, rotated on use, revoked on logout, password change and deactivation; password change invalidates earlier access tokens |
| Login hardening | Same error message for wrong password and unknown email; a dummy hash comparison reduces timing differences; failed logins are audited; after 5 consecutive failures an account is locked for 15 minutes (HTTP 429, configurable) |
| Rate limiting | Auth endpoints: 20 requests per 15 minutes per client. Other API endpoints: 1,000 requests per 15 minutes (both configurable with `AUTH_RATE_LIMIT` / `API_RATE_LIMIT`) |
| Authorization | Role check on every route plus ownership scoping in the data layer |
| Input validation | Zod schemas on request bodies, queries and parameters |
| NoSQL injection | Requests whose body, query or params contain a key beginning with `$` or containing `.` are rejected with HTTP 400 (loud failure instead of silent stripping), in addition to Zod validation of every input |
| HTTP hardening | Helmet headers and Content-Security-Policy, `x-powered-by` disabled, CORS allow-list (`CLIENT_URL` plus optional `CORS_ORIGINS`), 1 MB request body limit, gzip compression, per-request `X-Request-Id` for log correlation |
| File uploads | Extension allow-list, MIME check, file-signature (magic number) check, random file names, 10 MB default size limit, at most 5 files per request, files stored outside the static web root and served only through the authenticated `/api/files` route with per-owner checks for sensitive categories |
| CSV export | Formula injection neutralized |
| Audit | Security-relevant actions are logged, and sensitive keys are redacted from audit details |
| Production guard | The server refuses to start in production with missing, placeholder or short (<32 characters) JWT secrets, and the seed script refuses to run in production unless `ALLOW_DEMO_SEED=true` is set for a demo deployment |

## 14. Configuration

Environment variables live in `.env.local` (template: `.env.example`; never committed).

| Variable | Purpose | Default |
|---|---|---|
| `MONGODB_URI` | Local MongoDB | `mongodb://localhost:27017/student_management` |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Signing keys (32+ chars required in production) | dev-only fallbacks |
| `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES_DAYS` | Token lifetimes | `15m`, `7` |
| `APP_URL` | Public URL (used in password-reset links) | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_NAME` | Default app name before settings load | Student Management System |
| `UPLOAD_DIR`, `MAX_FILE_SIZE_MB` | Local upload folder and size limit | `uploads`, `10` |
| `COOKIE_SECURE`, `TRUST_PROXY` | HTTPS cookies; proxy hops for client IP | `false`, `0` |
| `AUTH_RATE_LIMIT`, `API_RATE_LIMIT`, `LOCKOUT_MAX_ATTEMPTS`, `LOCKOUT_MINUTES` | Rate limits / lockout | `20`, `1000`, `5`, `15` |
| `SEED_PASSWORD`, `ALLOW_DEMO_SEED` | Demo data | `ChangeMe@123`, `false` |

The app listens on port **3000** (`next dev` / `next start`).


## 15. Installation and Running the Project

```bash
npm install
cp .env.example .env.local      # set JWT_SECRET / JWT_REFRESH_SECRET
npm run seed                    # optional demo data (needs MongoDB running locally)
npm run dev                     # http://localhost:3000
```

Production: `npm run build` then `npm start` (set `NODE_ENV=production`, strong secrets). First administrator without demo data:
`ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run create-admin`.

Demo accounts (password = `SEED_PASSWORD`): `admin@college.local`, `meera.iyer@college.local` (faculty), `s250001@college.local` ... `s250030@college.local` (students), `parent@college.local`.


## 16. Testing

- `npm test` - Vitest. 103 API integration tests (ported from the original Jest/Supertest suites) call the real Route Handlers
  in-process against an in-memory MongoDB (`tests/support/request.ts`): auth, RBAC, students, attendance, marks, assignments,
  timetable/exams, notices, documents, complaints, fees, library, placements, reports, import, hardening.
- `npm run lint`, `npm run typecheck`, `npm run build` - also run in CI (`.github/workflows/ci.yml`).


## 17. Project Structure

```
app/            (auth)/ (dashboard)/ api/  layout.tsx  globals.css
components/     ui/ layout/ providers/ students/
lib/            mongodb, auth, api, permissions, upload, query, csv, nav, api-client, format, validation, seed
models/         Mongoose models
services/       business logic
validators/     Zod schemas
hooks/          React hooks
scripts/        seed.ts, create-admin.ts
tests/          Vitest suites
proxy.ts        page gate (Next middleware)
instrumentation.ts   background job bootstrap
public/  uploads/  docs/
```


## 18. Current Limitations

These points describe the project as it currently exists.

- **No email delivery.** Password-reset links are printed to the server console (and returned in the response in development). There is no mail server integration.
- **Fee payments are simulated.** No payment gateway is integrated. The payment methods are recorded values and the default method is `simulated`.
- **Notifications are in-app only.** There are no email, SMS or push notifications.
- **Local file storage.** Uploads are stored on the server's disk (a Docker volume in the container setup), not in object storage. The application does not replicate them; use `scripts/backup.sh` for backups.
- **HTTPS is delegated to a reverse proxy.** The app speaks plain HTTP; for any non-local deployment put it behind a TLS-terminating proxy and set `COOKIE_SECURE=true`.
- **No real-time updates.** Notifications are fetched, not pushed (no WebSocket layer).
- **Single-institution design.** Settings are a single record, so the system serves one institution.

## 19. Possible Future Enhancements

These are suggestions and are **not** implemented.

- Email delivery for password reset and notifications.
- A real payment gateway for fee collection.
- Email/SMS notification channels and a WebSocket push layer.
- Multi-institution (multi-tenant) support.
- Cloud or object storage for uploaded files.

## 20. Conclusion

The Student Management System brings student, faculty, academic, attendance, marks, examination, assignment, communication and administrative functions into one role-based web application. It uses a React front end, an Express REST API and a MongoDB database, and it applies validation, access control and audit logging throughout. The project shows how a manual, spreadsheet-based academic workflow can be replaced with a single system that gives each type of user an appropriate and secure view of the data.
