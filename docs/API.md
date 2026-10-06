# API Reference

Base URL (local): `http://localhost:3000/api`  ·  All bodies are JSON unless noted (`multipart/form-data` for uploads).

## Conventions

**Authentication** — `Authorization: Bearer <accessToken>` on every endpoint except those marked *Public*.
Access tokens live 15 minutes; use `POST /auth/refresh` (refresh tokens rotate and are single use).

**Token transport** — browser clients send `X-Token-Transport: cookie`; the server then sets two `httpOnly; SameSite=Strict` cookies (`sms_access`, path `/`; `sms_refresh`, path `/api/auth`; `Secure` when `COOKIE_SECURE=true`) and returns no tokens in the JSON body. `/auth/refresh` and `/auth/logout` need no body. Other clients (scripts, tests) omit the header and receive `accessToken`/`refreshToken` in the JSON body and send `Authorization: Bearer`.

**Request ids** — every response carries `X-Request-Id` (a client-supplied value is echoed); it also appears in the server log.

**Operations** — `GET /health` (liveness) and `GET /ready` (503 until MongoDB is connected) are public and unauthenticated.

**Success envelope**
```json
{ "success": true, "message": "OK", "data": { }, "meta": { "page": 1, "limit": 20, "total": 134, "pages": 7 } }
```
**Error envelope**
```json
{ "success": false, "message": "Validation failed: email — Invalid email address",
  "errors": [ { "field": "email", "message": "Invalid email address" } ] }
```

| Status | Meaning |
|---|---|
| 400 | Validation failed / malformed input / business-rule violation |
| 401 | Missing, invalid or expired token; wrong credentials |
| 403 | Authenticated but role/ownership does not allow it (or account deactivated) |
| 404 | Not found (also used when a record exists but is outside your scope) |
| 409 | Conflict — duplicate key, already reviewed, room/faculty clash, dependent records |
| 413 | Request body too large |
| 429 | Rate limited, or account temporarily locked after repeated failed logins |
| 500 | Unexpected error (details only in server logs; no stack traces in production) |

**List endpoints** accept `?page=1&limit=20&search=text&sort=field|-field` plus resource-specific filters.
`limit` is capped at 100. Unknown `sort` fields are ignored. Search input is escaped (never treated as a regex).

**Roles**: `admin`, `faculty`, `student`, `parent`. "Scoped" means results/actions are limited to the caller's own data
(student → self, parent → linked children, faculty → subjects they teach and the students enrolled in them).

**Uploads**: field name in brackets. Allowed: pdf, doc(x), ppt(x), xls(x), txt, csv, png, jpg, zip; max `MAX_FILE_SIZE_MB` (default 10).
Extension, MIME type and file signature are all checked. Files are stored in `uploads/<category>/` under random names and
are served only through `GET /files/:category/:filename` (login required; documents/submissions/complaints/achievements are owner- or staff-only).

---

## Auth — `/auth`
| Method & path | Auth | Body / params | Response · errors |
|---|---|---|---|
| POST `/auth/login` | Public (20/15 min/IP) | `{ email, password }` | `{ user, profile, accessToken, refreshToken* }` · 401 wrong credentials, 403 deactivated, 429 locked (5 failures → 15 min) |
| POST `/auth/refresh` | Public | `{ refreshToken }` or the refresh cookie | new `{ accessToken, refreshToken* }` (old one is revoked) · 401 |
| POST `/auth/forgot-password` | Public | `{ email }` | Always the same generic message. Dev mode returns `resetLink`; the link is also written to the API console (no email server is used) |
| POST `/auth/reset-password` | Public | `{ token, newPassword }` | 400 invalid/expired token or weak password |
| POST `/auth/logout` | Any | `{ refreshToken }` or the refresh cookie | Revokes that refresh token and clears the cookie |
| GET `/auth/me` | Any | – | `{ user, profile }` |
| POST `/auth/change-password` | Any | `{ currentPassword, newPassword }` | New tokens; all other sessions are signed out · 400 |

Password policy: ≥ 8 chars with upper-case, lower-case and a digit. There is no public self-registration: accounts are created by an admin.

## Users — `/users` (admin)
| Method & path | Body / params | Notes |
|---|---|---|
| GET `/users` | `search, role, isActive` | |
| GET `/users/:id` | | includes linked children (parents) |
| POST `/users` | `{ name, email, role: admin\|parent, password?, children?: [studentId] }` | students/faculty must be created via their own endpoints. Returns `temporaryPassword` once when no password is given |
| PATCH `/users/:id` | `{ name?, role?, isActive?, children? }` | cannot deactivate/demote yourself; role changes are audited |
| POST `/users/:id/reset-password` | | returns a one-time temporary password |

## Students — `/students`
| Method & path | Roles | Body / params |
|---|---|---|
| GET `/students` | admin, faculty (scoped), parent (children) | `search` (name, ID, email, phone), `department, program, section, semester, status, batch, admissionYear, gender`, sort `firstName, lastName, studentId, semester, status, admissionYear` |
| GET `/students/me` · PATCH `/students/me` | student | PATCH accepts only `phone, address, guardian, emergencyContact` (everything else is stripped) |
| POST `/students/me/photo` | student | multipart `[file]` png/jpg |
| GET `/students/:id` · `/students/:id/enrollments` | admin, faculty (scoped), student (self), parent (child) | 403 outside scope |
| POST `/students` | admin | `studentId, firstName, lastName, email, department, program, semester, status` (+ optional phone, dateOfBirth, gender, address, guardian, emergencyContact, batch, section, academicYear, admissionYear, admissionDate, password). Creates the login account and enrols the student in the semester's subjects. 409 duplicate ID/email |
| PUT/PATCH `/students/:id` | admin | any subset of the above; keeps the account in sync |
| DELETE `/students/:id` | admin | **soft delete** → status `inactive`, login disabled |
| POST `/students/:id/activate` | admin | |
| GET `/students/export` | admin | CSV (respects filters) |

## Faculty — `/faculty`
`GET /faculty` (admin, faculty) · `GET /faculty/me` (faculty) · `GET /faculty/:id` (includes taught subjects) · `POST /faculty` (admin: `employeeId, firstName, lastName, email, department, designation?, status?, joiningDate?, phone?, password?`) ·
`PUT/PATCH /faculty/:id` · `PUT /faculty/:id/subjects` `{ subjects: [id], sections?: [id] }` (admin) · `DELETE /faculty/:id` (deactivate) · `POST /faculty/:id/activate` · `GET /faculty/export`.

## Academic structure (read: any authenticated user · write: admin)
Each supports `GET /x`, `GET /x/:id`, `POST /x`, `PUT|PATCH /x/:id`, `DELETE /x/:id`. Deleting an item that is referenced returns **409** with what depends on it.

| Path | Key fields |
|---|---|
| `/departments` | `name, code, description?, head?, isActive` |
| `/programs` | `name, code, department, durationYears, totalSemesters, isActive` |
| `/academic-years` | `name, startDate, endDate, isCurrent` (only one current) |
| `/semesters` | `name, number, academicYear, startDate, endDate, isCurrent` |
| `/sections` | `name, program, department, batch, semester, capacity` |
| `/subjects` | `code, name, department, program, semester, credits, type: theory\|practical\|elective, faculty?, sections?` · `?mine=true` (faculty: taught; student: enrolled) · new non-elective subjects auto-enrol matching students |
| `/enrollments` | GET `?subject=` (staff) · POST `{ student, subject }` (admin, e.g. electives) · DELETE `/:id` (drop) · POST `/enrollments/sync` (admin) |

## Attendance — `/attendance`
| Method & path | Roles | Details |
|---|---|---|
| GET `/attendance/classes` | admin, faculty | subject × section pairs the caller may mark |
| GET `/attendance/roster?subject&section&date` | admin, faculty (own subject) | enrolled active students of the section + existing status |
| POST `/attendance` | admin, faculty (own subject) | `{ subject, section, date, records: [{ student, status: present\|absent\|late\|excused, remarks? }] }` — upserts (no duplicates; one record per subject/student/date), logs `modifiedBy/At` on changes, rejects future dates, duplicate or non-enrolled students, sends low-attendance warnings |
| GET `/attendance/student/:id/summary` | scoped; `:id` may be `me` | overall %, per-subject %, per-month %, `threshold`, `belowThreshold` (`?from&to&subject`) |
| GET `/attendance/student/:id/history` | scoped | paginated daily records |
| GET `/attendance/class-report?subject&section&from&to` | admin, faculty | per-student % |
| POST `/attendance/corrections` | student | `{ attendance, requestedStatus, reason }` — one pending request per record |
| GET `/attendance/corrections?status=` | all (scoped) | |
| PATCH `/attendance/corrections/:id` | admin, faculty (own subject) | `{ status: approved\|rejected, reviewNote? }`; approval updates the record |

Attendance % = (present + late) ÷ (present + late + absent); excused sessions are ignored. The warning threshold is `Settings.attendanceThreshold`.

## Marks — `/marks`
| Method & path | Roles | Details |
|---|---|---|
| POST `/marks` | admin, faculty (own subject) | `{ subject, examType: assignment\|quiz\|internal\|practical\|mid\|final, maxMarks, records: [{ student, marksObtained, remarks? }] }` — upserts; marks ≤ max; students must be enrolled; edits audited (`MARKS_CHANGED`) and students notified |
| GET `/marks/subject/:subjectId?examType&section` | admin, faculty (own) | class sheet |
| GET `/marks/subject/:subjectId/performance` | admin, faculty (own) | average, highest, lowest, pass rate, grade distribution |
| GET `/marks/student/:id/results?semester` | scoped (`me` allowed) | per-subject total/%/grade, SGPA per semester, CGPA (credit-weighted, from the configurable grade scale) |
| DELETE `/marks/:id` | admin, faculty (own) | |

## Exams & timetable
| Path | Access | Notes |
|---|---|---|
| `/exams` GET/POST/PUT/PATCH/DELETE | GET: admin (all), faculty (own/invigilating, published), student/parent (published, own program+semester). Write: admin | `name, type, subject, program, semester, date, startTime, endTime, room?, invigilators?, maxMarks, isPublished`. Room clashes → 409. Publishing notifies students |
| POST `/exams/:id/seating` | admin | `{ perRoomCapacity?, prefix? }` generates seats alphabetically by student ID |
| GET `/exams/:id/my-seat` | student | |
| `/timetable` GET/POST/PUT/PATCH/DELETE | GET list: admin, faculty · write: admin | `day, startTime, endTime, subject, faculty, room, section`; overlapping slots for the same faculty, room or section → 409 |
| GET `/timetable/me` | student, parent, faculty | personal weekly schedule |

## Assignments — `/assignments`
| Method & path | Roles | Details |
|---|---|---|
| GET `/assignments` | all (scoped) | students also get `submissionStatus` (pending/submitted/late/evaluated/overdue); `?subject&status&search` |
| POST `/assignments` | admin, faculty (own subject) | multipart: `title, subject, deadline, maxMarks, description?, sections[]?, [attachment]` |
| GET/PATCH/DELETE `/assignments/:id` | as above | GET includes the student's `submission` |
| POST `/assignments/:id/submit` | student (enrolled) | multipart `[files]` (≤ 5) and/or `text`; after the deadline the submission is stored as `late`; resubmission allowed until evaluated |
| GET `/assignments/:id/submissions` | admin, faculty (own) | every student with status |
| PATCH `/assignments/submissions/:submissionId/evaluate` | admin, faculty (own) | `{ marks ≤ maxMarks, feedback? }` |

## Notices, notifications, materials, calendar
| Path | Access | Notes |
|---|---|---|
| `/notices` GET | all — filtered by audience, department/program/year/section, publish and expiry dates | `?priority&search` |
| POST `/notices` | admin (any target) · faculty (must give a `section` they teach; audience forced to students) | multipart: `title, description, audience, department?, program?, year?, section?, priority, publishDate?, expiryDate?, [attachment]` — notifies the targeted users |
| PATCH/DELETE `/notices/:id` | admin, or the faculty author | |
| GET `/notifications` (`?unread=true`) · GET `/notifications/unread-count` · PATCH `/notifications/:id/read` · POST `/notifications/read-all` · DELETE `/notifications/:id` | any user (own only) | |
| GET `/materials` · POST `/materials` (multipart `[file], title, subject, type`) · DELETE `/materials/:id` | GET: scoped to enrolled/taught subjects · write: admin, faculty (own subject) | |
| `/calendar` GET | all (audience-filtered), `?from&to&type` | POST/PATCH/DELETE: admin |

## Student services
| Path | Access | Notes |
|---|---|---|
| GET `/documents` · POST `/documents` (multipart `[file], title, type`) · DELETE `/documents/:id` | admin (all), student/parent (own) | students cannot delete verified documents |
| PATCH `/documents/:id/review` | admin | `{ status: verified\|rejected\|reupload_requested, reviewNote? }` (note required unless verifying) |
| GET/POST `/complaints` (multipart, optional `[attachment]`) · GET `/complaints/:id` · POST `/complaints/:id/respond` `{ message }` · PATCH `/complaints/:id` | student (own), admin (all), faculty (assigned) | PATCH: `{ status?, assignedTo? }` — only admins assign; students can only close their own ticket. Statuses: open → assigned → in_progress → resolved → closed |
| GET/POST `/achievements` (multipart `[certificate]`) · PATCH `/achievements/:id/verify` `{ status }` · DELETE | student (own), admin/faculty verify (faculty: their students) | |
| `/fees/structures` (admin) GET/POST/DELETE · POST `/fees/structures/:id/assign` | admin | assignment is idempotent |
| GET `/fees` (`?status=pending\|partial\|paid\|overdue`) · POST `/fees/:id/pay` `{ amount, method? }` · GET `/fees/:id/receipt/:receiptNo` | admin, student/parent (own; parents read-only) | **Simulated** payments — no gateway. Overpayment → 400 |
| `/placements/companies` (admin) · `/placements/jobs` GET (admin, student) / POST / PATCH / DELETE (admin) · POST `/placements/jobs/:id/apply` (student) · GET `/placements/applications` · PATCH `/placements/applications/:id/status` (admin) | | students see `eligible` + `reasons` (CGPA, program, deadline); ineligible applications → 400 |
| `/library/books` GET · POST/PATCH/DELETE (admin) · POST `/library/issue` `{ book, student }` · POST `/library/return/:issueId` · GET `/library/issues` | | atomic copy accounting, loan limit 5, fine = started overdue days × `Settings.libraryFinePerDay` |

## Reports, import, dashboards, settings, audit
| Path | Access | Notes |
|---|---|---|
| GET `/reports/:type` `type ∈ students, faculty, attendance, marks, results, fees, placements, complaints` | admin; faculty only `attendance` and `marks` for their subjects | `?format=json\|csv\|pdf` + filters, `search`, `from`, `to`; CSV cells are formula-injection safe |
| GET `/import/students/template` · POST `/import/students/preview` (multipart CSV `[file]`) · POST `/import/students/confirm` `{ importId }` | admin | preview validates every row (formats, department/program codes, duplicates in DB and file) and writes nothing; confirm imports only the valid rows and returns one-time temporary passwords |
| GET `/dashboard/admin` · `/dashboard/faculty` · `/dashboard/student?student=` | role-specific | |
| GET `/settings/public` (Public: college name + logo) · GET `/settings` · PUT `/settings` (admin) · POST `/settings/logo` (admin, multipart `[logo]`) | | attendance threshold, pass %, grade scale, library rules, contact info |
| GET `/audit-logs` (`user, action, entity, role, from, to, search`) · GET `/audit-logs/actions` | admin | passwords/tokens are never stored |
| GET `/health` | Public | liveness |
| GET `/files/:category/:filename` (`?download=1`) | login; owner/staff for sensitive categories | |

### Permission summary
| Capability | Admin | Faculty | Student | Parent |
|---|:-:|:-:|:-:|:-:|
| Manage users, students, faculty, structure, exams, timetable, fees, placements, library, settings, audit | ✔ | – | – | – |
| Mark attendance / enter marks | ✔ | own subjects | – | – |
| Assignments & materials | ✔ | own subjects | view/submit | – |
| Publish notices | ✔ | own classes | – | – |
| View own attendance/marks/timetable/exams | – | – | ✔ | children |
| Complaints, documents, achievements | manage | assigned tickets / verify | own | view |
