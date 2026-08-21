'use strict';

// Build an .xlsx with formulas and cell formatting from scratch.
const { Table, newXlsx } = require('../src/index');

async function main() {
  const table = Table.fromRows([
    { item: 'Widget', qty: 3, price: 9.99 },
    { item: 'Gadget', qty: 2, price: 19.99 },
  ]);
  table.addColumn('total', { defaultValue: null });

  const wb = newXlsx();
  const sheet = wb.addSheet('Orders', table);

  table.rows.forEach((_, i) => {
    const row = i + 2; // header is row 1
    sheet.setFormula(`D${row}`, `B${row}*C${row}`);
  });

  sheet.setStyle('A1:D1', { font: { bold: true } });
  sheet.setColumnFormat('C', '"$"#,##0.00');
  sheet.setColumnFormat('D', '"$"#,##0.00');
  sheet.autoFitColumns();
  sheet.setAutoFilter(); // adds Excel's filter dropdowns to the header row

  await wb.save('./data/orders.xlsx');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
