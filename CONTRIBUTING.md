# Contributing

## Setup

```bash
npm run install:all          # root tooling + server + client
npx --prefix e2e playwright install chromium   # once, for end-to-end tests
cp server/.env.example server/.env
npm run seed                 # demo data (needs a local MongoDB)
npm run dev:server           # terminal 1
npm run dev:client           # terminal 2
```

Node.js 20.19 or newer is required. The test suites do not need a local MongoDB: they fall back to an in-memory one.

## Before you open a pull request

```bash
npm run check        # lint + format check + server/client tests + build + production smoke test
npm run test:e2e     # real-browser tests, including accessibility scans
```

CI runs the same checks plus a dependency audit and a Docker image build.

## Conventions

- **Style** is enforced by ESLint and Prettier (`npm run lint:fix`, `npm run format`). `.editorconfig` covers editors.
- **API changes**: validate input with Zod, enforce role *and* ownership in the API (the UI only mirrors it), and update `docs/API.md`.
- **Tests**: every behaviour change comes with a test. API tests live in `server/tests`, UI tests in `client/src/__tests__`,
  browser flows in `e2e/tests`. Keep new pages free of WCAG A/AA violations (the axe scan will tell you).
- **Local-only principle**: do not add cloud services, hosted databases or paid APIs. Everything must run from this repository.
- **Secrets** never go in the repository; use `.env` files (git-ignored) and the `.env.example` templates.
- **Commits**: short imperative subject, details in the body. One logical change per commit.
- **Dependencies**: keep `npm audit --omit=dev` clean; prefer the standard library to adding a package for a few lines.
