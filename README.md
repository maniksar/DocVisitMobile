# DocVisitMobile

DocVisitMobile is a standalone, installable PWA clone of DocVisit. It keeps its
own SQLite authentication database and browser-side demo record stores; it does
not share the original app's local data.

## Run locally

```powershell
cd DocVisitMobile
npm ci
npm run dev
```

The app listens at <http://127.0.0.1:4322>. On first launch, create the
superadmin password from the same computer, then sign in and create doctor
accounts as needed. The first-run setup endpoint is intentionally restricted to
loopback connections.

## Hostinger deployment

Use a Hostinger Node.js-capable hosting plan (or VPS) with Node.js 22.12 or
newer and a persistent writable app directory. Deploy this repository's `main`
branch with the project root as the application root, `npm ci` as the install
command, `npm run build` as the build command, and `npm start` as the start
command. Set these server-side environment variables in Hostinger:

- `NODE_ENV=production`
- `SUPERADMIN_PASSWORD` to a unique, randomly generated password of at least
  12 characters. Enter it only in Hostinger's environment-variable settings,
  never in Git or chat. It is used to create the initial `maniksar` admin when
  the app starts against an empty database.
- `DATABASE_PATH` to a writable persistent path if the platform does not
  preserve the default `data/docvisitmobile.sqlite` between deployments.

The app binds to `0.0.0.0` in production and honors Hostinger's `PORT`
environment variable. Attach `mypatients.in` to the app in hPanel and enable
Hostinger SSL before sharing the site.

**Prototype only:** patient, appointment, and prescription records currently
live in each browser's local storage; the app does not provide a secure,
shared server-side clinical record store, audit logging, or a production
health-data compliance setup. Do not enter real patient information. Public
HTTPS hosting does not make the prototype appropriate for clinical use.

## Install on a phone

Deploy the app behind HTTPS, open its URL in the phone's browser, and choose
**Add to Home Screen** (iOS Safari) or **Install app** (supported Android
browsers). The manifest and service worker enable installation and cache static
assets only; API responses and HTML pages containing account data are never
cached. The app still requires a connection to its server for sign-in and API
requests.

This is a prototype. Use sample data only; do not enter real patient information.
