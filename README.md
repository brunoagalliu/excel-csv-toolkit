# excel-csv-toolkit

Node.js library for reading, editing, merging, and writing CSV and Excel (`.xlsx`) files.

- **Shared `Table` model** for row/column edits, find & replace, and merge/join — works the same whether the source is CSV or Excel.
- **Excel-specific extras** — formulas, cell/range styling, number formats, multiple sheets — via direct `exceljs` access on top of the same `Table`.

## Install

Dependencies are already installed in this directory (`exceljs`, `csv-parse`, `csv-stringify`). To use this as a dependency in another project:

```bash
npm install /Users/brunoagalliu/excel-csv-toolkit
```

## Quick start

```js
const { load, save } = require('excel-csv-toolkit');

const table = await load('./data.csv'); // or .xlsx

table.addColumn('in_stock', { defaultValue: true });
table.updateWhere(row => Number(row.price) > 100, { in_stock: false });
table.findReplace(/\bLtd\.?$/i, 'Limited', { column: 'vendor' });
table.deleteRows(row => Number(row.price) <= 0);

await save(table, './data-updated.xlsx');
```

See `examples/` for runnable scripts:
- `basic-edit.js` — row/column edits and find & replace on a CSV
- `xlsx-formulas.js` — build an .xlsx with formulas, styling, and number formats
- `merge-files.js` — join two CSVs on a key and write the result to .xlsx

## API

### `Table`

The shared in-memory data model: `table.columns` (ordered array of names) and `table.rows` (array of plain row objects).

```js
const { Table } = require('excel-csv-toolkit');

Table.fromRows(rows)                 // build from an array of objects
table.addColumn(name, { defaultValue, fill })
table.dropColumn(name)
table.renameColumn(oldName, newName)
table.reorderColumns(['b', 'a'])     // named columns first, rest keep relative order

table.addRow(row)
table.deleteRows(predicate)          // predicate(row, index) => boolean
table.filter(predicate)              // returns a new Table
table.sort(keyOrFn, { desc })        // sort by column name, key fn, or (a,b) comparator

table.updateWhere(predicate, updates)  // updates: object or (row, index) => partial
table.findReplace(pattern, replacement, { column })  // pattern: string or RegExp

table.rowCount
table.clone()
table.toRows()                       // plain array of objects, missing values as ''
```

### CSV

```js
const { readCsv, writeCsv } = require('excel-csv-toolkit');

const table = readCsv('./file.csv');
writeCsv(table, './out.csv');
```

### Excel (.xlsx)

```js
const { readXlsx, newXlsx } = require('excel-csv-toolkit');

const wb = await readXlsx('./file.xlsx');
const sheet = wb.sheet('Sheet1');   // or wb.sheet() for the first sheet
sheet.table                          // the Table for this sheet — edit it directly

const wb2 = newXlsx();
const s2 = wb2.addSheet('Orders', table);   // table: a Table instance or array of rows
wb2.removeSheet('OldSheet');

await wb.save('./out.xlsx');         // writes back every sheet's current table
```

`Sheet` extras (operate directly on the underlying worksheet, independent of `table` edits):

```js
sheet.setFormula('D2', 'B2*C2');            // sets a formula cell; kept in sync with table
sheet.setStyle('A1:D1', { font: { bold: true } });
sheet.setColumnFormat('C', '"$"#,##0.00');  // number format for a whole column
sheet.autoFitColumns();
sheet.setAutoFilter();                      // Excel-style filter dropdowns on the header row, sized to the full table
sheet.setAutoFilter('A1:D1');               // or an explicit range
sheet.clearAutoFilter();

sheet.worksheet    // raw exceljs Worksheet, for anything not covered above
```

Note: `exceljs` doesn't evaluate formulas — reading a cell you just wrote a formula into gives you back `{ formula: '...' }`, not a computed value. Opening the file in Excel/Sheets/Numbers computes it normally.

### Merge / join

```js
const { joinTables, concatTables } = require('excel-csv-toolkit');

joinTables(orders, users, { on: 'id', how: 'inner' });               // same key name in both
joinTables(orders, users, { leftOn: 'user_id', rightOn: 'id', how: 'left' });
// how: 'inner' | 'left' | 'right' | 'full' (default 'inner')
// non-key columns present in both tables get a `_right` suffix on collision (configurable via rightSuffix)

concatTables([tableA, tableB]);   // stack rows from tables with the same columns
```

### Format-agnostic helpers

```js
const { load, save } = require('excel-csv-toolkit');

const table = await load('./file.csv');   // or .xlsx — dispatches on extension
await save(table, './file.xlsx', { sheetName: 'Sheet1' });
```

## Large files

`readCsv`/`Table` load the whole file into memory — fine up to a couple hundred MB (measured: a 149MB / 2.5M-row CSV loads in ~4s at ~710MB RSS). That's the right path for **sort**, which inherently needs every row in memory at once:

```js
const { loadLargeCsv, writeCsv } = require('excel-csv-toolkit');

const table = await loadLargeCsv('./huge.csv'); // streaming parse, same memory profile as readCsv but doesn't block the event loop
table.sort('amount', { desc: true });
writeCsv(table, './huge-sorted.csv');
```

For **dedupe** and **group-by/aggregation**, use the streaming versions — they never hold the full file in memory, only a Map/Set keyed by whatever you're grouping or deduping on:

```js
const { streamDedupeCsv, streamAggregateCsv, transformCsvStream } = require('excel-csv-toolkit');

// dedupe: memory scales with *distinct* keys, not row count — cheap if the
// key has low cardinality, approaches full-file size if nearly every row is unique
await streamDedupeCsv('./huge.csv', './huge-deduped.csv', row => row.user_id);

// aggregate: memory scales with number of groups (measured: same 149MB file,
// ~60MB peak RSS grouping by a 4-value column, vs ~710MB for a full load)
const totals = await streamAggregateCsv('./huge.csv', {
  groupBy: row => row.region,
  aggregations: {
    total: (acc, row) => (acc ?? 0) + Number(row.amount),
    count: (acc, row) => (acc ?? 0) + 1,
  },
});

// row-by-row transform/filter, streamed straight through to a new file
await transformCsvStream('./huge.csv', './huge-filtered.csv', row =>
  row.status === 'active' ? row : null
);
```

`.xlsx` is much heavier per row than CSV (exceljs holds the whole workbook in memory); if a 140MB+ file needs to become Excel output, prefer writing CSV and only convert a smaller, already-aggregated result to `.xlsx`.

## Testing

```bash
npm test
```
