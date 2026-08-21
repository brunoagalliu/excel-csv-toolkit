'use strict';

// Join an orders CSV with a users CSV on a shared key, write result to xlsx.
const { readCsv, joinTables, save } = require('../src/index');

async function main() {
  const orders = readCsv('./data/orders.csv');
  const users = readCsv('./data/users.csv');

  const joined = joinTables(orders, users, {
    leftOn: 'user_id',
    rightOn: 'id',
    how: 'left',
  });

  await save(joined, './data/orders-with-users.xlsx');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
