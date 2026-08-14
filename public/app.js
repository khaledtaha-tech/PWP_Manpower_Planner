const PLAN_DAYS = 14;
const ROLE_ADMIN = 'admin';
const ROLE_PRODUCTION_MANAGER = 'production_manager';
const ROLE_HR = 'hr';

let state = null;
let dirty = false;
let activeTab = 'dashboard';
let storageHealth = null;
let auth = null;
let currentFirebaseUser = null;
let currentProfile = null;
let adminUsers = [];
let pendingImport = null;
let toastTimer = null;
let authNotice = '';
let registrationInProgress = false;
const readOnlyMode = new URLSearchParams(location.search).get('view') === 'published';

const $ = id => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
const roleLabel = role => ({ admin: 'Admin', production_manager: 'Production Manager', hr: 'HR' })[role] || role || 'No role';
const isPlanner = () => currentProfile && (currentProfile.role === ROLE_ADMIN || currentProfile.role === ROLE_PRODUCTION_MANAGER);
const isAdmin = () => currentProfile?.role === ROLE_ADMIN;

function getPreferredTheme() {
  const saved = localStorage.getItem('pwp-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('pwp-theme', theme);
  if ($('themeToggle')) $('themeToggle').textContent = theme === 'dark' ? '☀ Light' : '☾ Dark';
  if ($('loginThemeToggle')) $('loginThemeToggle').textContent = theme === 'dark' ? '☀ Light theme' : '☾ Dark theme';
}

function toggleTheme() {
  applyTheme((document.documentElement.dataset.theme || 'light') === 'dark' ? 'light' : 'dark');
}

function isoDate(date) {
  const value = new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function fmtDate(dateString, short = false) {
  if (!dateString) return '—';
  const date = new Date(`${dateString}T12:00:00`);
  return date.toLocaleDateString('en-GB', short ? { day: '2-digit', month: 'short' } : { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toast(message, type = 'neutral') {
  const element = $('toast');
  clearTimeout(toastTimer);
  element.textContent = message;
  element.className = `toast show ${type}`;
  toastTimer = setTimeout(() => element.classList.remove('show'), 3400);
}

function setButtonLoading(button, loading, label) {
  if (!button) return;
  if (loading) {
    button.dataset.previousHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="mini-spinner"></span>${esc(label || 'Working…')}`;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.previousHtml || esc(label || 'Done');
    delete button.dataset.previousHtml;
  }
}

function markDirty() {
  if (!isPlanner()) return;
  dirty = true;
  $('saveState').textContent = 'Unsaved changes';
  $('saveState').classList.add('unsaved');
}

async function publicFetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed: ${response.status}`);
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

async function fetchJson(url, options = {}) {
  if (!currentFirebaseUser) throw new Error('Sign in is required');
  const token = await currentFirebaseUser.getIdToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed: ${response.status}`);
    error.status = response.status;
    error.code = payload.code;
    if (response.status === 401 && auth) setTimeout(() => auth.signOut(), 0);
    throw error;
  }
  return payload;
}

function showLoading() {
  $('loadingScreen').hidden = false;
  $('loginScreen').hidden = true;
  $('appShell').hidden = true;
}

function showLogin(message = '') {
  $('loadingScreen').hidden = true;
  $('appShell').hidden = true;
  $('loginScreen').hidden = false;
  $('loginError').hidden = !message;
  $('loginError').textContent = message;
  $('loginNotice').hidden = !authNotice || Boolean(message);
  $('loginNotice').textContent = authNotice;
  if (!message) $('loginPassword').value = '';
  setTimeout(() => $('loginEmail')?.focus(), 0);
}

function showApp() {
  $('loadingScreen').hidden = true;
  $('loginScreen').hidden = true;
  $('appShell').hidden = false;
}

function applyRoleInterface() {
  const plannerVisible = isPlanner() && !readOnlyMode;
  document.querySelectorAll('.role-planner').forEach(element => { element.hidden = !plannerVisible; });
  document.querySelectorAll('.role-admin').forEach(element => { element.hidden = !isAdmin() || readOnlyMode; });
  $('userBadge').innerHTML = `<strong>${esc(currentProfile.displayName || currentProfile.email)}</strong><span>${esc(currentProfile.roleLabel || roleLabel(currentProfile.role))}</span>`;
  if (!plannerVisible) switchTab('published');
  else switchTab('dashboard');
}

function mapLoginError(error) {
  const code = String(error?.code || '');
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Email or password is incorrect.';
  if (code.includes('email-already-in-use')) return 'This email is already registered. Use Sign In or Forgot Password.';
  if (code.includes('invalid-email')) return 'Enter a valid email address.';
  if (code.includes('weak-password') || code.includes('password-does-not-meet-requirements')) return 'Password must contain at least 8 characters and meet the Firebase password policy.';
  if (code.includes('too-many-requests')) return 'Too many failed attempts. Please wait and try again.';
  if (code.includes('user-disabled')) return 'This account has been disabled. Contact an Admin.';
  if (code.includes('unauthorized-domain')) return 'This website domain is not authorized in Firebase Authentication.';
  if (code.includes('popup-closed-by-user')) return 'Google sign-in was cancelled.';
  if (code.includes('popup-blocked')) return 'The Google sign-in window was blocked by your browser.';
  if (code.includes('account-exists-with-different-credential')) return 'This email already uses another sign-in method. Sign in with your password or reset it.';
  if (code.includes('operation-not-allowed')) return 'This sign-in method is not enabled in Firebase Authentication.';
  if (code.includes('network-request-failed')) return 'Network error. Check your connection and try again.';
  return error?.message || 'Sign-in failed.';
}

function openCreateAccount() {
  $('createAccountForm').reset();
  $('registerEmail').value = $('loginEmail').value.trim();
  $('registerError').hidden = true;
  $('createAccountDialog').showModal();
  setTimeout(() => $('registerName').focus(), 0);
}

async function registerAccount(event) {
  event.preventDefault();
  const button = $('registerBtn');
  const password = $('registerPassword').value;
  const confirmation = $('registerPasswordConfirm').value;
  $('registerError').hidden = true;
  if (password !== confirmation) {
    $('registerError').textContent = 'Passwords do not match.';
    $('registerError').hidden = false;
    return;
  }
  registrationInProgress = true;
  setButtonLoading(button, true, 'Creating…');
  try {
    const credential = await auth.createUserWithEmailAndPassword($('registerEmail').value.trim(), password);
    await credential.user.updateProfile({ displayName: $('registerName').value.trim() });
    authNotice = 'Account created successfully. An Admin must approve your account and assign a role before you can sign in.';
    await auth.signOut();
    $('createAccountDialog').close();
    $('createAccountForm').reset();
    showLogin();
  } catch (error) {
    $('registerError').textContent = mapLoginError(error);
    $('registerError').hidden = false;
  } finally {
    registrationInProgress = false;
    setButtonLoading(button, false);
  }
}

async function signInWithGoogle() {
  const button = $('googleSignInBtn');
  authNotice = '';
  $('loginError').hidden = true;
  $('loginNotice').hidden = true;
  setButtonLoading(button, true, 'Connecting…');
  try {
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await auth.signInWithPopup(provider);
  } catch (error) {
    $('loginError').textContent = mapLoginError(error);
    $('loginError').hidden = false;
  } finally {
    setButtonLoading(button, false);
  }
}

function openForgotPassword() {
  $('forgotPasswordForm').reset();
  $('resetEmail').value = $('loginEmail').value.trim();
  $('resetError').hidden = true;
  $('forgotPasswordDialog').showModal();
  setTimeout(() => $('resetEmail').focus(), 0);
}

async function sendPasswordReset(event) {
  event.preventDefault();
  const button = $('sendResetBtn');
  $('resetError').hidden = true;
  setButtonLoading(button, true, 'Sending…');
  try {
    const email = $('resetEmail').value.trim();
    await auth.sendPasswordResetEmail(email);
    authNotice = `A password reset link has been sent to ${email}.`;
    $('forgotPasswordDialog').close();
    showLogin();
  } catch (error) {
    $('resetError').textContent = mapLoginError(error);
    $('resetError').hidden = false;
  } finally {
    setButtonLoading(button, false);
  }
}

async function initializeAuthentication() {
  showLoading();
  const config = await publicFetchJson('/api/config');
  if (!config.configured) {
    showLogin('Firebase web authentication is not configured. Follow AUTH_SETUP.md and add the required environment variables.');
    $('loginBtn').disabled = true;
    return;
  }
  if (!window.firebase?.initializeApp || typeof window.firebase.auth !== 'function') {
    showLogin('Firebase Authentication library could not be loaded.');
    return;
  }
  if (!window.firebase.apps.length) window.firebase.initializeApp(config.firebase);
  auth = window.firebase.auth();
  await auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
  auth.onAuthStateChanged(async user => {
    currentFirebaseUser = user;
    currentProfile = null;
    state = null;
    dirty = false;
    if (!user) {
      showLogin();
      return;
    }
    if (registrationInProgress) return;
    showLoading();
    try {
      currentProfile = await fetchJson('/api/me');
      authNotice = '';
      applyRoleInterface();
      showApp();
      if (isPlanner() && !readOnlyMode) await loadState();
      else await loadPublishedOnly();
    } catch (error) {
      console.error(error);
      if (error.code === 'ROLE_REQUIRED') {
        authNotice = 'Your account is awaiting Admin approval. Ask an Admin to assign your role, then sign in again.';
      }
      await auth.signOut().catch(() => {});
      showLogin(error.code === 'ROLE_REQUIRED' ? '' : error.message);
    }
  });
}

async function loadState() {
  const [loadedState, history, health] = await Promise.all([
    fetchJson('/api/state'),
    fetchJson('/api/history').catch(() => []),
    publicFetchJson('/api/health').catch(() => null)
  ]);
  state = loadedState;
  state.history = Array.isArray(history) ? history : [];
  storageHealth = health;
  state.settings.planDays = PLAN_DAYS;
  renderAll();
  dirty = false;
  $('saveState').textContent = 'Draft loaded';
  $('saveState').classList.remove('unsaved');
  if (isAdmin()) await loadUsers();
}

async function loadPublishedOnly() {
  storageHealth = await publicFetchJson('/api/health').catch(() => null);
  try {
    const published = await fetchJson('/api/published');
    state = { published };
  } catch (error) {
    if (error.status !== 404) throw error;
    state = { published: null };
  }
  renderPublished();
}

async function saveDraft(showToast = true) {
  if (!isPlanner()) return toast('You do not have permission to save the draft.', 'error');
  const button = $('saveDraftBtn');
  setButtonLoading(button, true, 'Saving…');
  try {
    const currentHistory = state.history || [];
    const result = await fetchJson('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    state = result.state;
    state.history = currentHistory;
    dirty = false;
    $('saveState').textContent = 'Draft saved';
    $('saveState').classList.remove('unsaved');
    if (showToast) toast('Draft saved successfully.', 'success');
    renderAll();
  } catch (error) {
    toast(error.message, 'error');
    throw error;
  } finally {
    setButtonLoading(button, false);
  }
}

async function publishPlan() {
  if (!isPlanner()) return toast('You do not have permission to publish.', 'error');
  const button = $('publishBtn');
  setButtonLoading(button, true, 'Publishing…');
  try {
    if (dirty) await saveDraft(false);
    const result = await fetchJson('/api/publish', { method: 'POST' });
    state.published = result.published;
    state.history = [result.published, ...(state.history || [])].slice(0, 30);
    toast('Plan published successfully.', 'success');
    $('saveState').textContent = `Published ${fmtDateTime(result.published.publishedAt)}`;
    renderAll();
    switchTab('published');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setButtonLoading(button, false);
  }
}

function getMachinePlan(machineId, source = state) {
  return source?.plans?.[machineId] || [];
}

function plannedDays(machineId, source = state) {
  return getMachinePlan(machineId, source).reduce((sum, period) => sum + Number(period.days || 0), 0);
}

function isCrusherMachine(machine) {
  const identity = `${machine?.id || ''} ${machine?.name || ''} ${machine?.department || ''}`.toLowerCase();
  return identity.includes('crusher');
}

function expandMachine(machine, source = state) {
  const output = [];
  for (const period of getMachinePlan(machine.id, source)) {
    for (let index = 0; index < Number(period.days || 0) && output.length < PLAN_DAYS; index += 1) {
      output.push({
        kind: period.kind,
        product: period.kind === 'stopped' ? 'Stopped' : period.product,
        workers: period.kind === 'stopped' ? 0 : Number(period.workers || 0)
      });
    }
  }
  while (output.length < PLAN_DAYS) output.push({ kind: 'unplanned', product: 'Unplanned', workers: 0 });
  return output.slice(0, PLAN_DAYS);
}

function calculateDaily(source = state) {
  const rows = [];
  const company = Number(source.settings.companyWorkers || 0);
  for (let index = 0; index < PLAN_DAYS; index += 1) {
    let total = 0;
    let active = 0;
    let unplanned = 0;
    let crusherNeed = 0;
    let crusherRunning = false;
    for (const machine of source.machines) {
      const cell = expandMachine(machine, source)[index];
      if (isCrusherMachine(machine)) {
        if (cell.kind === 'run') {
          crusherRunning = true;
          crusherNeed += Number(cell.workers || 0);
        }
      } else {
        total += Number(cell.workers || 0);
        if (cell.kind === 'run') active += 1;
      }
      if (cell.kind === 'unplanned') unplanned += 1;
    }
    const companySurplus = Math.max(0, company - total);
    rows.push({
      index,
      date: addDays(source.planStartDate, index),
      productionNeed: total,
      companyAvailable: company,
      companyUsed: Math.min(company, total),
      companySurplus,
      agencyNeed: Math.max(0, total - company),
      activeMachines: active,
      crusherNeed,
      crusherRunning,
      unplannedMachines: unplanned
    });
  }
  return rows;
}

function buildActions(source = state) {
  const daily = calculateDaily(source);
  const settings = source.settings;
  const floatLimit = Number(settings.floatingLimit || 0);
  const minimumRelease = Math.max(1, Number(settings.minReleaseDuration || 1));
  let level = Number(settings.currentAgency || 0);
  const actions = [];
  let index = 0;
  while (index < daily.length) {
    const need = daily[index].agencyNeed;
    if (need > level) {
      const quantity = need - level;
      actions.push({ type: 'REQUEST', qty: quantity, from: level, to: need, dayIndex: index, effective: daily[index].date, noticeBy: addDays(daily[index].date, -Number(settings.requestNoticeDays || 0)), reason: `Agency need rises to ${need} workers` });
      level = need;
      index += 1;
      continue;
    }
    const agencyForCrusher = Math.min(floatLimit, Math.max(0, daily[index].crusherNeed - daily[index].companySurplus));
    if (level - need > agencyForCrusher) {
      let end = index;
      const block = [];
      while (end < daily.length) {
        const row = daily[end];
        const allowance = Math.min(floatLimit, Math.max(0, row.crusherNeed - row.companySurplus));
        if (level - row.agencyNeed <= allowance) break;
        block.push({ ...row, allowance });
        end += 1;
      }
      if (block.length >= minimumRelease) {
        const target = Math.max(...block.map(day => day.agencyNeed + day.allowance));
        const quantity = level - target;
        if (quantity > 0) {
          actions.push({ type: 'RELEASE', qty: quantity, from: level, to: target, dayIndex: index, effective: daily[index].date, noticeBy: addDays(daily[index].date, -Number(settings.releaseNoticeDays || 0)), reason: `Surplus remains after production and planned Crusher allocation for ${block.length} day${block.length === 1 ? '' : 's'}` });
          level = target;
        }
      }
    }
    index += 1;
  }
  const projected = [];
  let projectedLevel = Number(settings.currentAgency || 0);
  for (let day = 0; day < PLAN_DAYS; day += 1) {
    actions.filter(action => action.dayIndex === day).forEach(action => { projectedLevel = action.to; });
    projected.push(projectedLevel);
  }
  daily.forEach((row, day) => {
    row.projectedAgency = projected[day];
    row.shortage = Math.max(0, row.agencyNeed - row.projectedAgency);
    row.surplus = Math.max(0, row.projectedAgency - row.agencyNeed);
    row.agencyAvailableForCrusher = Math.min(row.surplus, floatLimit);
    row.crusherAssigned = Math.min(row.crusherNeed, row.companySurplus + row.agencyAvailableForCrusher);
    row.crusherFromAgency = Math.max(0, row.crusherAssigned - Math.min(row.companySurplus, row.crusherNeed));
    row.crusherShortage = Math.max(0, row.crusherNeed - row.crusherAssigned);
    row.floating = row.crusherFromAgency;
    row.excessBeyondFloating = Math.max(0, row.surplus - row.crusherFromAgency);
  });
  return { actions, daily };
}

function noticeStatus(action) {
  const today = isoDate(new Date());
  if (action.noticeBy < today) return { label: 'Notice overdue', cls: 'bad' };
  if (action.noticeBy === today) return { label: 'Action today', cls: 'warn' };
  return { label: 'Planned', cls: 'good' };
}

function switchTab(name) {
  if (!isPlanner() && name !== 'published') name = 'published';
  if (name === 'admin' && !isAdmin()) name = isPlanner() ? 'dashboard' : 'published';
  activeTab = name;
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
  if (name === 'published') renderPublished();
  if (name === 'admin' && isAdmin()) loadUsers();
}
window.switchTab = switchTab;

function renderAll() {
  if (!state || !isPlanner()) return;
  renderStorageStatus();
  renderHeader();
  renderDashboard();
  renderPlan();
  renderActions();
  renderSettings();
  renderMachines();
  renderPublished();
  renderHistory();
}

function redistributeWorkforce() {
  if (!isPlanner()) return toast('You do not have permission to redistribute the workforce.', 'error');
  renderAll();
  const { daily } = buildActions(state);
  const crusherDays = daily.filter(row => row.crusherAssigned > 0).length;
  const crusherShortageDays = daily.filter(row => row.crusherShortage > 0).length;
  toast(`Workforce redistributed. Crusher covered on ${crusherDays} day${crusherDays === 1 ? '' : 's'}${crusherShortageDays ? `; shortage remains on ${crusherShortageDays} day${crusherShortageDays === 1 ? '' : 's'}.` : '.'}`, crusherShortageDays ? 'neutral' : 'success');
}

window.PWPWorkforce = { isCrusherMachine, calculateDaily, buildActions };

function renderHeader() {
  $('planStartDate').value = state.planStartDate;
  $('periodLabel').textContent = `${fmtDate(state.planStartDate)} → ${fmtDate(addDays(state.planStartDate, PLAN_DAYS - 1))} · ${PLAN_DAYS} days`;
}

function renderDashboard(source = state) {
  const { daily, actions } = buildActions(source);
  const peak = Math.max(...daily.map(row => row.agencyNeed), 0);
  const maximumProduction = Math.max(...daily.map(row => row.productionNeed), 0);
  const floatingDays = daily.filter(row => row.crusherAssigned > 0).length;
  const next = actions[0];
  $('dashboardCards').innerHTML = [
    ['Company Workers', source.settings.companyWorkers, 'Fixed daily capacity'],
    ['Current Agency', source.settings.currentAgency, 'On-site baseline'],
    ['Peak Agency Need', peak, `Peak production need: ${maximumProduction}`],
    ['Crusher Days', floatingDays, 'Covered from available surplus'],
    ['Next Action', next ? `${next.type} ${next.type === 'REQUEST' ? '+' : '-'}${next.qty}` : 'KEEP', next ? `Effective ${fmtDate(next.effective, true)}` : 'Current level is suitable']
  ].map(([label, value, sub]) => `<div class="kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`).join('');
  $('forecastTable').innerHTML = `<thead><tr><th>Date</th><th>Active Machines</th><th>Production Need</th><th>Company</th><th>Agency Need</th><th>Projected Agency</th><th>Crusher Need</th><th>Crusher Assigned</th><th>Status</th></tr></thead><tbody>${daily.map(row => {
    let status;
    let cls;
    if (row.unplannedMachines > 0) { status = `${row.unplannedMachines} unplanned`; cls = 'warn'; }
    else if (row.shortage > 0) { status = `Short ${row.shortage}`; cls = 'bad'; }
    else if (row.excessBeyondFloating > 0) { status = `High surplus ${row.excessBeyondFloating}`; cls = 'warn'; }
    else if (row.crusherShortage > 0) { status = `${row.crusherShortage} Crusher shortage`; cls = 'warn'; }
    else if (row.crusherAssigned > 0) { status = `Crusher covered`; cls = 'info'; }
    else { status = 'Balanced'; cls = 'good'; }
    return `<tr><td class="nowrap">${fmtDate(row.date, true)}</td><td>${row.activeMachines}</td><td><strong>${row.productionNeed}</strong></td><td>${row.companyAvailable}</td><td><strong>${row.agencyNeed}</strong></td><td>${row.projectedAgency}</td><td>${row.crusherNeed}</td><td><strong>${row.crusherAssigned}</strong></td><td><span class="badge ${cls}">${esc(status)}</span></td></tr>`;
  }).join('')}</tbody>`;
}

function renderPlan() {
  const start = state.planStartDate;
  $('machinePlans').innerHTML = state.machines.map(machine => {
    const periods = getMachinePlan(machine.id);
    const used = plannedDays(machine.id);
    const remaining = Math.max(0, PLAN_DAYS - used);
    const expanded = expandMachine(machine);
    const id = esc(machine.id);
    return `<div class="machine-card"><div class="machine-header"><div class="machine-title"><span class="machine-code">${id}</span><div><h3>${esc(machine.name)}</h3><p>${esc(machine.department || '')} · ${used}/${PLAN_DAYS} days planned ${remaining ? `· ${remaining} unplanned` : ''}</p></div></div><div class="machine-actions"><div class="progress-line"><span style="width:${Math.min(100, used / PLAN_DAYS * 100)}%"></span></div>${remaining ? `<button class="btn small secondary" onclick="openPeriodDialog('${id}')">+ Add Period</button>` : '<span class="plan-complete">Plan Complete</span>'}${remaining ? `<button class="btn small ghost" onclick="fillStopped('${id}')">Fill ${remaining} Stopped</button>` : ''}<button class="btn small danger" onclick="clearMachinePlan('${id}')">Clear</button></div></div><div>${periods.length ? periods.map((period, index) => `<div class="segment-row"><div class="segment-kind ${period.kind}">${period.kind === 'run' ? 'RUN' : 'STOPPED'}</div><div><strong>${esc(period.product)}</strong></div><div>${period.days} day${Number(period.days) === 1 ? '' : 's'}</div><div>${period.kind === 'run' ? `${period.workers} workers/day` : '0 workers'}</div><div class="segment-actions"><button class="btn small ghost" onclick="moveSegment('${id}',${index},-1)" ${index === 0 ? 'disabled' : ''}>↑</button><button class="btn small ghost" onclick="moveSegment('${id}',${index},1)" ${index === periods.length - 1 ? 'disabled' : ''}>↓</button><button class="btn small secondary" onclick="openPeriodDialog('${id}',${index})">Edit</button><button class="btn small danger" onclick="deleteSegment('${id}',${index})">Delete</button></div></div>`).join('') : '<div class="empty">No periods yet. Add a production run or stopped period.</div>'}</div><div class="timeline">${expanded.map((cell, index) => `<div class="day-cell ${cell.kind}" title="${esc(cell.product)} · ${cell.workers} workers"><span class="n">${fmtDate(addDays(start, index), true)}</span>${cell.kind === 'run' ? esc(cell.workers) : cell.kind === 'stopped' ? 'STOP' : '?'}</div>`).join('')}</div></div>`;
  }).join('');
}

function renderActions() {
  const { daily, actions } = buildActions(state);
  const totalRequests = actions.filter(action => action.type === 'REQUEST').reduce((sum, action) => sum + action.qty, 0);
  const totalReleases = actions.filter(action => action.type === 'RELEASE').reduce((sum, action) => sum + action.qty, 0);
  const peak = Math.max(...daily.map(row => row.agencyNeed), 0);
  const next = actions[0];
  $('actionSummary').innerHTML = [
    ['Current Agency', state.settings.currentAgency, 'Starting level'], ['Peak Need', peak, 'Within 14-day plan'],
    ['Planned Requests', totalRequests, `${actions.filter(action => action.type === 'REQUEST').length} action(s)`],
    ['Planned Releases', totalReleases, `${actions.filter(action => action.type === 'RELEASE').length} action(s)`],
    ['Next Action', next ? `${next.type} ${next.type === 'REQUEST' ? '+' : '-'}${next.qty}` : 'KEEP', next ? fmtDate(next.effective) : 'No change needed']
  ].map(([label, value, sub]) => `<div class="kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`).join('');
  if (!actions.length) {
    $('actionsTable').innerHTML = '<thead><tr><th>Decision</th><th>Reason</th></tr></thead><tbody><tr><td><span class="badge good">KEEP CURRENT WORKFORCE</span></td><td>Current agency level covers the 14-day requirement within the configured floating tolerance.</td></tr></tbody>';
    return;
  }
  $('actionsTable').innerHTML = `<thead><tr><th>Action</th><th>Qty</th><th>Agency Level</th><th>Effective</th><th>Notice By</th><th>Status</th><th>Reason</th></tr></thead><tbody>${actions.map(action => {
    const status = noticeStatus(action);
    return `<tr><td class="${action.type === 'REQUEST' ? 'action-request' : 'action-release'}">${action.type}</td><td><strong>${action.type === 'REQUEST' ? '+' : '-'}${action.qty}</strong></td><td>${action.from} → <strong>${action.to}</strong></td><td class="nowrap">${fmtDate(action.effective)}</td><td class="nowrap">${fmtDate(action.noticeBy)}</td><td><span class="badge ${status.cls}">${status.label}</span></td><td>${esc(action.reason)}</td></tr>`;
  }).join('')}</tbody>`;
}

function renderStorageStatus() {
  const connected = Boolean(storageHealth?.ok);
  const detail = storageHealth?.detail || 'Unable to check Firebase status';
  $('dbStatus').className = `status-chip ${connected ? 'status-good' : 'status-warn'}`;
  $('dbStatus').textContent = connected ? 'Firebase Secure' : 'Firebase Issue';
  $('dbStatus').title = detail;
  $('databasePanel').innerHTML = `<div class="database-line"><span>Storage</span><strong>Cloud Firestore</strong></div><div class="database-line"><span>Authentication</span><strong>Firebase Email / Password</strong></div><div class="database-line"><span>Status</span><strong style="color:var(--${connected ? 'success' : 'warning'})">${connected ? 'Connected & protected' : 'Configuration issue'}</strong></div><div class="database-detail">${esc(detail)}</div>`;
}

function renderSettings() {
  const settings = state.settings;
  $('companyWorkers').value = settings.companyWorkers;
  $('currentAgency').value = settings.currentAgency;
  $('requestNoticeDays').value = settings.requestNoticeDays;
  $('releaseNoticeDays').value = settings.releaseNoticeDays;
  $('floatingLimit').value = settings.floatingLimit;
  $('minReleaseDuration').value = settings.minReleaseDuration;
}

function renderMachines() {
  $('machinesTable').innerHTML = `<thead><tr><th>ID</th><th>Name</th><th>Department</th><th>Default Product</th><th>Actions</th></tr></thead><tbody>${state.machines.map(machine => `<tr><td><strong>${esc(machine.id)}</strong></td><td>${esc(machine.name)}</td><td>${esc(machine.department)}</td><td>${esc(machine.defaultProduct)}</td><td><button class="btn small secondary" onclick="openMachineDialog('${esc(machine.id)}')">Edit</button> <button class="btn small danger" onclick="deleteMachine('${esc(machine.id)}')">Delete</button></td></tr>`).join('')}</tbody>`;
}

function publishedHtml(published) {
  const { daily, actions } = buildActions(published);
  const peak = Math.max(...daily.map(row => row.agencyNeed), 0);
  const start = published.planStartDate;
  const end = addDays(start, PLAN_DAYS - 1);
  return `<div class="readonly-banner">Published plan · Read only · ${fmtDateTime(published.publishedAt)}</div><div class="section-head"><div><h2>Published Manpower Plan</h2><p>${fmtDate(start)} → ${fmtDate(end)} · ${PLAN_DAYS} days</p></div></div><div class="kpi-grid"><div class="kpi"><div class="label">Company Workers</div><div class="value">${published.settings.companyWorkers}</div><div class="sub">Fixed daily capacity</div></div><div class="kpi"><div class="label">Agency at Publish</div><div class="value">${published.settings.currentAgency}</div><div class="sub">Starting level</div></div><div class="kpi"><div class="label">Peak Agency Need</div><div class="value">${peak}</div><div class="sub">14-day forecast</div></div><div class="kpi"><div class="label">Actions</div><div class="value">${actions.length}</div><div class="sub">Request / release</div></div><div class="kpi"><div class="label">Floating Limit</div><div class="value">${published.settings.floatingLimit}</div><div class="sub">Crusher buffer</div></div></div><div class="card"><div class="card-head"><div><h3>Agency Action Plan</h3><p>Official published recommendation.</p></div></div><div class="table-wrap"><table><thead><tr><th>Action</th><th>Qty</th><th>Agency Level</th><th>Effective</th><th>Notice By</th><th>Reason</th></tr></thead><tbody>${actions.length ? actions.map(action => `<tr><td class="${action.type === 'REQUEST' ? 'action-request' : 'action-release'}">${action.type}</td><td><strong>${action.type === 'REQUEST' ? '+' : '-'}${action.qty}</strong></td><td>${action.from} → <strong>${action.to}</strong></td><td>${fmtDate(action.effective)}</td><td>${fmtDate(action.noticeBy)}</td><td>${esc(action.reason)}</td></tr>`).join('') : '<tr><td colspan="6"><span class="badge good">KEEP CURRENT WORKFORCE</span> No agency change is required.</td></tr>'}</tbody></table></div></div><div class="card"><div class="card-head"><div><h3>Daily Forecast</h3><p>Production requirement, Agency level, and Crusher allocation.</p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Production Need</th><th>Company</th><th>Agency Need</th><th>Projected Agency</th><th>Crusher Need</th><th>Crusher Assigned</th></tr></thead><tbody>${daily.map(row => `<tr><td>${fmtDate(row.date, true)}</td><td><strong>${row.productionNeed}</strong></td><td>${row.companyAvailable}</td><td>${row.agencyNeed}</td><td>${row.projectedAgency}</td><td>${row.crusherNeed}</td><td>${row.crusherAssigned}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function renderPublished() {
  const container = $('publishedContainer');
  if (!state?.published) {
    container.innerHTML = '<div class="card"><div class="empty"><strong>No published plan is available yet.</strong><br>Production must publish a plan before HR can view it.</div></div>';
    return;
  }
  container.innerHTML = publishedHtml(state.published);
}

function renderHistory() {
  const history = state.history || [];
  $('historyTable').innerHTML = `<thead><tr><th>Published</th><th>Period</th><th>Company</th><th>Agency</th><th>Peak Need</th><th>Actions</th></tr></thead><tbody>${history.length ? history.map(item => {
    const calculation = buildActions(item);
    const peak = Math.max(...calculation.daily.map(row => row.agencyNeed), 0);
    return `<tr><td>${fmtDateTime(item.publishedAt)}</td><td>${fmtDate(item.planStartDate, true)} → ${fmtDate(addDays(item.planStartDate, 13), true)}</td><td>${item.settings.companyWorkers}</td><td>${item.settings.currentAgency}</td><td>${peak}</td><td>${calculation.actions.length}</td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty">No published plans yet.</td></tr>'}</tbody>`;
}

function openPeriodDialog(machineId, index = '') {
  if (!isPlanner()) return;
  if (index === '' && plannedDays(machineId) >= PLAN_DAYS) return toast('This machine plan is already complete.', 'error');
  const machine = state.machines.find(item => item.id === machineId);
  const period = index === '' ? null : getMachinePlan(machineId)[Number(index)];
  $('periodMachineId').value = machineId;
  $('periodIndex').value = index;
  $('periodDialogTitle').textContent = period ? 'Edit Period' : `Add Period · ${machine.name}`;
  $('periodKind').value = period?.kind || 'run';
  $('periodProduct').value = period?.product || machine.defaultProduct || '';
  $('periodDays').value = period?.days || Math.max(1, Math.min(14, PLAN_DAYS - plannedDays(machineId)));
  $('periodWorkers').value = period?.workers ?? 3;
  updatePeriodDialog();
  $('periodDialog').showModal();
}
window.openPeriodDialog = openPeriodDialog;

function updatePeriodDialog() {
  const stopped = $('periodKind').value === 'stopped';
  $('productLabel').style.display = stopped ? 'none' : 'flex';
  $('workersLabel').style.display = stopped ? 'none' : 'flex';
  const id = $('periodMachineId').value;
  const index = $('periodIndex').value;
  const current = plannedDays(id);
  const old = index === '' ? 0 : Number(getMachinePlan(id)[Number(index)]?.days || 0);
  $('periodHelp').textContent = `Available days for this period: ${PLAN_DAYS - current + old}`;
}

function savePeriod() {
  if (!isPlanner()) return;
  const id = $('periodMachineId').value;
  const index = $('periodIndex').value;
  const kind = $('periodKind').value;
  const days = Number($('periodDays').value);
  const workers = Number($('periodWorkers').value);
  const current = plannedDays(id);
  const old = index === '' ? 0 : Number(getMachinePlan(id)[Number(index)]?.days || 0);
  const maximum = PLAN_DAYS - current + old;
  if (!Number.isInteger(days) || days < 1 || days > maximum) return toast(`Duration must be a whole number from 1 to ${maximum}.`, 'error');
  if (kind === 'run' && (!Number.isInteger(workers) || workers < 0 || workers > 99)) return toast('Workers/day must be a whole number from 0 to 99.', 'error');
  const machine = state.machines.find(item => item.id === id);
  const product = $('periodProduct').value.trim();
  if (kind === 'run' && !product) return toast('Product is required for a production run.', 'error');
  const period = { kind, product: kind === 'stopped' ? 'Stopped' : product || machine.defaultProduct || 'Production', days, workers: kind === 'stopped' ? 0 : workers };
  state.plans[id] = state.plans[id] || [];
  if (index === '') state.plans[id].push(period); else state.plans[id][Number(index)] = period;
  $('periodDialog').close();
  markDirty();
  renderAll();
}

function deleteSegment(id, index) { if (isPlanner()) { state.plans[id].splice(index, 1); markDirty(); renderAll(); } }
function clearMachinePlan(id) { if (isPlanner() && confirm('Clear the full 14-day draft plan for this machine?')) { state.plans[id] = []; markDirty(); renderAll(); } }
function fillStopped(id) { if (!isPlanner()) return; const remaining = PLAN_DAYS - plannedDays(id); if (remaining > 0) { state.plans[id].push({ kind: 'stopped', product: 'Stopped', days: remaining, workers: 0 }); markDirty(); renderAll(); } }
function moveSegment(id, index, direction) { if (!isPlanner()) return; const periods = state.plans[id]; const destination = index + direction; if (destination < 0 || destination >= periods.length) return; [periods[index], periods[destination]] = [periods[destination], periods[index]]; markDirty(); renderAll(); }
Object.assign(window, { deleteSegment, clearMachinePlan, fillStopped, moveSegment });

function openMachineDialog(id = '') {
  if (!isPlanner()) return;
  const machine = id ? state.machines.find(item => item.id === id) : null;
  $('machineOriginalId').value = id;
  $('machineDialogTitle').textContent = machine ? 'Edit Machine' : 'Add Machine';
  $('machineId').value = machine?.id || '';
  $('machineName').value = machine?.name || '';
  $('machineDepartment').value = machine?.department || '';
  $('machineDefaultProduct').value = machine?.defaultProduct || '';
  $('machineDialog').showModal();
}
window.openMachineDialog = openMachineDialog;

function saveMachine() {
  if (!isPlanner()) return;
  const original = $('machineOriginalId').value.trim();
  const id = $('machineId').value.trim();
  const name = $('machineName').value.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(id) || !name) return toast('Machine ID may contain letters, numbers, dot, dash or underscore; name is required.', 'error');
  if (state.machines.some(machine => machine.id === id && machine.id !== original)) return toast('Machine ID already exists.', 'error');
  const data = { id, name, department: $('machineDepartment').value.trim(), defaultProduct: $('machineDefaultProduct').value.trim() };
  if (original) {
    const index = state.machines.findIndex(machine => machine.id === original);
    data.sortOrder = state.machines[index].sortOrder;
    state.machines[index] = data;
    if (original !== id) { state.plans[id] = state.plans[original] || []; delete state.plans[original]; }
  } else {
    data.sortOrder = state.machines.length + 1;
    state.machines.push(data);
    state.plans[id] = [];
  }
  $('machineDialog').close();
  markDirty();
  renderAll();
}

function deleteMachine(id) {
  if (!isPlanner() || !confirm(`Delete machine ${id} and its draft plan? Published plans and history will not be changed.`)) return;
  state.machines = state.machines.filter(machine => machine.id !== id);
  delete state.plans[id];
  markDirty();
  renderAll();
}
window.deleteMachine = deleteMachine;

async function handleExcelFile(file) {
  if (!isPlanner()) return toast('You do not have permission to import Excel plans.', 'error');
  if (!file || !/\.xlsx$/i.test(file.name)) return toast('Select an .xlsx file.', 'error');
  if (file.size > 5 * 1024 * 1024) return toast('Excel file must not exceed 5 MB.', 'error');
  $('importFileName').textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
  $('importStatus').className = 'import-status loading';
  $('importStatus').innerHTML = '<span class="mini-spinner"></span>Reading and validating every row…';
  $('importSummary').innerHTML = '';
  $('importErrors').hidden = true;
  $('importPreview').hidden = true;
  $('importModePanel').hidden = true;
  $('applyImportBtn').disabled = true;
  $('importDialog').showModal();
  await new Promise(resolve => setTimeout(resolve, 30));
  try {
    const workbook = new window.ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    pendingImport = window.PWPExcel.validateWorkbook(workbook, state.machines);
    renderImportResult(pendingImport);
  } catch (error) {
    pendingImport = null;
    $('importStatus').className = 'import-status failed';
    $('importStatus').textContent = 'The file could not be opened as a valid Excel workbook.';
    $('importErrors').hidden = false;
    $('importErrors').innerHTML = `<div><strong>File error</strong><span>${esc(error.message)}</span></div>`;
  }
}

function renderImportResult(result) {
  if (!result.valid) {
    $('importStatus').className = 'import-status failed';
    $('importStatus').textContent = `${result.errors.length} validation error${result.errors.length === 1 ? '' : 's'} found. Nothing has been applied.`;
    $('importErrors').hidden = false;
    $('importErrors').innerHTML = result.errors.map(error => `<div><strong>${error.row ? `Row ${error.row}` : 'Workbook'}</strong><span>${esc(error.reason)}</span></div>`).join('');
    return;
  }
  const summary = result.summary;
  $('importStatus').className = 'import-status success';
  $('importStatus').textContent = 'Validation passed. Review the preview and choose how to update the draft.';
  $('importSummary').innerHTML = [
    ['Machines', summary.machines], ['Plan Rows', summary.rows], ['RUN Periods', summary.runPeriods], ['STOPPED Periods', summary.stoppedPeriods], ['Total Planned Days', summary.runDays + summary.stoppedDays]
  ].map(([label, value]) => `<div><span>${esc(label)}</span><strong>${value}</strong></div>`).join('');
  $('importPreviewTable').innerHTML = `<thead><tr><th>Machine ID</th><th>Sequence</th><th>Status</th><th>Product</th><th>Duration</th><th>Workers/Day</th></tr></thead><tbody>${result.records.map(record => `<tr><td><strong>${esc(record.machineId)}</strong></td><td>${record.sequence}</td><td><span class="badge ${record.status === 'RUN' ? 'good' : 'info'}">${record.status}</span></td><td>${esc(record.product || '—')}</td><td>${record.duration}</td><td>${record.workers}</td></tr>`).join('')}</tbody>`;
  $('importPreview').hidden = false;
  $('importModePanel').hidden = false;
  $('applyImportBtn').disabled = false;
}

function applyExcelImport() {
  if (!isPlanner() || !pendingImport?.valid) return toast('A valid import preview is required.', 'error');
  const mode = document.querySelector('input[name="importMode"]:checked')?.value;
  if (mode === 'replace' && !confirm('Replace the entire current draft plan? Published Plan, History, machines, settings and users will remain unchanged.')) return;
  window.PWPExcel.applyImportToDraft(state, pendingImport, mode);
  $('importDialog').close();
  $('excelFileInput').value = '';
  pendingImport = null;
  markDirty();
  renderAll();
  switchTab('plan');
  toast('Excel plan applied to the draft. Press Save Draft when ready.', 'success');
}

async function loadUsers() {
  if (!isAdmin()) return;
  $('usersTable').innerHTML = '<tbody><tr><td class="empty">Loading users…</td></tr></tbody>';
  try {
    adminUsers = await fetchJson('/api/admin/users');
    renderUsers();
  } catch (error) {
    $('usersTable').innerHTML = `<tbody><tr><td class="empty">${esc(error.message)}</td></tr></tbody>`;
  }
}

function renderUsers() {
  $('usersTable').innerHTML = `<thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Last Sign-In</th><th>Actions</th></tr></thead><tbody>${adminUsers.map(user => {
    const self = user.uid === currentProfile.uid;
    const role = user.role || '';
    const statusClass = user.disabled ? 'bad' : role ? 'good' : 'warn';
    const statusLabel = user.disabled ? 'Disabled' : role ? 'Active' : 'Pending Approval';
    return `<tr><td><strong>${esc(user.displayName || '—')}</strong>${self ? '<span class="self-tag">You</span>' : ''}</td><td>${esc(user.email)}</td><td><select id="user-role-${esc(user.uid)}" class="table-select" ${self ? 'disabled' : ''}><option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option><option value="production_manager" ${role === 'production_manager' ? 'selected' : ''}>Production Manager</option><option value="hr" ${role === 'hr' ? 'selected' : ''}>HR</option><option value="" ${role ? '' : 'selected'} disabled>No role</option></select></td><td><span class="badge ${statusClass}">${statusLabel}</span></td><td>${fmtDateTime(user.lastSignInAt)}</td><td><button class="btn small secondary" onclick="saveUserRole('${esc(user.uid)}')" ${self ? 'disabled' : ''}>Save Role</button> <button class="btn small ${user.disabled ? 'secondary' : 'danger'}" onclick="toggleUserDisabled('${esc(user.uid)}',${!user.disabled})" ${self ? 'disabled' : ''}>${user.disabled ? 'Enable' : 'Disable'}</button></td></tr>`;
  }).join('')}</tbody>`;
}

async function createUser() {
  if (!isAdmin()) return;
  const button = $('createUserBtn');
  $('userFormError').hidden = true;
  setButtonLoading(button, true, 'Creating…');
  try {
    await fetchJson('/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        displayName: $('newUserName').value.trim(), email: $('newUserEmail').value.trim(), password: $('newUserPassword').value, role: $('newUserRole').value
      })
    });
    $('userDialog').close();
    $('userForm').reset();
    toast('User created and role assigned.', 'success');
    await loadUsers();
  } catch (error) {
    $('userFormError').hidden = false;
    $('userFormError').textContent = error.message;
  } finally {
    setButtonLoading(button, false);
  }
}

async function saveUserRole(uid) {
  if (!isAdmin()) return;
  const role = $(`user-role-${uid}`).value;
  try {
    await fetchJson(`/api/admin/users/${encodeURIComponent(uid)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
    toast('Role updated. The user must sign in again.', 'success');
    await loadUsers();
  } catch (error) { toast(error.message, 'error'); }
}

async function toggleUserDisabled(uid, disabled) {
  if (!isAdmin()) return;
  if (disabled && !confirm('Disable this user account and revoke its active sessions?')) return;
  try {
    await fetchJson(`/api/admin/users/${encodeURIComponent(uid)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled }) });
    toast(disabled ? 'User disabled.' : 'User enabled.', 'success');
    await loadUsers();
  } catch (error) { toast(error.message, 'error'); }
}
Object.assign(window, { saveUserRole, toggleUserDisabled });

applyTheme(getPreferredTheme());

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
  $('themeToggle').addEventListener('click', toggleTheme);
  $('loginThemeToggle').addEventListener('click', toggleTheme);
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    authNotice = '';
    $('loginError').hidden = true;
    $('loginNotice').hidden = true;
    setButtonLoading($('loginBtn'), true, 'Signing in…');
    try {
      await auth.signInWithEmailAndPassword($('loginEmail').value.trim(), $('loginPassword').value);
    } catch (error) {
      $('loginError').hidden = false;
      $('loginError').textContent = mapLoginError(error);
    } finally {
      setButtonLoading($('loginBtn'), false);
    }
  });
  $('googleSignInBtn').addEventListener('click', signInWithGoogle);
  $('openCreateAccountBtn').addEventListener('click', openCreateAccount);
  $('createAccountForm').addEventListener('submit', registerAccount);
  $('closeCreateAccountBtn').addEventListener('click', () => $('createAccountDialog').close());
  $('cancelCreateAccountBtn').addEventListener('click', () => $('createAccountDialog').close());
  $('forgotPasswordBtn').addEventListener('click', openForgotPassword);
  $('forgotPasswordForm').addEventListener('submit', sendPasswordReset);
  $('closeForgotPasswordBtn').addEventListener('click', () => $('forgotPasswordDialog').close());
  $('cancelForgotPasswordBtn').addEventListener('click', () => $('forgotPasswordDialog').close());
  $('logoutBtn').addEventListener('click', async () => { if (dirty && !confirm('You have unsaved draft changes. Sign out and discard them?')) return; await auth.signOut(); });
  $('saveDraftBtn').addEventListener('click', () => saveDraft().catch(() => {}));
  $('publishBtn').addEventListener('click', publishPlan);
  $('openPublishedBtn').addEventListener('click', () => window.open(`${location.origin}${location.pathname}?view=published`, '_blank', 'noopener'));
  $('planStartDate').addEventListener('change', event => { if (isPlanner()) { state.planStartDate = event.target.value; markDirty(); renderAll(); } });
  $('periodKind').addEventListener('change', updatePeriodDialog);
  $('periodSaveBtn').addEventListener('click', savePeriod);
  $('machineSaveBtn').addEventListener('click', saveMachine);
  $('addMachineBtn').addEventListener('click', () => openMachineDialog());
  $('fillAllStoppedBtn').addEventListener('click', () => {
    if (!isPlanner()) return;
    state.machines.forEach(machine => { const remaining = PLAN_DAYS - plannedDays(machine.id); if (remaining > 0) state.plans[machine.id].push({ kind: 'stopped', product: 'Stopped', days: remaining, workers: 0 }); });
    markDirty(); renderAll();
  });
  $('settingsForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!isPlanner()) return;
    state.settings.companyWorkers = Number($('companyWorkers').value || 0);
    state.settings.currentAgency = Number($('currentAgency').value || 0);
    state.settings.requestNoticeDays = Number($('requestNoticeDays').value || 0);
    state.settings.releaseNoticeDays = Number($('releaseNoticeDays').value || 0);
    state.settings.floatingLimit = Number($('floatingLimit').value || 0);
    state.settings.minReleaseDuration = Number($('minReleaseDuration').value || 1);
    markDirty(); renderAll();
    await saveDraft().catch(() => {});
  });
  $('importExcelBtn').addEventListener('click', () => { if (isPlanner()) $('excelFileInput').click(); });
  $('redistributeBtn').addEventListener('click', redistributeWorkforce);
  $('excelFileInput').addEventListener('change', event => handleExcelFile(event.target.files?.[0]));
  $('applyImportBtn').addEventListener('click', applyExcelImport);
  $('addUserBtn').addEventListener('click', () => { $('userFormError').hidden = true; $('userDialog').showModal(); });
  $('createUserBtn').addEventListener('click', createUser);
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  initializeAuthentication().catch(error => { console.error(error); showLogin(error.message); });
});
