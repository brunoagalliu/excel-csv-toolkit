'use strict';

const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { Table } = require('./table');

function readCsv(filePath, options = {}) {
  const content = fs.readFileSync(filePath, 'utf8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    ...options,
  });
  return Table.fromRows(records);
}

function writeCsv(table, filePath, options = {}) {
  const output = stringify(table.toRows(), {
    header: true,
    columns: table.columns,
    cast: { boolean: (value) => (value ? 'true' : 'false') },
    ...options,
  });
  fs.writeFileSync(filePath, output);
}

module.exports = { readCsv, writeCsv };
