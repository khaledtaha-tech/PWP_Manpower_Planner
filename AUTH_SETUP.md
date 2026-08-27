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

## Access expectations

- Admin: all screens and user administration.
- Production Manager: draft, settings, history, save and publish; no Admin tab.
- HR: latest Published Plan only.
- Signed-out requests return 401; unauthorized roles return 403.

`JWT_SECRET` is mandatory and must contain at least 32 characters.
