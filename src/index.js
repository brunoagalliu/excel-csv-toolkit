'use strict';

const { Table } = require('./table');
const { readCsv, writeCsv } = require('./csv');
const { readXlsx, newXlsx, Workbook, Sheet } = require('./xlsx');
const { joinTables, concatTables } = require('./merge');
const { loadLargeCsv, transformCsvStream, streamDedupeCsv, streamAggregateCsv } = require('./large');

/** Load a .csv or .xlsx file into a Table (first sheet, for .xlsx). */
async function load(filePath) {
  if (/\.xlsx?$/i.test(filePath)) {
    const wb = await readXlsx(filePath);
    return wb.sheet().table;
  }
  return readCsv(filePath);
}

/** Save a Table to .csv or .xlsx (single sheet named "Sheet1"). */
async function save(table, filePath, { sheetName = 'Sheet1' } = {}) {
  if (/\.xlsx?$/i.test(filePath)) {
    const wb = newXlsx();
    wb.addSheet(sheetName, table);
    await wb.save(filePath);
    return;
  }
  writeCsv(table, filePath);
}

module.exports = {
  Table,
  readCsv,
  writeCsv,
  readXlsx,
  newXlsx,
  Workbook,
  Sheet,
  joinTables,
  concatTables,
  load,
  save,
  loadLargeCsv,
  transformCsvStream,
  streamDedupeCsv,
  streamAggregateCsv,
};
