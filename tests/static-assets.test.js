const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('every literal DOM ID used by app.js exists in index.html', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const used = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]));
  const missing = [...used].filter(id => !ids.has(id));
  assert.deepEqual(missing, []);
});

test('all browser libraries are local project assets and no CDN is used', () => {
  const sources = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(sources.includes('/vendor/firebase-compat.js'));
  assert.ok(sources.includes('/vendor/exceljs.min.js'));
  for (const source of sources) {
    assert.ok(source.startsWith('/'), `External source found: ${source}`);
    assert.ok(fs.existsSync(path.join(root, 'public', source)), `Missing local asset: ${source}`);
  }
});

test('required screens, role markers, template and setup files exist', () => {
  for (const marker of ['id="loginScreen"', 'id="tab-admin"', 'id="importDialog"', 'class="tab role-admin"', 'id="logoutBtn"', 'id="openCreateAccountBtn"', 'id="googleSignInBtn"', 'id="forgotPasswordBtn"']) assert.ok(html.includes(marker));
  for (const file of ['README.md', 'START_HERE.txt', 'FIREBASE_SETUP.md', 'AUTH_SETUP.md', 'RENDER_SETUP.md', '.env.example', 'firestore.rules', 'package-lock.json']) assert.ok(fs.existsSync(path.join(root, file)), file);
  assert.ok(fs.existsSync(path.join(root, 'public', 'assets', 'PWP_14_Day_Plan_Upload_Template.xlsx')));
});

test('planning screen includes the manual Redistribute action', () => {
  assert.match(html, /id="redistributeBtn"[^>]*>Redistribute</);
  assert.match(app, /function redistributeWorkforce\(\)/);
});

test('public authentication flows exist without allowing self-assigned roles', () => {
  assert.ok(app.includes('createUserWithEmailAndPassword'));
  assert.ok(app.includes('GoogleAuthProvider'));
  assert.ok(app.includes('sendPasswordResetEmail'));
  const registrationDialog = html.match(/<dialog id="createAccountDialog"[\s\S]*?<\/dialog>/)?.[0] || '';
  assert.ok(registrationDialog.includes('Create Account'));
  assert.ok(!registrationDialog.includes('name="role"'));
  assert.ok(!registrationDialog.includes('newUserRole'));
});

test('server has no seed or local database fallback and keeps original Firestore path', () => {
  assert.ok(server.includes("collection('pwp_manpower').doc('state')"));
  assert.ok(server.includes("stateRef().collection('history')"));
  assert.ok(!server.includes('seed-state.json'));
  assert.ok(!server.includes('local-state.json'));
  assert.ok(!server.includes('local-history.json'));
  assert.ok(server.includes('{ merge: true }'));
});

test('project contains no private key value or service account JSON', () => {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full); else files.push(full);
    }
  }
  walk(root);
  const suspiciousNames = files.filter(file => /service.?account.*\.json$|firebase-adminsdk.*\.json$/i.test(path.basename(file)));
  assert.deepEqual(suspiciousNames, []);
  const privateKeyMarker = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  for (const file of files.filter(item => !item.endsWith('.xlsx') && !item.endsWith('.zip'))) {
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(!content.includes(privateKeyMarker), `Private key marker found in ${file}`);
  }
});
