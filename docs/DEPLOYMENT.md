# Deployment Guide

Everything runs on infrastructure you control: MongoDB and uploaded files stay in local Docker volumes, with no cloud accounts, hosted
databases or paid services. This guide covers the Docker route (recommended), running without Docker, HTTPS, backups and upgrades.

## 1. Docker Compose (recommended)

Requirements: Docker Engine 24+ with the Compose plugin.

```bash
cp .env.example .env
```

Edit `.env`:

| Setting | What to do |
|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | **Required.** Two different random strings, 32+ characters. Generate each with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `APP_URL` | The address people type into the browser, e.g. `https://sms.mycollege.edu` (used for password-reset links) |
| `COOKIE_SECURE` | Set `true` once the site is served over HTTPS |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | The first administrator (password must meet the policy: 8+ chars, upper, lower, digit) |

Start the stack and create the administrator:

```bash
docker compose up -d --build
docker compose run --rm tools          # creates the admin from ADMIN_* (idempotent)
```

Open `http://localhost:3000` (or your `APP_PORT`) and sign in. The first thing to do is **Settings → college name/logo**, then
**Academic Setup** (departments, programs, years, semesters, sections) and create users or use **Bulk Import**.

### What you get

| Service | Details |
|---|---|
| `mongo` | MongoDB 7 on the `mongo-data` volume. **Not** published to the host — only the app can reach it |
| `app` | Node 22 (Alpine), non-root, read-only filesystem, all Linux capabilities dropped, `no-new-privileges`. Serves the API **and** the built web app. Uploads on the `uploads` volume |
| healthchecks | `mongo` pings itself; `app` polls `/api/ready` (which is 503 until MongoDB is connected). `app` starts only after MongoDB is healthy |
| `tools` | One-off tasks (`create-admin`, optional demo seed). Not started by `up` |

### Demo data (never use on a real system)

```bash
# in .env: ALLOW_DEMO_SEED=true and SEED_PASSWORD=<something you choose>
docker compose up -d
docker compose --profile demo run --rm tools node src/seed.js
```

Demo logins are listed in the README. Set `ALLOW_DEMO_SEED=false` again afterwards.

## 2. HTTPS

The app speaks plain HTTP on its port; terminate TLS in front of it. Any reverse proxy works. A minimal Caddy example
(automatic certificates when the host is publicly reachable; for an intranet use your own CA or `tls internal`):

```caddyfile
sms.mycollege.edu {
    reverse_proxy app:3000
}
```

Then in `.env` set `APP_URL=https://sms.mycollege.edu`, `COOKIE_SECURE=true`, and `TRUST_PROXY=1` (one proxy hop), and
`docker compose up -d`. Without `COOKIE_SECURE=true` browsers on HTTPS still work, but the refresh cookie lacks the `Secure` flag.

## 3. Backups and restore

```bash
scripts/backup.sh                          # writes backups/<timestamp>/{mongo.archive.gz,uploads.tar.gz}
scripts/restore.sh backups/20260101-120000 # asks for confirmation, then replaces data
```

Schedule `backup.sh` (cron / Task Scheduler) and copy the `backups/` folder off the machine. **Test a restore** before you rely on it.

## 4. Upgrading

```bash
git pull
docker compose up -d --build     # rebuilds the image; volumes (data, uploads) are untouched
```

Roll back by checking out the previous version and running the same command. Take a backup before upgrading.

## 5. Operations

| Task | Command |
|---|---|
| Logs (structured JSON, one line per event; request lines carry an `X-Request-Id`) | `docker compose logs -f app` |
| Status / health | `docker compose ps` · `curl localhost:3000/api/ready` |
| Restart | `docker compose restart app` |
| Stop (graceful: finishes in-flight requests, closes MongoDB) | `docker compose down` (add `-v` **only** to delete all data) |
| Reset a forgotten admin password | Use **Forgot password**; there is no email server, so the link is written to the app log: `docker compose logs app \| grep "PASSWORD RESET"` |

### Password-reset links

Password-reset links and faculty approval notices are sent by SMTP. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASS` and `MAIL_FROM` in `.env`. With `SMTP_HOST` empty, mails are only printed to the application log (and, outside
production, the reset link is shown on the forgot-password page).

Accounts: the admin is created with `create-admin`; students are added by the admin (admission number + email) and then sign up
themselves; faculty sign up and are approved or rejected under **User accounts**. Students reset their password with email +
admission number; if the email on file is wrong, the admin edits it on the student record.

### Tuning

All knobs are environment variables (see the README table): token lifetimes, upload size, rate limits (`AUTH_RATE_LIMIT`,
`API_RATE_LIMIT`), lockout policy (`LOCKOUT_MAX_ATTEMPTS`, `LOCKOUT_MINUTES`), extra CORS origins (`CORS_ORIGINS`).

## 6. Without Docker

Requirements: Node.js 20.19+, MongoDB 6+ running locally.

```bash
npm install
cp .env.example .env.local
# edit .env.local: strong JWT secrets, APP_URL=http://<host>:3000, MONGODB_URI
npm run build
ADMIN_EMAIL=you@college.edu ADMIN_PASSWORD='Str0ng!Passw0rd' npm run create-admin
NODE_ENV=production npm start   # http://localhost:3000
```

Run it under a process manager (systemd, PM2, or a Windows service wrapper) so it restarts on boot, and back up MongoDB with
`mongodump --db student_management` plus the `uploads/` folder.

## 7. Pre-launch checklist

- [ ] Two distinct, random JWT secrets set (the server refuses to start in production otherwise)
- [ ] `APP_URL` equals the public address; `COOKIE_SECURE=true` behind HTTPS
- [ ] `ALLOW_DEMO_SEED=false`; no demo accounts exist
- [ ] First administrator created with a strong password; the `ADMIN_PASSWORD` line removed from `.env.local`
- [ ] MongoDB is **not** reachable from outside the host/network
- [ ] A backup was taken **and** restored successfully on a test machine
- [ ] `npm run lint`, `npm test` and `npm run build` pass on the version you deploy
