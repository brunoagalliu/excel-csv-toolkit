'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  Table,
  readCsv,
  writeCsv,
  readXlsx,
  newXlsx,
  joinTables,
  load,
  save,
} = require('../src/index');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-csv-toolkit-'));

test('Table: column and row edits', () => {
  const t = Table.fromRows([
    { name: 'Alice', age: 30 },
    { name: 'Bob', age: 25 },
  ]);

  t.addColumn('active', { defaultValue: true });
  assert.deepEqual(t.columns, ['name', 'age', 'active']);

  t.renameColumn('age', 'years');
  assert.equal(t.rows[0].years, 30);

  t.updateWhere((r) => r.name === 'Bob', { years: 26 });
  assert.equal(t.rows[1].years, 26);

  t.deleteRows((r) => r.name === 'Alice');
  assert.equal(t.rowCount, 1);

  t.addRow({ name: 'Carol', years: 40, active: false });
  assert.equal(t.rowCount, 2);

  t.dropColumn('active');
  assert.ok(!t.columns.includes('active'));
});

test('Table: find & replace', () => {
  const t = Table.fromRows([
    { city: 'New York' },
    { city: 'new york city' },
  ]);
  t.findReplace(/new york/i, 'NYC', { column: 'city' });
  assert.equal(t.rows[0].city, 'NYC');
  assert.equal(t.rows[1].city, 'NYC city');
});

test('CSV round-trip', () => {
  const t = Table.fromRows([
    { id: '1', name: 'Widget', price: '9.99' },
    { id: '2', name: 'Gadget', price: '19.99' },
  ]);
  const file = path.join(tmpDir, 'products.csv');
  writeCsv(t, file);

  const read = readCsv(file);
  assert.deepEqual(read.columns, ['id', 'name', 'price']);
  assert.equal(read.rowCount, 2);
  assert.equal(read.rows[1].name, 'Gadget');
});

test('joinTables: left join with column collision', () => {
  const orders = Table.fromRows([
    { order_id: 1, user_id: 1, total: 50 },
    { order_id: 2, user_id: 2, total: 75 },
    { order_id: 3, user_id: 9, total: 10 },
  ]);
  const users = Table.fromRows([
    { id: 1, name: 'Alice', total: 'ignored' },
    { id: 2, name: 'Bob', total: 'ignored' },
  ]);

  const joined = joinTables(orders, users, { leftOn: 'user_id', rightOn: 'id', how: 'left' });
  assert.equal(joined.rowCount, 3);
  assert.ok(joined.columns.includes('total_right'));
  assert.equal(joined.rows.find((r) => r.order_id === 1).name, 'Alice');
  assert.equal(joined.rows.find((r) => r.order_id === 3).name, null);
});

test('XLSX: write with formulas + formatting, read back computed layout', async () => {
  const t = Table.fromRows([
    { item: 'Widget', qty: 3, price: 9.99 },
    { item: 'Gadget', qty: 2, price: 19.99 },
  ]);
  t.addColumn('total', { defaultValue: null });

  const wb = newXlsx();
  const sheet = wb.addSheet('Orders', t);
  sheet.setFormula('D2', 'B2*C2');
  sheet.setFormula('D3', 'B3*C3');
  sheet.setStyle('A1:D1', { font: { bold: true } });
  sheet.setColumnFormat('C', '"$"#,##0.00');
  sheet.autoFitColumns();

  const file = path.join(tmpDir, 'orders.xlsx');
  await wb.save(file);
  assert.ok(fs.existsSync(file));

  const reread = await readXlsx(file);
  const orders = reread.sheet('Orders');
  assert.deepEqual(orders.table.columns, ['item', 'qty', 'price', 'total']);
  assert.equal(orders.table.rowCount, 2);
  assert.equal(orders.worksheet.getCell('A1').font.bold, true);
  assert.equal(orders.worksheet.getCell('D2').formula, 'B2*C2');
});

test('XLSX: setAutoFilter defaults to full table extent and round-trips', async () => {
  const t = Table.fromRows([
    { item: 'Widget', qty: 3 },
    { item: 'Gadget', qty: 2 },
    { item: 'Gizmo', qty: 5 },
  ]);

  const wb = newXlsx();
  const sheet = wb.addSheet('Stock', t);
  sheet.setAutoFilter();

  const file = path.join(tmpDir, 'autofilter.xlsx');
  await wb.save(file);

  const reread = await readXlsx(file);
  assert.equal(reread.sheet('Stock').worksheet.autoFilter, 'A1:B4');
});

test('XLSX: setAutoFilter accepts an explicit range and clearAutoFilter removes it', async () => {
  const t = Table.fromRows([{ a: 1, b: 2, c: 3 }]);
  const wb = newXlsx();
  const sheet = wb.addSheet('Data', t);

  sheet.setAutoFilter('A1:B1');
  assert.equal(sheet.worksheet.autoFilter, 'A1:B1');

  sheet.clearAutoFilter();
  assert.equal(sheet.worksheet.autoFilter, null);
});

test('load/save dispatch by extension', async () => {
  const t = Table.fromRows([{ a: 1, b: 2 }]);
  const csvFile = path.join(tmpDir, 'x.csv');
  const xlsxFile = path.join(tmpDir, 'x.xlsx');

  await save(t, csvFile);
  await save(t, xlsxFile);

  const fromCsv = await load(csvFile);
  const fromXlsx = await load(xlsxFile);
  assert.equal(fromCsv.rowCount, 1);
  assert.equal(fromXlsx.rowCount, 1);
});
