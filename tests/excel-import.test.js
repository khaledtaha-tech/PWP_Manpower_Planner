const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const path = require('node:path');
const { validateWorkbook, applyImportToDraft, HEADERS } = require('../public/excel-import');

const machines = [
  { id: 'L-01', name: 'Line 1' },
  { id: 'L-02', name: 'Line 2' },
  { id: 'L-03', name: 'Line 3' }
];

function workbook(rows, sheetName = 'Plan') {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(sheetName);
  rows.forEach(row => sheet.addRow(row));
  return book;
}

test('valid workbook supports multiple sequential RUN/STOPPED periods', () => {
  const result = validateWorkbook(workbook([
    HEADERS,
    ['L-01', 1, 'RUN', 'HDPE 200 mm', 5, 3],
    ['L-01', 2, 'STOPPED', '', 2, 0],
    ['L-01', 3, 'RUN', 'HDPE 110 mm', 7, 2],
    ['L-02', 1, 'RUN', 'PPR Pipe', 14, 3]
  ]), machines);
  assert.equal(result.valid, true);
  assert.equal(result.summary.machines, 2);
  assert.equal(result.summary.runPeriods, 3);
  assert.equal(result.summary.stoppedPeriods, 1);
  assert.equal(result.summary.machineSummaries.find(item => item.machineId === 'L-01').totalDays, 14);
});

test('downloadable project template contains the required sheets and imports successfully', async () => {
  const templatePath = path.join(__dirname, '..', 'public', 'assets', 'PWP_14_Day_Plan_Upload_Template.xlsx');
  const template = new ExcelJS.Workbook();
  await template.xlsx.readFile(templatePath);
  assert.deepEqual(template.worksheets.map(sheet => sheet.name), ['Plan', 'Instructions', 'Lists']);
  const result = validateWorkbook(template, [
    { id: 'L-01', name: 'Kabra 90' }, { id: 'L-02', name: 'Beier 2' }, ...machines.slice(2)
  ]);
  assert.equal(result.valid, true);
  assert.equal(result.summary.rows, 5);
  assert.deepEqual(result.summary.newMachines.map(machine => machine.id), ['L-13']);
  assert.equal(result.summary.newMachines[0].name, 'Crusher');
});

test('validator returns all row-specific errors without applying anything', () => {
  const result = validateWorkbook(workbook([
    HEADERS,
    ['BAD ID', 2, 'RUN', '', 15, -1],
    ['L-01', 1, 'STOPPED', '', 5, 2],
    ['L-01', 1, 'RUN', 'Pipe', 10, 3],
    [],
    ['L-01', 3, 'BAD', 'Pipe', 5.5, 1.5]
  ]), machines);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 9);
  assert.ok(result.errors.some(error => error.row === 2 && error.reason.includes('Machine ID may contain')));
  assert.ok(result.errors.some(error => error.row === 3 && error.reason.includes('must be 0')));
  assert.ok(result.errors.some(error => error.row === 4 && error.reason.includes('duplicated')));
  assert.ok(result.errors.some(error => error.row === 5 && error.reason.includes('Blank rows')));
  assert.ok(result.errors.some(error => error.row === 6 && error.reason.includes('RUN or STOPPED')));
});

test('unknown valid machine IDs are previewed and created automatically from Lists metadata', () => {
  const book = workbook([
    HEADERS,
    ['L-13', 1, 'RUN', 'Crushing / Support', 14, 2]
  ]);
  const lists = book.addWorksheet('Lists');
  lists.addRow(['Status', '', 'Machine ID', 'Machine Name', 'Department']);
  lists.addRow(['RUN', '', 'L-13', 'Crusher', 'Crusher']);
  const result = validateWorkbook(book, [{ id: 'M1', name: 'Legacy placeholder', sortOrder: 1 }]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.summary.newMachines, [{
    id: 'L-13', name: 'Crusher', department: 'Crusher', defaultProduct: 'Crushing / Support'
  }]);
  const state = {
    machines: [{ id: 'M1', name: 'Legacy placeholder', sortOrder: 1 }],
    plans: { M1: [] },
    settings: { companyWorkers: 20 },
    history: [{ id: 'KEEP' }]
  };
  applyImportToDraft(state, result, 'update');
  assert.equal(state.machines.find(machine => machine.id === 'L-13').name, 'Crusher');
  assert.equal(state.machines.find(machine => machine.id === 'L-13').sortOrder, 2);
  assert.equal(state.plans['L-13'][0].workers, 2);
  assert.deepEqual(state.history, [{ id: 'KEEP' }]);
});

test('missing Plan sheet and wrong headers are rejected', () => {
  const missing = validateWorkbook(workbook([HEADERS], 'Other'), machines);
  assert.equal(missing.valid, false);
  assert.ok(missing.errors[0].reason.includes('Plan'));
  const wrong = validateWorkbook(workbook([['Machine', ...HEADERS.slice(1)], ['L-01', 1, 'RUN', 'Pipe', 14, 3]]), machines);
  assert.equal(wrong.valid, false);
  assert.ok(wrong.errors.some(error => error.row === 1));
});

function draftState() {
  return {
    planStartDate: '2026-08-12',
    settings: { companyWorkers: 20 },
    machines: structuredClone(machines),
    plans: {
      'L-01': [{ kind: 'run', product: 'Old 1', days: 14, workers: 3 }],
      'L-02': [{ kind: 'run', product: 'Old 2', days: 14, workers: 3 }],
      'L-03': [{ kind: 'run', product: 'Old 3', days: 14, workers: 3 }]
    },
    published: { id: 'DO-NOT-CHANGE' },
    history: [{ id: 'HISTORY-DO-NOT-CHANGE' }],
    users: [{ id: 'USER-DO-NOT-CHANGE' }]
  };
}

function validImport() {
  return validateWorkbook(workbook([
    HEADERS,
    ['L-01', 1, 'RUN', 'New Product', 10, 4],
    ['L-01', 2, 'STOPPED', '', 4, 0]
  ]), machines);
}

test('Update Listed Machines Only changes only imported draft plans', () => {
  const state = draftState();
  const protectedBefore = { settings: structuredClone(state.settings), machines: structuredClone(state.machines), published: structuredClone(state.published), history: structuredClone(state.history), users: structuredClone(state.users) };
  applyImportToDraft(state, validImport(), 'update');
  assert.equal(state.plans['L-01'][0].product, 'New Product');
  assert.equal(state.plans['L-02'][0].product, 'Old 2');
  assert.equal(state.plans['L-03'][0].product, 'Old 3');
  assert.deepEqual({ settings: state.settings, machines: state.machines, published: state.published, history: state.history, users: state.users }, protectedBefore);
});

test('Replace Entire Draft Plan clears only draft periods and preserves all protected data', () => {
  const state = draftState();
  const protectedBefore = { settings: structuredClone(state.settings), machines: structuredClone(state.machines), published: structuredClone(state.published), history: structuredClone(state.history), users: structuredClone(state.users) };
  applyImportToDraft(state, validImport(), 'replace');
  assert.equal(state.plans['L-01'].length, 2);
  assert.deepEqual(state.plans['L-02'], []);
  assert.deepEqual(state.plans['L-03'], []);
  assert.deepEqual({ settings: state.settings, machines: state.machines, published: state.published, history: state.history, users: state.users }, protectedBefore);
});
