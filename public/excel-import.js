(function attachExcelImport(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PWPExcel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createExcelImport() {
  const HEADERS = ['Line ID', 'Machine Name', 'Sequence', 'Status', 'Product', 'Duration', 'Workers/Day'];
  const LEGACY_HEADERS = ['Machine ID', 'Sequence', 'Status', 'Product', 'Duration', 'Workers/Day'];

  function blank(value) {
    return value == null || String(value).trim() === '';
  }

  function integer(value) {
    if (typeof value === 'number') return Number.isInteger(value) ? value : null;
    const text = String(value == null ? '' : value).trim();
    if (!/^\d+$/.test(text)) return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  function simpleCellValue(value) {
    if (value == null) return '';
    if (value instanceof Date) return value;
    if (typeof value !== 'object') return value;
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return value.result;
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
    return String(value);
  }

  function worksheetRows(worksheet) {
    const rows = [];
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const columnCount = Math.max(HEADERS.length, row.cellCount || 0);
      const values = [];
      for (let column = 1; column <= columnCount; column += 1) values.push(simpleCellValue(row.getCell(column).value));
      rows.push(values);
    }
    return rows;
  }

  function machineMetadata(workbook) {
    const sheet = workbook.getWorksheet('Lists');
    if (!sheet) return new Map();
    const rows = worksheetRows(sheet);
    const header = rows[0] || [];
    const idColumn = header.findIndex(value => String(value || '').trim() === 'Machine ID');
    const nameColumn = header.findIndex(value => String(value || '').trim() === 'Machine Name');
    const departmentColumn = header.findIndex(value => String(value || '').trim() === 'Department');
    if (idColumn < 0) return new Map();

    const metadata = new Map();
    rows.slice(1).forEach(row => {
      const id = String(row[idColumn] || '').trim();
      if (!id || !/^[A-Za-z0-9._-]+$/.test(id) || id.length > 30 || metadata.has(id)) return;
      metadata.set(id, {
        id,
        name: String(row[nameColumn] || '').trim().slice(0, 100),
        department: String(row[departmentColumn] || '').trim().slice(0, 80)
      });
    });
    return metadata;
  }

  function isCrusher(machineId, machineName, machineMap, metadata) {
    const machine = machineMap.get(machineId) || metadata.get(machineId) || {};
    const identity = `${machineId} ${machineName || ''} ${machine.name || ''} ${machine.department || ''}`.toLowerCase();
    return identity.includes('crusher');
  }

  function headerMatches(header, expected) {
    return expected.every((value, index) => String(header[index] == null ? '' : header[index]).trim() === value)
      && !header.slice(expected.length).some(value => !blank(value));
  }

  function validateWorkbook(workbook, machines) {
    const errors = [];
    const machineMap = new Map((machines || []).map(machine => [String(machine.id).trim(), machine]));
    if (!workbook || typeof workbook.getWorksheet !== 'function') {
      return { valid: false, errors: [{ row: 0, reason: 'The Excel reader is unavailable.' }], records: [], summary: null };
    }
    const sheet = workbook.getWorksheet('Plan');
    if (!sheet) {
      return { valid: false, errors: [{ row: 0, reason: 'Sheet "Plan" was not found.' }], records: [], summary: null };
    }
    const metadata = machineMetadata(workbook);
    const rows = worksheetRows(sheet);
    const header = rows[0] || [];
    const legacyFormat = headerMatches(header, LEGACY_HEADERS);
    const currentFormat = headerMatches(header, HEADERS);
    if (!currentFormat && !legacyFormat) {
      HEADERS.forEach((expected, index) => {
        if (String(header[index] == null ? '' : header[index]).trim() !== expected) {
          errors.push({ row: 1, reason: `Column ${index + 1} must be exactly "${expected}".` });
        }
      });
      if (header.slice(HEADERS.length).some(value => !blank(value))) {
        errors.push({ row: 1, reason: 'Plan sheet must contain only the seven required columns.' });
      }
    }
    const schemaLength = legacyFormat ? LEGACY_HEADERS.length : HEADERS.length;

    let lastDataIndex = rows.length - 1;
    while (lastDataIndex >= 1 && (rows[lastDataIndex] || []).every(blank)) lastDataIndex -= 1;
    if (lastDataIndex < 1) errors.push({ row: 2, reason: 'The Plan sheet does not contain any plan rows.' });

    const records = [];
    const signatures = new Map();
    for (let index = 1; index <= lastDataIndex; index += 1) {
      const source = rows[index] || [];
      const rowNumber = index + 1;
      if (source.every(blank)) {
        errors.push({ row: rowNumber, reason: 'Blank rows are not allowed between plan rows.' });
        continue;
      }
      if (source.slice(schemaLength).some(value => !blank(value))) {
        errors.push({ row: rowNumber, reason: 'Unexpected data exists after Workers/Day.' });
      }

      const machineId = String(source[0] == null ? '' : source[0]).trim();
      const knownMachine = machineMap.get(machineId) || metadata.get(machineId) || {};
      const machineName = legacyFormat
        ? String(knownMachine.name || machineId).trim()
        : String(source[1] == null ? '' : source[1]).trim();
      const offset = legacyFormat ? 0 : 1;
      const sequence = integer(source[1 + offset]);
      const status = String(source[2 + offset] == null ? '' : source[2 + offset]).trim().toUpperCase();
      const product = String(source[3 + offset] == null ? '' : source[3 + offset]).trim();
      const duration = integer(source[4 + offset]);
      const workers = integer(source[5 + offset]);

      if (!machineId) errors.push({ row: rowNumber, reason: 'Line ID is required.' });
      else if (!/^[A-Za-z0-9._-]+$/.test(machineId) || machineId.length > 30) errors.push({ row: rowNumber, reason: 'Line ID may contain only letters, numbers, dot, dash or underscore (maximum 30 characters).' });
      else if (isCrusher(machineId, machineName, machineMap, metadata)) errors.push({ row: rowNumber, reason: `Line ID "${machineId}" is the Crusher. Do not add Crusher rows to Plan; use the Mandatory/Floating switch in the application.` });
      if (!legacyFormat && !machineName) errors.push({ row: rowNumber, reason: 'Machine Name is required.' });
      else if (machineName.length > 100) errors.push({ row: rowNumber, reason: 'Machine Name must not exceed 100 characters.' });
      else if (knownMachine.name && machineName && String(knownMachine.name).trim().toLowerCase() !== machineName.toLowerCase()) {
        errors.push({ row: rowNumber, reason: `Machine Name "${machineName}" does not match Line ID "${machineId}" (${knownMachine.name}).` });
      }
      if (sequence == null || sequence < 1) errors.push({ row: rowNumber, reason: 'Sequence must be a positive whole number starting from 1.' });
      if (status !== 'RUN' && status !== 'STOPPED') errors.push({ row: rowNumber, reason: 'Status must be RUN or STOPPED.' });
      if (status === 'RUN' && !product) errors.push({ row: rowNumber, reason: 'Product is required when Status is RUN.' });
      if (duration == null || duration < 1 || duration > 14) errors.push({ row: rowNumber, reason: 'Duration must be a whole number from 1 to 14.' });
      if (workers == null || workers < 0) errors.push({ row: rowNumber, reason: 'Workers/Day must be a non-negative whole number.' });
      if (status === 'STOPPED' && workers !== 0) errors.push({ row: rowNumber, reason: 'Workers/Day must be 0 when Status is STOPPED.' });

      const signature = [machineId, machineName, sequence, status, product, duration, workers].join('\u001f');
      if (signatures.has(signature)) {
        errors.push({ row: rowNumber, reason: `Duplicate of row ${signatures.get(signature)}.` });
      } else {
        signatures.set(signature, rowNumber);
      }

      records.push({ machineId, machineName, sequence, status, product, duration, workers, sourceRow: rowNumber });
    }

    const grouped = new Map();
    records.forEach(record => {
      if (!record.machineId || !/^[A-Za-z0-9._-]+$/.test(record.machineId) || record.machineId.length > 30 || record.sequence == null || record.sequence < 1) return;
      if (!grouped.has(record.machineId)) grouped.set(record.machineId, []);
      grouped.get(record.machineId).push(record);
    });
    for (const [machineId, machineRows] of grouped) {
      const bySequence = new Map();
      machineRows.forEach(record => {
        if (bySequence.has(record.sequence)) {
          errors.push({ row: record.sourceRow, reason: `Sequence ${record.sequence} is duplicated for machine ${machineId} (first used on row ${bySequence.get(record.sequence)}).` });
        } else {
          bySequence.set(record.sequence, record.sourceRow);
        }
      });
      const sequences = [...bySequence.keys()].sort((a, b) => a - b);
      sequences.forEach((sequence, index) => {
        if (sequence !== index + 1) {
          errors.push({ row: bySequence.get(sequence), reason: `Sequences for machine ${machineId} must start at 1 and have no gaps.` });
        }
      });
      const validDurations = machineRows.filter(record => record.duration != null && record.duration >= 1 && record.duration <= 14);
      const totalDuration = validDurations.reduce((sum, record) => sum + record.duration, 0);
      if (totalDuration > 14) {
        errors.push({ row: validDurations[validDurations.length - 1]?.sourceRow || 0, reason: `Total Duration for machine ${machineId} is ${totalDuration} days and exceeds 14.` });
      }
    }

    const uniqueErrors = [];
    const errorKeys = new Set();
    errors.forEach(error => {
      const key = `${error.row}|${error.reason}`;
      if (!errorKeys.has(key)) { errorKeys.add(key); uniqueErrors.push(error); }
    });
    uniqueErrors.sort((a, b) => a.row - b.row || a.reason.localeCompare(b.reason));

    const orderedRecords = records.slice().sort((a, b) => a.machineId.localeCompare(b.machineId) || a.sequence - b.sequence);
    const newMachines = [...grouped.keys()]
      .filter(machineId => !machineMap.has(machineId))
      .sort((a, b) => a.localeCompare(b))
      .map(machineId => {
        const listed = metadata.get(machineId) || {};
        const planName = grouped.get(machineId)?.find(record => record.machineName)?.machineName || '';
        const firstRun = grouped.get(machineId)?.find(record => record.status === 'RUN' && record.product);
        const crusher = /crusher/i.test(`${machineId} ${planName} ${listed.name || ''} ${listed.department || ''}`);
        return {
          id: machineId,
          name: listed.name || planName || (crusher ? 'Crusher' : machineId),
          department: listed.department || (crusher ? 'Crusher' : ''),
          defaultProduct: firstRun?.product || ''
        };
      });
    const allMachineMap = new Map(machineMap);
    newMachines.forEach(machine => allMachineMap.set(machine.id, machine));
    const machineSummaries = [];
    for (const [machineId, machineRows] of grouped) {
      const ordered = machineRows.slice().sort((a, b) => a.sequence - b.sequence);
      machineSummaries.push({
        machineId,
        machineName: allMachineMap.get(machineId)?.name || '',
        periods: ordered.length,
        runDays: ordered.filter(row => row.status === 'RUN').reduce((sum, row) => sum + (row.duration || 0), 0),
        stoppedDays: ordered.filter(row => row.status === 'STOPPED').reduce((sum, row) => sum + (row.duration || 0), 0),
        totalDays: ordered.reduce((sum, row) => sum + (row.duration || 0), 0)
      });
    }
    machineSummaries.sort((a, b) => a.machineId.localeCompare(b.machineId));
    const summary = {
      rows: records.length,
      machines: grouped.size,
      periods: records.length,
      runPeriods: records.filter(row => row.status === 'RUN').length,
      stoppedPeriods: records.filter(row => row.status === 'STOPPED').length,
      runDays: records.filter(row => row.status === 'RUN').reduce((sum, row) => sum + (row.duration || 0), 0),
      stoppedDays: records.filter(row => row.status === 'STOPPED').reduce((sum, row) => sum + (row.duration || 0), 0),
      newMachines,
      machineSummaries
    };

    return { valid: uniqueErrors.length === 0, errors: uniqueErrors, records: orderedRecords, summary };
  }

  function applyImportToDraft(state, validation, mode) {
    if (!validation?.valid) throw new Error('Only a validated Excel plan can be applied.');
    if (mode !== 'replace' && mode !== 'update') throw new Error('Select a valid import mode.');
    state.machines = Array.isArray(state.machines) ? state.machines : [];
    state.plans = state.plans && typeof state.plans === 'object' ? state.plans : {};
    const existingIds = new Set(state.machines.map(machine => String(machine.id)));
    let nextSortOrder = state.machines.reduce((maximum, machine) => Math.max(maximum, Number(machine.sortOrder) || 0), 0) + 1;
    for (const machine of validation.summary?.newMachines || []) {
      if (existingIds.has(machine.id)) continue;
      state.machines.push({ ...machine, sortOrder: nextSortOrder });
      existingIds.add(machine.id);
      nextSortOrder += 1;
    }

    const nextPlans = mode === 'replace'
      ? Object.fromEntries(state.machines.map(machine => [machine.id, []]))
      : Object.fromEntries(Object.entries(state.plans || {}).map(([id, periods]) => [id, periods.map(period => ({ ...period }))]));
    state.machines.forEach(machine => { if (!Array.isArray(nextPlans[machine.id])) nextPlans[machine.id] = []; });
    const grouped = new Map();
    validation.records.forEach(record => {
      if (!grouped.has(record.machineId)) grouped.set(record.machineId, []);
      grouped.get(record.machineId).push(record);
    });
    for (const [machineId, rows] of grouped) {
      nextPlans[machineId] = rows.sort((a, b) => a.sequence - b.sequence).map(row => ({
        kind: row.status === 'STOPPED' ? 'stopped' : 'run',
        product: row.status === 'STOPPED' ? 'Stopped' : row.product,
        days: row.duration,
        workers: row.status === 'STOPPED' ? 0 : row.workers
      }));
    }
    state.plans = nextPlans;
    return state;
  }

  return { HEADERS, LEGACY_HEADERS, validateWorkbook, applyImportToDraft };
}));
