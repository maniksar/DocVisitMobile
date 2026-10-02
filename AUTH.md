# DocVisitMobile account setup

The local app bootstraps one superadmin account. The user ID is `maniksar`, configured in `server.config.json`. The password is never stored in source control or in the config file.

1. Run `npm run dev`. The app builds the UI and starts the local API on `127.0.0.1:4322`.
2. On first visit, create the superadmin password in the one-time setup screen. Choose a new, unique password with at least 12 characters; do not reuse a password that has been posted in chat.
3. Sign in with user ID `maniksar` and the password chosen during setup.
4. Create doctor profiles from **Doctors**. Each account receives a random temporary password shown once. The doctor must change it before entering the workspace.

For scripted or production bootstrap, set `SUPERADMIN_PASSWORD` in the server environment before first startup. Configure the MariaDB connection with `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. `.env.local` is ignored by Git; `.env.example` is only a template.

`.env.local` is excluded from Git. The server stores users and sessions in MariaDB, hashes passwords with scrypt, stores only hashes of session tokens, uses HttpOnly same-site cookies, and expires sessions after 12 hours. Configure the `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` environment variables before starting the server.

This remains a prototype, not a production clinical system. Patient and
prescription records, including prescription attachment files, are stored in
MariaDB and served through authenticated APIs. Browser-stored appointments and
prescription samples are discarded and are not imported into MariaDB. Before
using real patient information, add backups and audit logging, and complete the
applicable privacy and security review.

For mobile installation and network requirements, see [README.md](./README.md).