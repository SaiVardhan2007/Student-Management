# Contributing

Requirements: Node.js 20.19+ and a local MongoDB.

```bash
npm install
cp .env.example .env.local     # set the two JWT secrets
npm run seed                   # demo data
npm run dev                    # http://localhost:3000
```

Before opening a pull request run `npm run lint && npm run typecheck && npm test && npm run build`.

- **Architecture**: route handlers (`app/api`) stay thin — validation, authorisation, then a call into `services/`. Business logic never lives in `route.ts`.
- **Authorisation** is enforced on the server (`roles` on the route plus scoping in `services/access.ts`); never rely on hiding UI.
- **Tests**: every behaviour change comes with a test in `tests/` (Vitest, runs route handlers against an in-memory MongoDB).
- Do not commit `.env.local` or anything under `uploads/`.
