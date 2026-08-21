'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  loadLargeCsv,
  transformCsvStream,
  streamDedupeCsv,
  streamAggregateCsv,
} = require('../src/large');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-csv-toolkit-large-'));

function generateCsv(filePath, rowCount) {
  const regions = ['east', 'west', 'north', 'south'];
  const stream = fs.createWriteStream(filePath);
  stream.write('id,region,amount\n');
  for (let i = 0; i < rowCount; i++) {
    const region = regions[i % regions.length];
    const dupKey = i % 5 === 0 ? i - 1 : i; // introduce some duplicate rows
    stream.write(`${dupKey},${region},${(i % 100) + 1}\n`);
  }
  stream.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

test('loadLargeCsv: streams a big file into a Table', async () => {
  const file = path.join(tmpDir, 'big.csv');
  await generateCsv(file, 20000);

  const table = await loadLargeCsv(file);
  assert.equal(table.rowCount, 20000);
  assert.deepEqual(table.columns, ['id', 'region', 'amount']);
});

test('transformCsvStream: row-by-row transform without full load', async () => {
  const input = path.join(tmpDir, 'transform-in.csv');
  const output = path.join(tmpDir, 'transform-out.csv');
  await generateCsv(input, 5000);

  await transformCsvStream(input, output, (row) => {
    if (row.region !== 'east') return null;
    return { ...row, amount: Number(row.amount) * 2 };
  });

  const result = await loadLargeCsv(output);
  assert.ok(result.rowCount > 0);
  assert.ok(result.rows.every((r) => r.region === 'east'));
});

test('streamDedupeCsv: removes duplicate rows using O(unique keys) memory', async () => {
  const input = path.join(tmpDir, 'dedupe-in.csv');
  const output = path.join(tmpDir, 'dedupe-out.csv');
  await generateCsv(input, 10000);

  const before = await loadLargeCsv(input);
  const dupCount = before.rowCount - new Set(before.rows.map((r) => r.id)).size;
  assert.ok(dupCount > 0, 'sanity check: fixture actually has duplicate ids');

  await streamDedupeCsv(input, output, (row) => row.id);
  const after = await loadLargeCsv(output);
  assert.equal(after.rowCount, new Set(before.rows.map((r) => r.id)).size);
});

test('streamAggregateCsv: group-by sum/count without full load', async () => {
  const input = path.join(tmpDir, 'agg-in.csv');
  await generateCsv(input, 8000);

  const grouped = await streamAggregateCsv(input, {
    groupBy: (row) => row.region,
    aggregations: {
      total: (acc, row) => (acc ?? 0) + Number(row.amount),
      count: (acc, row) => (acc ?? 0) + 1,
    },
  });

  assert.equal(grouped.rowCount, 4); // east/west/north/south
  const east = grouped.rows.find((r) => r.group === 'east');
  assert.equal(east.count, 2000);
  assert.ok(east.total > 0);

  const totalRowsAcrossGroups = grouped.rows.reduce((s, r) => s + r.count, 0);
  assert.equal(totalRowsAcrossGroups, 8000);
});
