# Firebase and release setup

This guide covers the current Hosting and extension-artifact workflows, plus the Firebase
Auth and Firestore project preparation needed by later backend milestones. The current
repository deploys only the static PWA to Firebase Hosting: it does not yet configure
Firebase Functions, Firestore rules/indexes, or Google sign-in in the application. Do not
enable production sign-in or store user data in Firestore until the corresponding backend
and security rules have been implemented and reviewed.

## Firebase projects

Create separate Firebase projects for development and production. Keep project IDs,
hosting sites, OAuth configuration, and service accounts distinct. Do not reuse Firebase
configuration or credentials from another application.

### Hosting (available now)

1. Create each project in the Firebase console and register a Web app. Record its Firebase
   web configuration (`apiKey`, `authDomain`, `projectId`, and `appId`); these web app
   identifiers are client configuration, not service-account credentials.
2. In the repository's `firebase.json`, Hosting publishes `client/dist` and rewrites
   application routes to `index.html`. Build before a manual local deployment:

   ```sh
   npm ci
   npm run test
   npm run lint
   npm run typecheck
   npm run build
   npx firebase-tools login
   npx firebase-tools deploy --only hosting --project YOUR_FIREBASE_PROJECT_ID
   ```

   The deploy command requires the Firebase CLI and a user authorized to deploy to that
   project. The GitHub workflow is the recommended production path after its protected
   environment has been configured.
3. Use the resulting Hosting URL as the production PWA origin. Add its hostname to
   Firebase Authentication's authorized domains only when enabling Google sign-in in a
   later milestone. The current unauthenticated PWA does not require that configuration.

The GitHub Hosting workflow uses `channelId: live`, so it publishes directly to the
project's live Hosting site. It does not create preview channels.

### Authentication and Firestore (prepare for a later milestone)

When the server-side identity/RBAC implementation is ready:

1. Enable Google as a sign-in provider under Firebase Authentication → Sign-in method.
   Configure the OAuth consent screen and authorized domains for the production and
   development Hosting origins. Add `localhost` only for local development.
2. Create Firestore in Native mode and choose its location carefully; the database
   location cannot be changed after creation.
3. Before deploying rules, implement and review deny-by-default Firestore rules and
   required indexes. Scope every user-owned document/query to the authenticated UID.
   Never treat a client allowlist or hidden sign-in UI as authorization.
4. Provision the server's service identity with only the required permissions. Do not put
   a Firebase Admin/service-account key in the PWA, extension, repository, or build
   artifact.

The repository currently has no `firestore.rules`, `firestore.indexes.json`, Functions
deployment configuration, or server Hosting rewrite. Consequently, the public
`GET /api/v1/meta/version` endpoint is available when running the Nest server, but this
repository does not yet deploy that API to Firebase. Keep `VITE_TALENTFLY_API_URL` unset
in the hosted PWA until a production API endpoint has been implemented and deployed.

For local API diagnostics, run `npm run dev:server` and set
`VITE_TALENTFLY_API_URL=http://localhost:8080/api/v1/meta/version` in `client/.env`.
Set `CLIENT_ORIGINS=http://localhost:5173` in `server/.env` for local browser requests.
For a deployed API, set `CLIENT_ORIGINS` to the exact comma-separated Hosting origins and
configure the client endpoint to the complete HTTPS version URL.

## GitHub Actions environments

In the repository's **Settings → Environments**, create both environments below. Set
deployment branch rules to `main`, require reviewer approval, and prevent self-review
where that option is available. The release workflows require manual dispatch from `main`;
they do not run with production credentials on pull requests.

### `production`

- Environment variable `FIREBASE_PROJECT_ID`: the production Firebase project ID.
- Environment secret `FIREBASE_SERVICE_ACCOUNT`: the JSON contents of a dedicated service
  account authorized to deploy Firebase Hosting to that project.
- Protect the service-account key as a credential. Rotate/revoke it if it is exposed.

Run **Actions → Deploy PWA to Firebase Hosting → Run workflow**, select `main`, and approve
the protected environment deployment. The job builds `client/dist` from the selected
commit and deploys it to the live Hosting channel.

### `extension-release`

- Environment variable `TALENTFLY_PWA_ORIGIN`: the production HTTPS origin only, for
  example `https://talentfly.example` (no path or trailing route).
- Configure required reviewers and restrict deployment branches to `main`.

Run **Actions → Package Chrome extension release → Run workflow** on `main`, approve it,
then download the `talentfly-extension-release` artifact from the completed workflow.
This artifact is a versioned ZIP for manual Chrome Web Store submission. The workflow
does not upload or publish to the store and needs no store credentials.

The regular CI workflow uses read-only repository permissions and a reserved `.invalid`
extension origin. Its ZIP is only a packaging/validation artifact; do not install or
submit it as a production release.

## Chrome Web Store publisher setup

1. Enroll in the Chrome Web Store developer program and complete publisher account
   verification.
2. Create the extension item in the Chrome Web Store Developer Dashboard by uploading a
   production ZIP generated by the protected `extension-release` workflow. The store
   assigns the published item its extension ID; this project does not currently pin an
   extension ID or automate store upload.
3. Complete the listing, support contact, screenshots, privacy disclosures, and any
   requested review declarations. The current popup only links to the PWA; update the
   listing and permission/privacy disclosures when extension capabilities change.
4. Submit for review and publish through the Developer Dashboard. Store review and
   approval are external to GitHub Actions.
5. For updates, increment the extension version consistently in
   `extension/package.json` and `extension/public/manifest.json`, confirm the manifest
   test passes, create the release artifact from `main`, and upload the ZIP to the same
   store item. Chrome Web Store requires each uploaded version to be greater than the
   currently published version.

The extension popup reports its installed manifest version and embedded commit/build time
to the PWA when the user opens it. Extension and Hosting releases are independent; the
server cannot infer the version installed in a user's browser.

## Workspace and build-version commands

From the repository root:

```sh
npm ci
npm run test
npm run lint
npm run typecheck
npm run build
```

Individual commands are available as `npm run <command>:<workspace>`, where workspace is
`client`, `extension`, or `server`; for example `npm run test:server`. Build a production
extension ZIP locally with:

```sh
VITE_TALENTFLY_PWA_ORIGIN=https://your-production-host.example npm run package:extension
```

The output is written to the ignored `extension/artifacts/` directory. Never commit the
artifact as a substitute for the protected release workflow.

The PWA and extension embed their package version, Git commit SHA, and build timestamp.
The server generates the same fields before server test, type-check, build, and development
commands. The server endpoint is `GET /api/v1/meta/version`; the client diagnostics page
queries it only when `VITE_TALENTFLY_API_URL` is configured. The **About & diagnostics**
page shows the extension build only after opening the PWA from the extension popup.

## First release checklist

- [ ] Confirm the correct Firebase production project and Hosting URL; keep development
      and production projects separate.
- [ ] Confirm `main` contains passing CI and review the PWA and extension validation
      artifacts.
- [ ] Configure and test the protected `production` and `extension-release` environments.
- [ ] Dispatch **Deploy PWA to Firebase Hosting** from `main`; verify the live URL,
      client-side routes, PWA install, and offline app shell.
- [ ] Set `TALENTFLY_PWA_ORIGIN` to that exact production origin and dispatch
      **Package Chrome extension release** from `main`.
- [ ] Install/test the downloaded release ZIP locally, then submit it manually through the
      Chrome Web Store Developer Dashboard.
- [ ] Verify the PWA's bundled build identity. Configure a production API endpoint only
      after the API has an approved deployment and HTTPS origin.
- [ ] Enable Google sign-in, provision Firestore, and deploy reviewed security rules only
      after the server-side auth/RBAC implementation is complete.

Keep user resumes, job descriptions, comparison reports, and provider credentials local.
Never place those values in Firebase Analytics, logs, GitHub artifacts, issue comments, or
deployment configuration.
