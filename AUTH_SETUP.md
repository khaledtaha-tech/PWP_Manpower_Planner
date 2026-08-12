# Authentication and Roles Setup

## Security model

- The browser signs in with Firebase Authentication Email/Password.
- Each API request sends the Firebase ID Token in the `Authorization: Bearer`
  header.
- The server verifies the token with Firebase Admin SDK, checks that the user is
  not disabled and reads the `role` Custom Claim.
- Role values are `admin`, `production_manager` and `hr`.
- Changing a role or disabling a user revokes active refresh tokens.
- Hiding buttons is only a user-interface convenience; the server independently
  rejects every unauthorized endpoint.

## Create the first Admin

The first Admin is created by a local one-time script. There is intentionally no
web bootstrap endpoint because that could let a visitor create an Admin.

1. Install Node.js 22.
2. In the project folder, run `npm install`.
3. Copy `.env.example` to a new file named `.env`.
4. Fill these Firebase Admin values in `.env`:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`
5. Fill these one-time values:
   - `FIRST_ADMIN_EMAIL`
   - `FIRST_ADMIN_PASSWORD` — at least 8 characters
   - `FIRST_ADMIN_DISPLAY_NAME`
6. Run:

```bash
npm run create:first-admin
```

7. The script creates the Firebase Authentication user if needed and assigns the
   `admin` Custom Claim. It does not read or write Firestore.
8. Remove the three `FIRST_ADMIN_*` values from `.env` after success.
9. Never commit `.env`.

If the email already exists in Firebase Authentication, the script safely assigns
the Admin claim to that existing user. Running it again for an already configured
Admin makes no additional change.

## Create other users

1. Sign in to PWP with the first Admin.
2. Open the **Admin** tab.
3. Press **Create User**.
4. Enter name, email, temporary password and role.
5. Press **Create User**.

Users cannot create themselves. Only an authenticated Admin can call the server
endpoint that creates a user or changes a role.

## Change role or disable access

1. Open the **Admin** tab.
2. Choose a role and press **Save Role**, or press **Disable**.
3. The affected user's active Firebase sessions are revoked and the user must
   sign in again.
4. An Admin cannot change their own role or disable their own account from PWP.

## Expected access tests

- Admin: all tabs plus Admin.
- Production Manager: all planning tabs, no Admin tab.
- HR: Published Plan tab only.
- HR requests to `/api/state`, `/api/history`, `/api/publish` and
  `/api/admin/users` return HTTP 403 even if called manually.
- Signed-out requests to protected APIs return HTTP 401.

## Sign out

Press **Sign Out** in the top header. Firebase clears the local session. If the
draft contains unsaved changes, PWP asks for confirmation first.
