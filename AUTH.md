# DocVisitMobile account setup

The local app bootstraps one superadmin account. The user ID is `maniksar`, configured in `server.config.json`. The password is never stored in source control or in the config file.

1. Run `npm run dev`. The app builds the UI and starts the local API on `127.0.0.1:4322`.
2. On first visit, create the superadmin password in the one-time setup screen. Choose a new, unique password with at least 12 characters; do not reuse a password that has been posted in chat.
3. Sign in with user ID `maniksar` and the password chosen during setup.
4. Create doctor profiles from **Doctors**. Each account receives a random temporary password shown once. The doctor must change it before entering the workspace.

For scripted or production bootstrap, set `SUPERADMIN_PASSWORD` in the server environment before first startup. `.env.local` is ignored by Git; `.env.example` is only a template.

`.env.local` and the SQLite database are excluded from Git. The server hashes passwords with scrypt, stores only hashes of session tokens, uses HttpOnly same-site cookies, and expires sessions after 12 hours.

This is a local prototype, not a production clinical system. Patient, appointment, and prescription records in the current UI remain sample data in browser storage. Before using real patient information, move all records behind authenticated server APIs, use HTTPS and a managed database, add backups and audit logging, and complete the applicable privacy and security review.

For mobile installation and network requirements, see [README.md](./README.md).