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

The extension workspace can be built with `npm run build:extension`; its browser manifest
and packaging workflow will be completed in a later implementation step.
