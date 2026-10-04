# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Email the maintainers (see the repository owner's profile) with a
description, reproduction steps and the affected version. You will get an acknowledgement within 3 working days and a fix or
mitigation plan within 14 days.

## Supported versions

Only the latest release on the default branch receives security fixes.

## Security model in brief

| Concern | Control |
|---|---|
| Authentication | bcrypt password hashes, JWT access tokens (15 min, memory-only in the browser), rotating refresh tokens in an `httpOnly; SameSite=Strict` cookie, stored hashed server-side |
| Brute force | Per-IP rate limits on auth routes; per-account lockout (5 failures → 15 min); uniform error messages and constant-time-ish unknown-user path |
| Authorization | Role checks on every route plus ownership scoping in the data layer |
| Injection | Zod validation on all input; `$`-operator and dotted keys rejected (400); regex-escaped search; allow-listed sort fields |
| XSS / clickjacking | React output escaping, strict Content-Security-Policy, Helmet headers; tokens are not readable from storage |
| File uploads | Extension + MIME + magic-number checks, random names, size caps, served only via an authenticated route |
| Transport | HTTPS via your reverse proxy; `COOKIE_SECURE=true` marks cookies `Secure`; HSTS sent by Helmet |
| Supply chain | `npm audit` gate and Dependabot; lockfiles committed; production image installs with `npm ci --omit=dev` |
| Runtime | Container runs as a non-root user, read-only root filesystem, capabilities dropped, MongoDB not exposed |
| Auditing | Security-relevant actions are written to the audit log with sensitive fields redacted |

## Hardening checklist for operators

See the pre-launch checklist in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#7-pre-launch-checklist).
