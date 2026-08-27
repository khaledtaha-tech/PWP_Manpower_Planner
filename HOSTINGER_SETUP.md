# Hostinger Node.js and MySQL Setup

1. Create or open the Hostinger Node.js Web App for the repository.
2. Use Node.js 22, build command `npm install`, and start command `npm start`.
3. In phpMyAdmin, keep the existing data. For a new database only, run
   `database/schema.sql`.
4. Add `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and a random
   `JWT_SECRET` of at least 32 characters to the app environment.
5. Deploy the latest GitHub commit.
6. Open `/api/health`; it must return `ok: true` and `database: Connected`.
7. Sign in as Admin and confirm Machines & Settings, History, and user management.

Do not upload `.env` and do not place the project in ordinary PHP `public_html`.
The app must run through Hostinger's Node.js Web App service.
