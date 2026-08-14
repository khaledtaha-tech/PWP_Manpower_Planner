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

function source({ productionWorkers, crusherWorkers, companyWorkers = 20, currentAgency = 18 }) {
  return {
    planStartDate: '2026-08-12',
    settings: { companyWorkers, currentAgency, floatingLimit: 2, minReleaseDuration: 3, requestNoticeDays: 0, releaseNoticeDays: 0 },
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

test('Crusher is excluded from production need and retained surplus is assigned to it', () => {
  const { buildActions } = loadEngine();
  const result = buildActions(source({ productionWorkers: 29, crusherWorkers: 2 }));
  assert.equal(result.daily[0].productionNeed, 29);
  assert.equal(result.daily[0].agencyNeed, 9);
  assert.equal(result.daily[0].crusherNeed, 2);
  assert.equal(result.daily[0].crusherAssigned, 2);
  assert.equal(result.daily[0].crusherShortage, 0);
  assert.deepEqual(Array.from(result.actions, action => [action.type, action.qty, action.to]), [['RELEASE', 7, 11]]);
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
