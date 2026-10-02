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

## Install on a phone

Deploy the app behind HTTPS, open its URL in the phone's browser, and choose
**Add to Home Screen** (iOS Safari) or **Install app** (supported Android
browsers). The manifest and service worker enable installation and cache static
assets only; API responses and HTML pages containing account data are never
cached. The app still requires a connection to its server for sign-in and API
requests.

This is a prototype. Use sample data only; do not enter real patient information.
