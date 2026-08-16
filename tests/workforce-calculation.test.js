const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadEngine() {
  const elements = new Map();
  const context = {
    console,
    URLSearchParams,
    Headers,
    setTimeout,
    clearTimeout,
    location: { search: '', origin: 'http://localhost', pathname: '/' },
    localStorage: { getItem: () => 'light', setItem: () => {} },
    confirm: () => true,
    fetch: async () => { throw new Error('fetch not expected'); },
    document: {
      documentElement: { dataset: {} },
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { classList: { add() {}, remove() {}, toggle() {} } });
        return elements.get(id);
      },
      addEventListener() {},
      querySelectorAll: () => []
    }
  };
  context.window = context;
  context.window.matchMedia = () => ({ matches: false });
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../public/app.js'), 'utf8'), context);
  return context.PWPWorkforce;
}

function source({ productionWorkers, crusherWorkers, companyWorkers = 20, currentAgency = 18, crusherMode = 'floating' }) {
  return {
    planStartDate: '2026-08-12',
    settings: { companyWorkers, currentAgency, crusherMode, crusherWorkers, floatingLimit: crusherWorkers, minReleaseDuration: 3, requestNoticeDays: 0, releaseNoticeDays: 0 },
    machines: [
      { id: 'L-01', name: 'Production Line', department: 'HDPE' },
      { id: 'L-13', name: 'Crusher', department: 'Crusher' }
    ],
    plans: {
      'L-01': [{ kind: 'run', product: 'Pipe', days: 14, workers: productionWorkers }],
      'L-13': [{ kind: 'run', product: 'Crushing', days: 14, workers: crusherWorkers }]
    }
  };
}

test('Floating Crusher does not retain Agency workers after production', () => {
  const { buildActions } = loadEngine();
  const result = buildActions(source({ productionWorkers: 29, crusherWorkers: 2 }));
  assert.equal(result.daily[0].productionNeed, 29);
  assert.equal(result.daily[0].agencyNeed, 9);
  assert.equal(result.daily[0].crusherNeed, 2);
  assert.equal(result.daily[0].crusherAssigned, 0);
  assert.equal(result.daily[0].crusherShortage, 2);
  assert.deepEqual(Array.from(result.actions, action => [action.type, action.qty, action.to]), [['RELEASE', 9, 9]]);
});

test('Crusher shortage never creates an Agency request', () => {
  const { buildActions } = loadEngine();
  const result = buildActions(source({ productionWorkers: 29, crusherWorkers: 2, currentAgency: 9 }));
  assert.equal(result.daily[0].agencyNeed, 9);
  assert.equal(result.daily[0].crusherAssigned, 0);
  assert.equal(result.daily[0].crusherShortage, 2);
  assert.equal(result.actions.some(action => action.type === 'REQUEST'), false);
});

test('Company surplus is assigned to Crusher before Agency surplus', () => {
  const { buildActions } = loadEngine();
  const result = buildActions(source({ productionWorkers: 18, crusherWorkers: 2, currentAgency: 0 }));
  assert.equal(result.daily[0].companySurplus, 2);
  assert.equal(result.daily[0].crusherAssigned, 2);
  assert.equal(result.daily[0].crusherFromAgency, 0);
  assert.equal(result.actions.length, 0);
});

test('Mandatory Crusher reserves workers and can increase Agency requirement', () => {
  const { buildActions } = loadEngine();
  const result = buildActions(source({ productionWorkers: 29, crusherWorkers: 2, currentAgency: 9, crusherMode: 'mandatory' }));
  assert.equal(result.daily[0].agencyNeed, 9);
  assert.equal(result.daily[0].requiredAgency, 11);
  assert.equal(result.daily[0].crusherAssigned, 2);
  assert.deepEqual(Array.from(result.actions, action => [action.type, action.qty, action.to]), [['REQUEST', 2, 11]]);
});

function phasedSource(crusherMode) {
  return {
    planStartDate: '2026-08-12',
    settings: { companyWorkers: 20, currentAgency: 14, crusherMode, crusherWorkers: 2, floatingLimit: 2, minReleaseDuration: 3, requestNoticeDays: 3, releaseNoticeDays: 3 },
    machines: [{ id: 'L-01', name: 'Production Line', department: 'HDPE' }],
    plans: { 'L-01': [
      { kind: 'run', product: 'Phase 1', days: 3, workers: 31 },
      { kind: 'run', product: 'Phase 2', days: 3, workers: 29 },
      { kind: 'run', product: 'Phase 3', days: 3, workers: 26 },
      { kind: 'run', product: 'Phase 4', days: 5, workers: 30 }
    ] }
  };
}

test('Three-day notice produces two releases and one request in Mandatory mode', () => {
  const { buildActions } = loadEngine();
  const result = buildActions(phasedSource('mandatory'));
  assert.deepEqual(Array.from(result.actions, action => [action.type, action.qty, action.to, action.dayIndex]), [
    ['RELEASE', 3, 11, 3], ['RELEASE', 3, 8, 6], ['REQUEST', 4, 12, 9]
  ]);
});

test('Three-day notice produces two releases and one request in Floating mode', () => {
  const { buildActions } = loadEngine();
  const result = buildActions(phasedSource('floating'));
  assert.deepEqual(Array.from(result.actions, action => [action.type, action.qty, action.to, action.dayIndex]), [
    ['RELEASE', 5, 9, 3], ['RELEASE', 3, 6, 6], ['REQUEST', 4, 10, 9]
  ]);
  assert.deepEqual(Array.from(result.daily.slice(0, 4), row => row.crusherAssigned), [2, 2, 2, 0]);
});
