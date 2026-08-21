'use strict';

// Load a CSV, make edits, save it back.
const { load, save } = require('../src/index');

async function main() {
  const table = await load('./data/products.csv');

  table.addColumn('in_stock', { defaultValue: true });
  table.updateWhere((row) => Number(row.price) > 100, { in_stock: false });
  table.findReplace(/\bLtd\.?$/i, 'Limited', { column: 'vendor' });
  table.deleteRows((row) => Number(row.price) <= 0);

  await save(table, './data/products-updated.csv');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
