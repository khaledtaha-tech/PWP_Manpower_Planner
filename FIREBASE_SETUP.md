# Firebase Setup — Preserve the Existing PWP Data

These steps use the existing Firebase project and the existing Firestore data.
Do not create another database and do not import `data/seed-state.json`.

## 1. Confirm the existing Firestore location

1. Open the Firebase project currently used by PWP V2.
2. Open **Firestore Database → Data**.
3. Confirm that collection `pwp_manpower` exists.
4. Open document `state` and confirm that the current `settings`, `machines`,
   `plans` and `published` data are present.
5. Confirm the `history` subcollection is under `pwp_manpower/state`.
6. Do not delete, rename, export/import over, or manually initialize this document.

V3 checks that this document exists. If it does not exist, the server reports
`STATE_NOT_FOUND` and writes nothing.

## 2. Enable Email/Password Authentication

1. In the same Firebase project, open **Build → Authentication**.
2. If Authentication has not been initialized, press **Get started**.
3. Open **Sign-in method**.
4. Select **Email/Password**.
5. Enable **Email/Password** and save.
6. Do not enable anonymous sign-in. V3 has no public sign-up endpoint or screen.

## 3. Get the Web App configuration

1. Open **Project settings → General**.
2. Under **Your apps**, select the existing Web App or create a Web App registration
   in this same Firebase project. Creating a Web App registration does not create
   a new Firestore database.
3. Copy these public Web App values:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `appId`
   - `storageBucket` if shown
   - `messagingSenderId` if shown
4. Map them to:
   - `FIREBASE_WEB_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_APP_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`

These Web App values are public configuration, not a Firebase Admin private key.

## 4. Get the Firebase Admin values

1. Open **Project settings → Service accounts**.
2. Select **Firebase Admin SDK**.
3. Generate a new private key JSON only if a secure existing service account is
   not already available.
4. Keep the downloaded JSON outside the project and outside GitHub.
5. Copy only these values into environment variables:
   - JSON `project_id` → `FIREBASE_PROJECT_ID`
   - JSON `client_email` → `FIREBASE_CLIENT_EMAIL`
   - JSON `private_key` → `FIREBASE_PRIVATE_KEY`
6. The private key may contain real line breaks or escaped `\n`. V3 accepts both.

Never place the JSON file, private key, `.env`, PEM or key files in `public/` or
GitHub. `.gitignore` blocks the common secret file patterns.

## 5. Firestore rules

The browser never contacts Firestore directly. It calls the Node API using a
Firebase ID Token; the server verifies the token and uses Firebase Admin SDK.
Therefore `firestore.rules` denies all direct client reads and writes.

Before publishing the supplied rules, confirm that this Firebase project is not
shared with another browser/mobile application that needs direct Firestore
access. If it is shared, merge rules carefully instead of replacing its existing
rules. Firebase Admin SDK on Render bypasses Firestore client rules.

To apply the supplied rules in a dedicated project:

1. Open **Firestore Database → Rules**.
2. Copy the content of `firestore.rules`.
3. Publish.

## 6. Authorized domains

1. Open **Authentication → Settings → Authorized domains**.
2. Keep `localhost` for local testing.
3. Add the exact Render hostname after the first deployment, for example:
   `your-pwp-service.onrender.com`.
4. Enter only the hostname, without `https://` and without a trailing path.

## 7. Final safety check

- `pwp_manpower/state` still contains the current data.
- No seed command was run.
- Email/Password is enabled.
- Web App and Firebase Admin environment values belong to the same project.
- Service Account JSON is outside the repository.
- Render hostname is authorized.
