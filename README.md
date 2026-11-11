# TalentFly

TalentFly is an npm-workspaces monorepo for a local-first resume and job-description
comparison app.

## Workspaces

- `client/` — React, TypeScript, and Vite PWA
- `extension/` — TypeScript Chrome extension
- `server/` — NestJS API for explicitly scoped account/admin services

The PWA owns resume files, extracted text, comparison history, and provider credentials.
Do not upload user content or provider keys to the API, commit `.env` files, or add
credentials/service-account keys to build artifacts.

## Requirements and setup

- Node.js 24 or newer
- npm 11 or newer

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run build
```

Workspace-specific commands are available as `npm run <command>:<workspace>`, for
example `npm run test:client`, `npm run test:extension`, and `npm run test:server`.
Copy the relevant `.env.example` to `.env` only when local configuration is needed. Never
commit the resulting `.env` file.

## Development

```bash
npm run dev:client
npm run dev:server
```

The client is an installable PWA. Its branded shell and static assets are precached for
offline startup after the first visit; API calls and user/provider data are not added to a
service-worker runtime cache. A new service-worker version prompts the user before reload.
The browser generates its launch splash screen from the PWA manifest's app name, icon, and
background color. The UI uses system fonts so the app does not fetch fonts from a third
party.

## Chrome extension

The extension popup and icons can be built for local development with:

```bash
npm run build:extension
```

Load `extension/dist` through `chrome://extensions` → **Developer mode** → **Load
unpacked**. This development build links to `http://localhost:5173` and requests no
browser permissions yet.

Production packaging requires the deployed HTTPS PWA origin:

```bash
VITE_TALENTFLY_PWA_ORIGIN=https://your-talentfly-host.example npm run package:extension
```

The resulting versioned ZIP is written to the ignored `extension/artifacts/` directory.
The package script includes only built extension files, excludes source maps and local
credential files, and uses stable file ordering/timestamps for repeatable output.

## CI and release workflows

Every pull request and push to `main` runs tests, lint, type-checking, and builds separately
for all three workspaces, plus a repository secret scan. Once those checks pass, CI uploads
the PWA build and a versioned extension ZIP as validation artifacts. The CI extension ZIP
uses the reserved `.invalid` origin and is not suitable for installation or release.

Production actions are manual and do not run for pull requests:

- **Deploy PWA to Firebase Hosting** (`.github/workflows/deploy-hosting.yml`) builds and
  deploys Hosting from `main`. Configure a protected GitHub environment named `production`
  with required reviewers, a `FIREBASE_PROJECT_ID` environment variable, and a
  `FIREBASE_SERVICE_ACCOUNT` environment secret containing a Firebase deploy service
  account's JSON credentials.
- **Package Chrome extension release** (`.github/workflows/release-extension.yml`) runs
  from `main` and uploads a versioned ZIP for manual Chrome Web Store submission. Configure
  a protected `extension-release` environment with required reviewers and the
  `TALENTFLY_PWA_ORIGIN` environment variable set to the production HTTPS origin. Store
  upload/publishing credentials are not configured, so publishing remains a manual action.

Restrict both environments to the `main` branch and require approval before use. CI jobs
have read-only repository permissions and do not receive production credentials.
