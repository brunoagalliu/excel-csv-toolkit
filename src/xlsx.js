'use strict';

const ExcelJS = require('exceljs');
const { Table } = require('./table');

/**
 * Wraps one exceljs Worksheet with a Table view of its data plus helpers for
 * formulas and cell formatting. `table` and `sheet.rows` stay independent
 * until you call writeBack() (or Workbook.save(), which calls it for you).
 */
class Sheet {
  constructor(worksheet) {
    this.worksheet = worksheet;
    this.table = readTableFromWorksheet(worksheet);
  }

  get name() {
    return this.worksheet.name;
  }

  /** Set a formula on a cell, e.g. sheet.setFormula('D2', 'B2*C2'). */
  setFormula(cellRef, formula) {
    const value = { formula: formula.replace(/^=/, '') };
    this.worksheet.getCell(cellRef).value = value;

    // Keep this.table in sync so a later save()/writeBack() doesn't
    // overwrite the formula with the table's stale plain value.
    const parsed = parseCellRef(cellRef);
    if (parsed) {
      const dataRowIndex = parsed.row - 2; // row 1 is the header
      const colName = this.table.columns[parsed.col - 1];
      if (colName && dataRowIndex >= 0 && dataRowIndex < this.table.rows.length) {
        this.table.rows[dataRowIndex][colName] = value;
      }
    }
    return this;
  }

  /**
   * Apply exceljs style properties to a cell or range, e.g.
   * sheet.setStyle('A1:D1', { font: { bold: true }, fill: {...} }).
   */
  setStyle(cellRefOrRange, style) {
    if (cellRefOrRange.includes(':')) {
      const [start, end] = cellRefOrRange.split(':');
      const startCell = this.worksheet.getCell(start);
      const endCell = this.worksheet.getCell(end);
      for (let r = startCell.row; r <= endCell.row; r++) {
        for (let c = startCell.col; c <= endCell.col; c++) {
          Object.assign(this.worksheet.getCell(r, c), style);
        }
      }
    } else {
      Object.assign(this.worksheet.getCell(cellRefOrRange), style);
    }
    return this;
  }

  setColumnFormat(columnLetterOrIndex, numFmt) {
    this.worksheet.getColumn(columnLetterOrIndex).numFmt = numFmt;
    return this;
  }

  /**
   * Turn on Excel's AutoFilter (the dropdown arrows on the header row) over
   * the sheet's data. Defaults to the full extent of `this.table`
   * (A1:<lastCol><lastRow>); pass an explicit range (e.g. 'A1:D1') to cover
   * something else. Call save() afterward as usual — no separate write step.
   */
  setAutoFilter(range) {
    if (range) {
      this.worksheet.autoFilter = range;
      return this;
    }
    if (!this.table.columns.length) {
      throw new Error('setAutoFilter: table has no columns to filter');
    }
    const lastCol = numberToColumnLetter(this.table.columns.length);
    const lastRow = this.table.rowCount + 1; // + header
    this.worksheet.autoFilter = `A1:${lastCol}${lastRow}`;
    return this;
  }

  clearAutoFilter() {
    this.worksheet.autoFilter = null;
    return this;
  }

  autoFitColumns(minWidth = 10, maxWidth = 60) {
    this.worksheet.columns.forEach((col) => {
      let max = minWidth;
      col.eachCell({ includeEmpty: true }, (cell) => {
        const len = cell.value ? String(cell.value.result ?? cell.value).length : 0;
        if (len + 2 > max) max = Math.min(len + 2, maxWidth);
      });
      col.width = max;
    });
    return this;
  }

  /** Push edits made to `this.table` back into the underlying worksheet cells. */
  writeBack() {
    writeTableToWorksheet(this.worksheet, this.table);
    return this;
  }
}

class Workbook {
  constructor(exceljsWorkbook) {
    this.workbook = exceljsWorkbook;
    this.sheets = {};
    exceljsWorkbook.eachSheet((worksheet) => {
      this.sheets[worksheet.name] = new Sheet(worksheet);
    });
  }

  sheet(name) {
    if (name === undefined) return Object.values(this.sheets)[0];
    const s = this.sheets[name];
    if (!s) throw new Error(`Sheet "${name}" not found`);
    return s;
  }

  addSheet(name, table) {
    const worksheet = this.workbook.addWorksheet(name);
    const t = table instanceof Table ? table : Table.fromRows(table);
    writeTableToWorksheet(worksheet, t);
    const sheet = new Sheet(worksheet);
    this.sheets[name] = sheet;
    return sheet;
  }

  removeSheet(name) {
    const s = this.sheets[name];
    if (!s) return this;
    this.workbook.removeWorksheet(s.worksheet.id);
    delete this.sheets[name];
    return this;
  }

  async save(filePath) {
    Object.values(this.sheets).forEach((s) => s.writeBack());
    await this.workbook.xlsx.writeFile(filePath);
  }
}

function readTableFromWorksheet(worksheet) {
  const rows = [];
  let headers = [];
  worksheet.eachRow((row, rowNumber) => {
    const values = row.values.slice(1).map((v) => {
      if (v && typeof v === 'object' && 'result' in v) return v.result;
      if (v && typeof v === 'object' && v.text) return v.text;
      return v ?? null;
    });
    if (rowNumber === 1) {
      headers = values.map((h, i) => (h != null && h !== '' ? String(h) : `col${i + 1}`));
      return;
    }
    const obj = {};
    headers.forEach((h, i) => (obj[h] = values[i] ?? null));
    rows.push(obj);
  });
  return new Table(headers, rows);
}

function numberToColumnLetter(n) {
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function parseCellRef(ref) {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!match) return null;
  const [, letters, digits] = match;
  let col = 0;
  for (const ch of letters.toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { col, row: Number(digits) };
}

/**
 * Writes `table` into `worksheet` by setting cell values in place (rather
 * than replacing Row objects), so existing cell styles survive repeated
 * writes. Note: exceljs's spliceRows(1, n) silently no-ops when start === 1,
 * so trailing-row cleanup below always starts at row 2+.
 */
function writeTableToWorksheet(worksheet, table) {
  const totalRows = table.rowCount + 1; // header + data

  const headerRow = worksheet.getRow(1);
  table.columns.forEach((col, i) => {
    headerRow.getCell(i + 1).value = col;
  });
  for (let c = table.columns.length + 1; c <= headerRow.cellCount; c++) {
    headerRow.getCell(c).value = null;
  }

  table.rows.forEach((rowData, i) => {
    const row = worksheet.getRow(i + 2);
    table.columns.forEach((col, ci) => {
      row.getCell(ci + 1).value = rowData[col] ?? null;
    });
    for (let c = table.columns.length + 1; c <= row.cellCount; c++) {
      row.getCell(c).value = null;
    }
  });

  const oldRowCount = worksheet.rowCount;
  if (oldRowCount > totalRows) {
    worksheet.spliceRows(totalRows + 1, oldRowCount - totalRows);
  }
}

async function readXlsx(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return new Workbook(workbook);
}

function newXlsx() {
  return new Workbook(new ExcelJS.Workbook());
}

module.exports = { readXlsx, newXlsx, Workbook, Sheet };
