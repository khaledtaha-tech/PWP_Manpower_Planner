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
  assert.ok(!sources.some(source => /firebase/i.test(source)));
  assert.ok(sources.includes('/vendor/exceljs.min.js'));
  for (const source of sources) {
    assert.ok(source.startsWith('/'), `External source found: ${source}`);
    assert.ok(fs.existsSync(path.join(root, 'public', source)), `Missing local asset: ${source}`);
  }
});

test('required screens, role markers, template and setup files exist', () => {
  for (const marker of ['id="loginScreen"', 'id="tab-admin"', 'id="importDialog"', 'class="tab role-admin"', 'id="logoutBtn"']) assert.ok(html.includes(marker));
  for (const file of ['README.md', 'START_HERE.txt', 'AUTH_SETUP.md', 'HOSTINGER_SETUP.md', '.env.example', 'package-lock.json']) assert.ok(fs.existsSync(path.join(root, file)), file);
  assert.ok(fs.existsSync(path.join(root, 'public', 'assets', 'PWP_14_Day_Plan_Upload_Template.xlsx')));
});

test('planning screen includes the manual Redistribute action', () => {
  assert.match(html, /id="redistributeBtn"[^>]*>Redistribute</);
  assert.match(app, /function redistributeWorkforce\(\)/);
});

test('Excel import accepts standard and macro-enabled Open XML workbooks', () => {
  assert.match(html, /id="excelFileInput"[^>]*accept="\.xlsx,\.xlsm"/);
  assert.match(app, /\\\.\(xlsx\|xlsm\)\$/);
  assert.ok(app.includes('Select an .xlsx or .xlsm file.'));
});

test('authentication UI matches local MySQL and JWT capabilities', () => {
  assert.ok(app.includes("localStorage.getItem('pwp_token')"));
  assert.ok(!html.includes('Continue with Google'));
  assert.ok(!html.includes('Create Account'));
  assert.ok(html.includes('Forgot Password?'));
  assert.ok(html.includes('data-password-target="loginPassword"'));
  assert.ok(html.includes('id="changePasswordDialog"'));
  assert.ok(html.includes('Accounts are created and managed by the PWP Admin.'));
  assert.ok(fs.existsSync(path.join(root, 'scripts', 'reset-user-password.js')));
});

test('server uses MySQL repository and performs server-side authorization', () => {
  assert.ok(server.includes("require('./repository')"));
  assert.ok(server.includes('await authService.authenticate'));
  assert.ok(server.includes('await requireRole'));
  assert.ok(!server.includes('firebase'));
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
