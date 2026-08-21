'use strict';

const fs = require('fs');
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');
const { Table } = require('./table');

/**
 * Like readCsv, but parses off a read stream instead of readFileSync'ing the
 * whole file into a string first, so parsing overlaps with I/O and the
 * event loop isn't blocked for the whole file at once the way sync parsing
 * is. It still builds a fully in-memory Table — final memory use is about
 * the same as readCsv (dominated by the parsed row objects either way) —
 * so use this for operations like sort that need every row present at once.
 * For dedupe/aggregation on files too big to hold in memory at all, use
 * streamDedupeCsv / streamAggregateCsv below instead.
 */
function loadLargeCsv(filePath, parseOptions = {}) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let columns = [];
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true, ...parseOptions }))
      .on('data', (row) => {
        if (columns.length === 0) columns = Object.keys(row);
        rows.push(row);
      })
      .on('end', () => resolve(new Table(columns, rows)))
      .on('error', reject);
  });
}

/**
 * Stream-transform a CSV row by row without ever holding the full file in
 * memory. `rowFn(row, index)` returns a replacement row object, an array of
 * rows (to expand one row into several), or null/undefined to drop the row.
 */
function transformCsvStream(inputPath, outputPath, rowFn, { parseOptions = {}, stringifyOptions = {} } = {}) {
  return new Promise((resolve, reject) => {
    let index = 0;
    let columns = null;
    const output = fs.createWriteStream(outputPath);
    const stringifier = stringify({ header: true, cast: { boolean: (v) => (v ? 'true' : 'false') }, ...stringifyOptions });
    stringifier.pipe(output);

    fs.createReadStream(inputPath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true, ...parseOptions }))
      .on('data', (row) => {
        const result = rowFn(row, index++);
        if (result == null) return;
        const rowsOut = Array.isArray(result) ? result : [result];
        rowsOut.forEach((r) => stringifier.write(r));
      })
      .on('end', () => stringifier.end())
      .on('error', reject);

    output.on('finish', resolve);
    output.on('error', reject);
    stringifier.on('error', reject);
  });
}

/**
 * Stream-dedupe a CSV to a new file. The file itself is never loaded in
 * full — only a Set of dedupe keys is held in memory — but memory use
 * scales with the number of *distinct* keys seen, not total rows. This is
 * a big win when the key has low cardinality (e.g. dedupe by a shared
 * user_id); if nearly every row has a unique key, the key Set approaches
 * the size of the full dataset. `keyFn` defaults to the whole row (JSON).
 */
function streamDedupeCsv(inputPath, outputPath, keyFn = (row) => JSON.stringify(row)) {
  const seen = new Set();
  return transformCsvStream(inputPath, outputPath, (row) => {
    const key = keyFn(row);
    if (seen.has(key)) return null;
    seen.add(key);
    return row;
  });
}

/**
 * Stream-aggregate a CSV by group without loading the full file. Memory use
 * is O(unique groups). Returns a Table (one row per group) — small enough
 * to hold in memory even when the source file isn't.
 *
 * streamAggregateCsv('./huge.csv', {
 *   groupBy: row => row.region,
 *   aggregations: {
 *     total: (acc, row) => (acc ?? 0) + Number(row.amount),
 *     count: (acc, row) => (acc ?? 0) + 1,
 *   },
 * })
 */
function streamAggregateCsv(inputPath, { groupBy, aggregations, groupColumn = 'group', parseOptions = {} }) {
  return new Promise((resolve, reject) => {
    const state = new Map(); // key -> { [aggName]: accumulator }
    const aggNames = Object.keys(aggregations);

    fs.createReadStream(inputPath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true, ...parseOptions }))
      .on('data', (row) => {
        const key = groupBy(row);
        if (!state.has(key)) state.set(key, {});
        const acc = state.get(key);
        aggNames.forEach((name) => {
          acc[name] = aggregations[name](acc[name], row);
        });
      })
      .on('end', () => {
        const outRows = [...state.entries()].map(([key, acc]) => ({
          [groupColumn]: key,
          ...acc,
        }));
        resolve(new Table([groupColumn, ...aggNames], outRows));
      })
      .on('error', reject);
  });
}

module.exports = { loadLargeCsv, transformCsvStream, streamDedupeCsv, streamAggregateCsv };
