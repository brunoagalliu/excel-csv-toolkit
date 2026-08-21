'use strict';

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const { load, save, Table, newXlsx } = require('../index');

const PORT = process.env.PORT || 3210;
const upload = multer({ dest: os.tmpdir() });

// Only ever send the browser a preview slice — for a million-row table the
// full JSON payload would be tens of MB and slow to parse for no benefit,
// since downloads and edits both operate on the full server-side table.
const PREVIEW_ROWS = 500;

// Single in-memory session: this is a local demo tool for one user at a time,
// not a multi-tenant server.
let session = null; // { table, originalTable, fileBase, log: string[] }

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireSession(res) {
  if (!session) {
    res.status(400).json({ error: 'No file loaded yet — upload a CSV or .xlsx first.' });
    return null;
  }
  return session;
}

function snapshot(extra = {}) {
  const rowCount = session.table.rowCount;
  return {
    columns: session.table.columns,
    rows: session.table.rows.slice(0, PREVIEW_ROWS).map((row) => {
      const out = {};
      session.table.columns.forEach((c) => (out[c] = row[c] ?? ''));
      return out;
    }),
    rowCount,
    previewRows: Math.min(PREVIEW_ROWS, rowCount),
    log: session.log,
    fileBase: session.fileBase,
    ...extra,
  };
}

function selectColumns(table, columns) {
  const cols = columns && columns.length ? columns : table.columns;
  const rows = table.rows.map((row) => {
    const out = {};
    cols.forEach((c) => (out[c] = row[c]));
    return out;
  });
  return new Table(cols, rows);
}

/**
 * Applies base filters, then dedupes, then splits into segments. Deduping
 * before the per-segment split (rather than within each segment) means a
 * key that appears under two different segments only survives in whichever
 * one its first occurrence belongs to, instead of showing up in both sheets.
 */
function buildSegments(table, baseFilters, keepColumns, segments, dedupeColumn) {
  let base = table;
  (baseFilters || []).forEach((f) => {
    if (!f.column) return;
    base = base.filter((row) => compareValues(row[f.column], f.operator, f.value));
  });

  if (dedupeColumn) {
    // .filter(() => true) forces an independent copy — base may still be
    // the original session table (e.g. no base filters given), and dedupe()
    // mutates in place, so we must never dedupe that shared reference.
    base = base.filter(() => true).dedupe((row) => row[dedupeColumn]);
  }

  return segments.map((seg) => {
    const segTable =
      seg.column && seg.contains
        ? base.filter((row) => compareValues(row[seg.column], 'contains', seg.contains))
        : base;
    return { name: seg.name, table: selectColumns(segTable, keepColumns) };
  });
}

function validateSegmentRequest(table, baseFilters, keepColumns, segments, dedupeColumn) {
  const cols = table.columns;
  (baseFilters || []).forEach((f) => {
    if (f.column && !cols.includes(f.column)) throw new Error(`Column "${f.column}" not found.`);
  });
  (keepColumns || []).forEach((c) => {
    if (!cols.includes(c)) throw new Error(`Column "${c}" not found.`);
  });
  if (dedupeColumn && !cols.includes(dedupeColumn)) {
    throw new Error(`Column "${dedupeColumn}" not found.`);
  }
  if (!segments || !segments.length) throw new Error('Add at least one segment.');
  segments.forEach((seg) => {
    if (!seg.name || !seg.name.trim()) throw new Error('Every segment needs a sheet name.');
    if (seg.column && !cols.includes(seg.column)) throw new Error(`Column "${seg.column}" not found.`);
  });
}

function uniqueSheetName(name, used) {
  const base = String(name).trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = `_${n++}`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

function coerce(value) {
  if (value === '' || value === null || value === undefined) return value;
  const n = Number(value);
  return Number.isNaN(n) ? value : n;
}

function compareValues(rowValue, operator, target) {
  const a = coerce(rowValue);
  const b = coerce(target);
  const bothNumeric = typeof a === 'number' && typeof b === 'number';
  switch (operator) {
    case 'eq':
      return bothNumeric ? a === b : String(rowValue ?? '') === String(target);
    case 'neq':
      return bothNumeric ? a !== b : String(rowValue ?? '') !== String(target);
    case 'gt':
      return bothNumeric ? a > b : String(rowValue ?? '') > String(target);
    case 'lt':
      return bothNumeric ? a < b : String(rowValue ?? '') < String(target);
    case 'gte':
      return bothNumeric ? a >= b : String(rowValue ?? '') >= String(target);
    case 'lte':
      return bothNumeric ? a <= b : String(rowValue ?? '') <= String(target);
    case 'contains':
      return String(rowValue ?? '').toLowerCase().includes(String(target).toLowerCase());
    default:
      throw new Error(`Unknown operator "${operator}"`);
  }
}

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  const ext = path.extname(req.file.originalname);
  if (!/\.(csv|xlsx?)$/i.test(ext)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: `Unsupported file type "${ext}". Use .csv or .xlsx.` });
  }
  try {
    const tempPath = req.file.path + ext;
    fs.renameSync(req.file.path, tempPath);
    const table = await load(tempPath);
    fs.unlink(tempPath, () => {});
    session = {
      table,
      originalTable: table.clone(),
      fileBase: path.basename(req.file.originalname, ext),
      log: [`Loaded ${req.file.originalname} — ${table.rowCount} rows, ${table.columns.length} columns.`],
    };
    res.json(snapshot());
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: `Could not parse file: ${err.message}` });
  }
});

app.post('/api/op/add-column', (req, res) => {
  const s = requireSession(res);
  if (!s) return;
  const { name, defaultValue } = req.body;
  try {
    s.table.addColumn(name, { defaultValue: coerce(defaultValue) });
    s.log.push(`Added column "${name}" (default: ${defaultValue === '' ? '(empty)' : defaultValue}).`);
    res.json(snapshot());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/op/drop-column', (req, res) => {
  const s = requireSession(res);
  if (!s) return;
  const { name } = req.body;
  if (!s.table.columns.includes(name)) {
    return res.status(400).json({ error: `Column "${name}" not found.` });
  }
  s.table.dropColumn(name);
  s.log.push(`Dropped column "${name}".`);
  res.json(snapshot());
});

app.post('/api/op/delete-rows', (req, res) => {
  const s = requireSession(res);
  if (!s) return;
  const { column, operator, value } = req.body;
  if (!s.table.columns.includes(column)) {
    return res.status(400).json({ error: `Column "${column}" not found.` });
  }
  try {
    const before = s.table.rowCount;
    s.table.deleteRows((row) => compareValues(row[column], operator, value));
    const removed = before - s.table.rowCount;
    s.log.push(`Deleted ${removed} row(s) where ${column} ${operator} ${value}.`);
    res.json(snapshot());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/op/find-replace', (req, res) => {
  const s = requireSession(res);
  if (!s) return;
  const { column, pattern, replacement, useRegex, flags } = req.body;
  if (column && !s.table.columns.includes(column)) {
    return res.status(400).json({ error: `Column "${column}" not found.` });
  }
  try {
    const needle = useRegex ? new RegExp(pattern, flags || 'g') : pattern;
    s.table.findReplace(needle, replacement, column ? { column } : {});
    s.log.push(
      `Find & replace "${pattern}" → "${replacement}"${column ? ` in ${column}` : ' (all columns)'}${useRegex ? ' [regex]' : ''}.`
    );
    res.json(snapshot());
  } catch (err) {
    res.status(400).json({ error: `Invalid pattern: ${err.message}` });
  }
});

app.post('/api/op/sort', (req, res) => {
  const s = requireSession(res);
  if (!s) return;
  const { column, desc } = req.body;
  if (!s.table.columns.includes(column)) {
    return res.status(400).json({ error: `Column "${column}" not found.` });
  }
  s.table.sort((row) => coerce(row[column]), { desc: !!desc });
  s.log.push(`Sorted by "${column}" (${desc ? 'descending' : 'ascending'}).`);
  res.json(snapshot());
});

app.post('/api/op/dedupe', (req, res) => {
  const s = requireSession(res);
  if (!s) return;
  const { column } = req.body;
  if (column && !s.table.columns.includes(column)) {
    return res.status(400).json({ error: `Column "${column}" not found.` });
  }
  const before = s.table.rowCount;
  s.table.dedupe(column ? (row) => row[column] : undefined);
  const removed = before - s.table.rowCount;
  s.log.push(`Removed ${removed} duplicate row(s)${column ? ` by "${column}"` : ''}.`);
  res.json(snapshot());
});

app.post('/api/reset', (req, res) => {
  const s = requireSession(res);
  if (!s) return;
  s.table = s.originalTable.clone();
  s.log = [`Reset to the original ${s.table.rowCount} rows.`];
  res.json(snapshot());
});

app.get('/api/download', async (req, res) => {
  const s = requireSession(res);
  if (!s) return;
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  const tempPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.${format}`);
  try {
    await save(s.table, tempPath);
    res.download(tempPath, `${s.fileBase}-edited.${format}`, (err) => {
      fs.unlink(tempPath, () => {});
      if (err && !res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/segment-preview', (req, res) => {
  const s = requireSession(res);
  if (!s) return;
  const { baseFilters = [], keepColumns = [], segments = [], dedupeColumn = '' } = req.body;
  try {
    validateSegmentRequest(s.table, baseFilters, keepColumns, segments, dedupeColumn);
    const built = buildSegments(s.table, baseFilters, keepColumns, segments, dedupeColumn);
    res.json({ counts: built.map((seg) => ({ name: seg.name, rowCount: seg.table.rowCount })) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/export-segments', async (req, res) => {
  const s = requireSession(res);
  if (!s) return;
  const { baseFilters = [], keepColumns = [], segments = [], dedupeColumn = '' } = req.body;
  try {
    validateSegmentRequest(s.table, baseFilters, keepColumns, segments, dedupeColumn);
    const built = buildSegments(s.table, baseFilters, keepColumns, segments, dedupeColumn);

    const wb = newXlsx();
    const used = new Set();
    built.forEach((seg) => {
      wb.addSheet(uniqueSheetName(seg.name, used), seg.table);
    });

    const tempPath = path.join(os.tmpdir(), `${crypto.randomUUID()}.xlsx`);
    await wb.save(tempPath);
    res.download(tempPath, `${s.fileBase}-segments.xlsx`, (err) => {
      fs.unlink(tempPath, () => {});
      if (err && !res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`excel-csv-toolkit UI running at http://localhost:${PORT}`);
});
