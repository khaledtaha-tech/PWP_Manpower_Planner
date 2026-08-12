# Render Deployment Setup

## 1. Create or update the Web Service

- Service type: **Web Service**
- Runtime: **Node**
- Branch: `main`
- Root Directory: leave blank when `package.json` is in the repository root
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`
- Node version: the project declares `22.x` in `package.json`

Do not deploy as a Static Site. Authentication and role enforcement require the
Node server.

## 2. Add environment variables

Add the following in **Render Service → Environment**:

### Required Firebase Admin variables

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

### Required Firebase Web Authentication variables

- `FIREBASE_WEB_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_APP_ID`

### Optional Web App values

- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`

Render supplies `PORT`; do not create a fixed production PORT value.

For `FIREBASE_PRIVATE_KEY`, paste the entire private key. It may use real line
breaks or escaped `\n`. Do not add `FIRST_ADMIN_*` variables to Render after the
first Admin has been created locally.

## 3. Deploy

1. Save the environment variables.
2. Trigger **Manual Deploy → Deploy latest commit** if Render does not redeploy
   automatically.
3. Watch the build log until `npm install` completes.
4. Watch the runtime log for:
   - `PWP Manpower Planner V3 running...`
   - `Firebase connected...`
5. Open `/api/health`. `ok` must be `true`.

If health says that `pwp_manpower/state` was not found, stop. Do not seed a new
document. Confirm that Render variables point to the original Firebase project.

## 4. Authorize the Render hostname

1. Copy the Render hostname only, such as `pwp-manpower-planner.onrender.com`.
2. In Firebase, open **Authentication → Settings → Authorized domains**.
3. Add the hostname without `https://`.
4. Reload the application and sign in.

## 5. Production verification

1. Sign in as Admin and confirm all tabs plus Admin are visible.
2. Create one Production Manager and one HR test account.
3. Sign out and sign in as Production Manager; confirm planning, Save Draft and
   Publish work and Admin is absent.
4. Sign out and sign in as HR; confirm only Published Plan is visible.
5. In a browser developer console, an HR call to `/api/state` without a valid
   Production/Admin token must return 403.
6. Download the Excel template.
7. Import a valid file, review Preview, use Update Listed Machines Only, and
   confirm the page shows Unsaved changes.
8. Confirm Published Plan and History remain unchanged until Save/Publish.

## 6. Future updates

For later code changes:

1. Commit and push to the same GitHub repository.
2. Render deploys the new commit.
3. Environment variables and Firestore data remain on Render/Firebase; they are
   not stored in GitHub.
4. Never upload `.env`, Service Account JSON, private keys or `node_modules`.
