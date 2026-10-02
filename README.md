# DocVisitMobile

DocVisitMobile is a standalone, installable PWA clone of DocVisit. It uses a
MariaDB database for authentication and browser-side demo record stores; it does
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

Create a MariaDB database and user, then configure `DB_HOST`, `DB_PORT`,
`DB_NAME`, `DB_USER`, and `DB_PASSWORD` in `.env.local`. The app creates its
`docvisit_users` and `docvisit_sessions` tables on startup. Never commit
`.env.local` or put database credentials in source control.

### Create the database tables manually

If you want to create the tables before starting the app, select your
DocVisitMobile database in Hostinger phpMyAdmin and import
[`database/schema.sql`](./database/schema.sql). The script creates the users
and sessions tables using the default `DB_TABLE_PREFIX=docvisit`. If you set a
different prefix, rename both table names and the sessions foreign-key
constraint in the script to match it. The app's database user needs permission
to create tables and manage sessions.

The script creates the schema only; it does not add an admin account or store a
password. On first app start, set `SUPERADMIN_PASSWORD` in the server
environment. DocVisitMobile creates the `maniksar` admin account and stores a
one-way password hash. Patient, appointment, and prescription data are not
stored in these MariaDB tables; they remain in browser storage.

## Hostinger deployment

Use a Hostinger Node.js-capable hosting plan (or VPS) with Node.js 22.12 or
newer and a persistent writable app directory. Deploy this repository's `main`
branch with the project root as the application root, `npm ci` as the install
command, `npm run build` as the build command, and `npm start` as the start
command. Set these server-side environment variables in Hostinger:

- `NODE_ENV=production`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` for the
  MariaDB database and user created in Hostinger hPanel.
- `DB_SSL=true` if the MariaDB provider requires TLS. Keep certificate
  verification enabled unless the provider explicitly requires otherwise.
- `SUPERADMIN_PASSWORD` to a unique, randomly generated password of at least
  12 characters. Enter it only in Hostinger's environment-variable settings,
  never in Git or chat. It is used to create the initial `maniksar` admin when
  the app starts against an empty database.
- `DB_TABLE_PREFIX` to a different alphanumeric/underscore prefix if this
  MariaDB database is shared with another app. The default is `docvisit`.

The app creates the prefixed MariaDB tables when it starts, binds to `0.0.0.0`
in production, and honors Hostinger's `PORT` environment variable. Attach
`mypatients.in` to the app in hPanel and enable Hostinger SSL before sharing
the site. The old SQLite authentication data, if any, is not imported
automatically; provision accounts again after deployment.

For integration tests, provide a dedicated, disposable MariaDB test database
with `MARIADB_TEST_HOST`, `MARIADB_TEST_PORT`, `MARIADB_TEST_DATABASE`,
`MARIADB_TEST_USER`, and `MARIADB_TEST_PASSWORD`. The test suite creates and
drops uniquely prefixed tables in that database.

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
