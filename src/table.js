'use strict';

/**
 * In-memory tabular data: an ordered list of column names plus an array of
 * row objects keyed by column name. Shared by the CSV and Excel adapters so
 * the same edit operations work regardless of source format.
 */
class Table {
  constructor(columns = [], rows = []) {
    this.columns = [...columns];
    this.rows = rows.map((row) => ({ ...row }));
  }

  static fromRows(rows) {
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return new Table(columns, rows);
  }

  get rowCount() {
    return this.rows.length;
  }

  clone() {
    return new Table(this.columns, this.rows);
  }

  // ---- columns ----

  addColumn(name, { defaultValue = null, fill } = {}) {
    if (this.columns.includes(name)) {
      throw new Error(`Column "${name}" already exists`);
    }
    this.columns.push(name);
    this.rows.forEach((row, i) => {
      row[name] = typeof fill === 'function' ? fill(row, i) : defaultValue;
    });
    return this;
  }

  dropColumn(name) {
    this.columns = this.columns.filter((c) => c !== name);
    this.rows.forEach((row) => delete row[name]);
    return this;
  }

  renameColumn(oldName, newName) {
    const idx = this.columns.indexOf(oldName);
    if (idx === -1) throw new Error(`Column "${oldName}" not found`);
    this.columns[idx] = newName;
    this.rows.forEach((row) => {
      row[newName] = row[oldName];
      if (oldName !== newName) delete row[oldName];
    });
    return this;
  }

  reorderColumns(order) {
    const missing = order.filter((c) => !this.columns.includes(c));
    if (missing.length) throw new Error(`Unknown column(s): ${missing.join(', ')}`);
    const remaining = this.columns.filter((c) => !order.includes(c));
    this.columns = [...order, ...remaining];
    return this;
  }

  // ---- rows ----

  addRow(row) {
    const full = {};
    this.columns.forEach((c) => (full[c] = c in row ? row[c] : null));
    this.rows.push(full);
    return this;
  }

  deleteRows(predicate) {
    this.rows = this.rows.filter((row, i) => !predicate(row, i));
    return this;
  }

  filter(predicate) {
    return new Table(this.columns, this.rows.filter(predicate));
  }

  sort(compareOrKey, { desc = false } = {}) {
    const cmp =
      typeof compareOrKey === 'function' && compareOrKey.length === 2
        ? compareOrKey
        : (a, b) => {
            const key = typeof compareOrKey === 'function' ? compareOrKey(a) : a[compareOrKey];
            const other = typeof compareOrKey === 'function' ? compareOrKey(b) : b[compareOrKey];
            if (key < other) return -1;
            if (key > other) return 1;
            return 0;
          };
    this.rows.sort((a, b) => (desc ? -cmp(a, b) : cmp(a, b)));
    return this;
  }

  // ---- values ----

  /**
   * Update cells in-place. `updates` is either an object merged into every
   * matching row, or a function (row, index) => partialUpdates.
   */
  updateWhere(predicate, updates) {
    this.rows.forEach((row, i) => {
      if (!predicate(row, i)) return;
      const patch = typeof updates === 'function' ? updates(row, i) : updates;
      Object.assign(row, patch);
    });
    return this;
  }

  /**
   * Find & replace within one column (or all columns if `column` is omitted).
   * `pattern` may be a string (exact match) or RegExp.
   */
  findReplace(pattern, replacement, { column } = {}) {
    const cols = column ? [column] : this.columns;
    const test = (val) => {
      if (val == null) return false;
      const str = String(val);
      return pattern instanceof RegExp ? pattern.test(str) : str === pattern;
    };
    const apply = (val) => {
      const str = String(val);
      if (pattern instanceof RegExp) return str.replace(pattern, replacement);
      return str === pattern ? replacement : str;
    };
    this.rows.forEach((row) => {
      cols.forEach((c) => {
        if (test(row[c])) row[c] = apply(row[c]);
      });
    });
    return this;
  }

  /**
   * Drop duplicate rows. `keyFn` derives a dedupe key from a row (defaults
   * to the JSON of the whole row); the first row seen per key is kept.
   */
  dedupe(keyFn = (row) => JSON.stringify(row)) {
    const seen = new Set();
    this.rows = this.rows.filter((row) => {
      const key = keyFn(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return this;
  }

  /**
   * Group rows by `keyFn` and reduce each group with `aggregations`, e.g.
   * table.groupBy(row => row.region, {
   *   total: (rows) => rows.reduce((s, r) => s + Number(r.amount), 0),
   *   count: (rows) => rows.length,
   * })
   * Returns a new Table with one row per group: the group key column
   * (named `groupColumn`, default 'group') plus one column per aggregation.
   */
  groupBy(keyFn, aggregations, { groupColumn = 'group' } = {}) {
    const groups = new Map();
    this.rows.forEach((row) => {
      const key = keyFn(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    const aggNames = Object.keys(aggregations);
    const outRows = [...groups.entries()].map(([key, rows]) => {
      const out = { [groupColumn]: key };
      aggNames.forEach((name) => (out[name] = aggregations[name](rows)));
      return out;
    });
    return new Table([groupColumn, ...aggNames], outRows);
  }

  toRows() {
    return this.rows.map((row) => {
      const out = {};
      this.columns.forEach((c) => (out[c] = row[c] ?? ''));
      return out;
    });
  }
}

module.exports = { Table };
