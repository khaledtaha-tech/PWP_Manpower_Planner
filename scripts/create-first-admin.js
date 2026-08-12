require('dotenv').config({ quiet: true });

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function main() {
  const projectId = required('FIREBASE_PROJECT_ID');
  const clientEmail = required('FIREBASE_CLIENT_EMAIL');
  const privateKey = required('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');
  const email = required('FIRST_ADMIN_EMAIL').toLowerCase();
  const password = required('FIRST_ADMIN_PASSWORD');
  const displayName = String(process.env.FIRST_ADMIN_DISPLAY_NAME || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('FIRST_ADMIN_EMAIL is invalid');
  if (password.length < 8) throw new Error('FIRST_ADMIN_PASSWORD must contain at least 8 characters');

  const app = getApps().length ? getApps()[0] : initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId
  });
  const auth = getAuth(app);
  let user;
  try {
    user = await auth.getUserByEmail(email);
    if (user.customClaims?.role === 'admin') {
      console.log(`Admin already configured: ${email}`);
      return;
    }
    console.log(`Using existing Firebase Authentication user: ${email}`);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    user = await auth.createUser({ email, password, displayName: displayName || undefined, emailVerified: false });
    console.log(`Created Firebase Authentication user: ${email}`);
  }
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), role: 'admin' });
  await auth.revokeRefreshTokens(user.uid);
  console.log(`Admin role assigned successfully to ${email}. Sign in through the application.`);
}

main().catch(error => {
  console.error(`First Admin setup failed: ${error.message}`);
  process.exitCode = 1;
});
