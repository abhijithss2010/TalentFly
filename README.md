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

The extension workspace can be built with `npm run build:extension`; its full browser
manifest and packaging workflow will be completed in a later implementation step.
