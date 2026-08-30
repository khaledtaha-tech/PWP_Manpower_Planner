# PWP Manpower Planner

Secure 14-day production and agency manpower planning for plastic factories. The
Node.js application runs on Hostinger and stores users, the current draft and
published snapshots in MySQL. Authentication uses bcrypt password hashes and JWT.

## Main features

- Admin, Production Manager and HR roles enforced by the Node server.
- Admin user creation, role changes, and account enable/disable controls.
- HR receives the latest Published Plan only; draft and administration endpoints
  return HTTP 403.
- 14-day machine plan, daily workforce forecast, and Agency request/release plan.
- Floating Crusher operation by default, using actual surplus only. Mandatory is
  the exceptional mode and reserves at least two workers even when Agency labor
  must be requested or retained.
- Excel validation, preview and Update/Replace modes.
- The current template uses `Line ID` and `Machine Name` together, while legacy
  six-column files remain supported.
- Request/release decisions use the notice period as a rolling protection window:
  an action effective after three days protects the highest need in the following
  three-day block.
- Imported machine IDs that do not yet exist are added automatically. Names and
  departments are read from the optional `Lists` sheet when available.
- Every publish creates a permanent snapshot in MySQL `history`.

## Data safety

- Existing `app_state` data is never cleared on startup.
- Saving updates the single draft JSON document only.
- Publishing inserts a new immutable history row.
- Excel import changes browser draft memory first and never publishes by itself.
- The old `M1`/`M2` placeholder state is migrated only when it contains exactly
  those two machines and both plans are empty.

## Local commands

```bash
npm install
npm test
npm start
```

Open `http://localhost:3000`.

## Environment variables

Copy `.env.example` to `.env` and set `DB_HOST`, `DB_USER`, `DB_PASSWORD`,
`DB_NAME`, and a random `JWT_SECRET` containing at least 32 characters. `PORT` is
optional. Never commit `.env`.

## Excel columns

The current `Plan` sheet contains exactly: `Line ID`, `Machine Name`, `Sequence`,
`Status`, `Product`, `Duration`, and `Workers/Day`. Status is `RUN` or `STOPPED`;
sequences start at 1 per line; total duration per line cannot exceed 14 days;
stopped periods use zero workers. The importer validates that each machine name
matches its Line ID. Older six-column files beginning with `Machine ID` are still
accepted for backward compatibility.

Crusher machines such as `L-13` remain in the machine master and `Lists` metadata,
but must not be entered as production rows in `Plan`. Crusher allocation is
calculated from the application-wide Floating/Mandatory switch for the full
14-day plan.

See `START_HERE.txt`, `AUTH_SETUP.md`, and `HOSTINGER_SETUP.md`.
