# PWP Manpower Planner — V3 Complete

Secure 14-day production and agency manpower planning with Firebase
Authentication, server-enforced roles, Firestore persistence and validated Excel
draft import.

## V3 highlights

- Firebase Authentication using Email/Password.
- Firebase ID Token verification on the Node server for every protected request.
- Roles stored securely in Firebase Authentication Custom Claims.
- Admin user management: create users, assign roles, enable or disable access.
- HR can access the latest Published Plan only. Draft, History, Settings and all
  write endpoints return HTTP 403 for HR.
- Production Manager and Admin retain all V2 planning and configuration features.
- Local ExcelJS reader; the browser does not use an Excel CDN.
- Excel template download, full validation, error list, preview and confirmation.
- Replace Entire Draft Plan and Update Listed Machines Only import modes.
- Light/Dark themes and responsive desktop/mobile layout.

## Data safety guarantees

V3 keeps the original Firestore names and shape:

- Collection: `pwp_manpower`
- Document: `state`
- History subcollection: `pwp_manpower/state/history`

The server never reads `data/seed-state.json`, never creates the Firestore state
document, never resets data on startup and has no local database fallback. If the
existing `pwp_manpower/state` document is missing, V3 returns a clear error and
writes nothing.

Saving a draft updates only `planStartDate`, `settings`, `machines` and `plans`
with Firestore merge semantics. Publishing updates `published` and adds one
history snapshot. Existing unrelated top-level fields are preserved.

Excel import happens in browser memory first and changes Draft Plan only. It
cannot change Published Plan, History, machine master data, settings or users.
Nothing reaches Firestore until Production Manager/Admin presses **Save Draft**.

## Roles

| Role | Access |
| --- | --- |
| Admin | All planning screens and Firebase user/role administration |
| Production Manager | Dashboard, plan, actions, published plan, settings, history, Save Draft and Publish |
| HR | Latest Published Plan only, read-only |

There is no public sign-up. A user cannot create or promote their own account.
An Admin also cannot demote or disable the currently signed-in Admin account.

## Project contents

- `server.js` — secure HTTP server, Firebase Admin integration and protected APIs.
- `public/` — login, planner, Admin page, styles and local browser libraries.
- `public/assets/PWP_14_Day_Plan_Upload_Template.xlsx` — direct-download template.
- `scripts/create-first-admin.js` — one-time first Admin setup.
- `tests/` — role/API, validation and data-isolation tests.
- `firestore.rules` — deny direct browser Firestore access; Admin SDK remains usable.
- `START_HERE.txt`, `FIREBASE_SETUP.md`, `AUTH_SETUP.md`, `RENDER_SETUP.md` — complete setup instructions.

## Local commands

```bash
npm install
npm test
npm start
```

Open `http://localhost:3000`.

The local app connects to the same Firebase project configured in `.env`. It
does not create a local data store.

## Excel columns

The `Plan` sheet contains exactly:

1. Machine ID
2. Sequence
3. Status
4. Product
5. Duration
6. Workers/Day

Status is `RUN` or `STOPPED`. Sequence starts at 1 for each machine. Duration is
1–14 and total Duration per machine cannot exceed 14. Stopped periods use zero
workers. The importer reports every detectable error with its Excel row number.

## Deployment

Follow the files in this order:

1. `FIREBASE_SETUP.md`
2. `AUTH_SETUP.md`
3. `RENDER_SETUP.md`
4. `START_HERE.txt`
