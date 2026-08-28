# MySQL and JWT Authentication

## Security model

- Passwords are stored only as bcrypt hashes in the MySQL `users` table.
- Login returns a JWT stored by the browser as `pwp_token`.
- Every protected request sends `Authorization: Bearer <token>`.
- The server verifies the JWT, then reloads the user from MySQL on every request.
  Disabling an account or changing its role therefore takes effect immediately.
- Roles are `admin`, `production_manager`, and `hr`.
- There is no public account registration. Admin creates users from the Admin tab.

## First Admin

If no Admin exists, set `FIRST_ADMIN_EMAIL`, `FIRST_ADMIN_PASSWORD`, and
`FIRST_ADMIN_DISPLAY_NAME` in the local `.env`, then run:

```bash
npm run create:first-admin
```

Remove the three `FIRST_ADMIN_*` values afterward. The command never changes an
existing user's role automatically.

## Forgotten password

Google sign-in and Firebase email recovery are intentionally unavailable in the
local MySQL/JWT version. For a locked-out account, temporarily set `RESET_EMAIL`
and `RESET_PASSWORD` in the Hostinger Node app environment, run:

```bash
npm run reset:password
```

Then remove both `RESET_*` values. The command updates only that user's bcrypt
password hash and does not modify plans, settings, roles, or history. Once signed
in, every user can use **Change Password** and must provide the current password.

## Access expectations

- Admin: all screens and user administration.
- Production Manager: draft, settings, history, save and publish; no Admin tab.
- HR: latest Published Plan only.
- Signed-out requests return 401; unauthorized roles return 403.

`JWT_SECRET` is mandatory and must contain at least 32 characters.
