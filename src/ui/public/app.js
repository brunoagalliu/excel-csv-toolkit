(() => {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const status = document.getElementById('status');
  const tableWrap = document.getElementById('tableWrap');
  const log = document.getElementById('log');
  const errorBanner = document.getElementById('errorBanner');
  const resetBtn = document.getElementById('resetBtn');
  const downloadCsvBtn = document.getElementById('downloadCsvBtn');
  const downloadXlsxBtn = document.getElementById('downloadXlsxBtn');

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.add('show');
  }
  function clearError() {
    errorBanner.classList.remove('show');
  }

  function render(data) {
    status.innerHTML =
      data.rowCount !== data.originalRowCount
        ? `<strong>${data.rowCount} of ${data.originalRowCount}</strong> rows kept — ${data.fileBase}, ${data.columns.length} columns`
        : `<strong>${data.fileBase}</strong> — ${data.rowCount} rows, ${data.columns.length} columns`;
    resetBtn.disabled = false;
    downloadCsvBtn.disabled = false;
    downloadXlsxBtn.disabled = false;

    log.innerHTML = data.log
      .map((entry) => `<div class="log-entry">${escapeHtml(entry)}</div>`)
      .join('');
    log.scrollTop = log.scrollHeight;

    if (data.rowCount === 0) {
      tableWrap.innerHTML = '<div class="empty-state">No rows left.</div>';
      return;
    }

    const head = `<tr><th class="rownum-col">#</th>${data.columns
      .map((c) => `<th>${escapeHtml(c)}</th>`)
      .join('')}</tr>`;
    const body = data.rows
      .map(
        (row, i) =>
          `<tr><td class="rownum-col">${i + 1}</td>${data.columns
            .map((c) => `<td>${escapeHtml(row[c])}</td>`)
            .join('')}</tr>`
      )
      .join('');

    const truncNote =
      data.rowCount > data.previewRows
        ? `<div class="log-entry" style="margin:8px;">Showing first ${data.previewRows} of ${data.rowCount} rows — download to see the rest.</div>`
        : '';

    tableWrap.innerHTML = `<table class="data"><thead>${head}</thead><tbody>${body}</tbody></table>${truncNote}`;
  }

  function displayValue(value) {
    if (value && typeof value === 'object' && 'formula' in value) return `=${value.formula}`;
    return String(value ?? '');
  }

  function escapeHtml(value) {
    return displayValue(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function callApi(url, body) {
    clearError();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed.');
      render(data);
      return data;
    } catch (err) {
      showError(err.message);
      return null;
    }
  }

  async function uploadFile(file) {
    clearError();
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      render(data);
    } catch (err) {
      showError(err.message);
    }
  }

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) uploadFile(fileInput.files[0]);
  });
  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });

  document.querySelectorAll('[data-op]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const op = btn.dataset.op;
      let body;
      if (op === 'add-column') {
        body = {
          name: document.getElementById('ac-name').value.trim(),
          defaultValue: document.getElementById('ac-default').value,
        };
      } else if (op === 'drop-column') {
        body = { name: document.getElementById('dc-name').value.trim() };
      } else if (op === 'delete-rows') {
        body = {
          column: document.getElementById('dr-column').value.trim(),
          operator: document.getElementById('dr-operator').value,
          value: document.getElementById('dr-value').value,
        };
      } else if (op === 'find-replace') {
        body = {
          column: document.getElementById('fr-column').value.trim(),
          pattern: document.getElementById('fr-pattern').value,
          replacement: document.getElementById('fr-replacement').value,
          useRegex: document.getElementById('fr-regex').checked,
        };
      } else if (op === 'sort') {
        body = {
          column: document.getElementById('sort-column').value.trim(),
          desc: document.getElementById('sort-desc').checked,
        };
      }
      callApi(`/api/op/${op}`, body);
    });
  });

  resetBtn.addEventListener('click', () => callApi('/api/reset', {}));
  downloadCsvBtn.addEventListener('click', () => {
    window.location.href = '/api/download?format=csv';
  });
  downloadXlsxBtn.addEventListener('click', () => {
    window.location.href = '/api/download?format=xlsx';
  });

  // ---- step 1: filter, step 2: keep unique ----

  const step1Result = document.getElementById('step1Result');
  const step2Result = document.getElementById('step2Result');

  function showStepResult(el, data) {
    if (!data) return;
    el.textContent = data.log[data.log.length - 1];
    el.classList.add('show');
  }

  document.getElementById('step1Apply').addEventListener('click', async () => {
    const column = document.getElementById('step1-column').value.trim();
    if (!column) return showError('Enter a column to filter on.');
    const data = await callApi('/api/op/keep-rows', {
      column,
      operator: document.getElementById('step1-operator').value,
      value: document.getElementById('step1-value').value,
    });
    showStepResult(step1Result, data);
  });

  document.getElementById('step2Apply').addEventListener('click', async () => {
    const data = await callApi('/api/op/dedupe', {
      column: document.getElementById('step2-column').value.trim(),
    });
    showStepResult(step2Result, data);
  });

  document.getElementById('step1-column').value = 'country';
  document.getElementById('step1-value').value = 'US';
  document.getElementById('step2-column').value = 'sub2';

  // ---- step 3: split into files ----

  const segmentRowsEl = document.getElementById('segmentRows');
  const segCountsEl = document.getElementById('segCounts');

  function addSegmentRow({ name = '', column = '', contains = '' } = {}) {
    const row = document.createElement('div');
    row.className = 'seg-row';
    row.dataset.role = 'segment';
    row.innerHTML = `
      <input type="text" class="sg-name" placeholder="sheet name, e.g. att" value="${escapeAttr(name)}">
      <div class="seg-line">
        <input type="text" class="sg-column" placeholder="column, e.g. campaign" value="${escapeAttr(column)}">
        <input type="text" class="sg-contains" placeholder="contains, e.g. _att" value="${escapeAttr(contains)}">
      </div>
      <button type="button" class="remove-row" aria-label="Remove segment">Remove ×</button>
    `;
    row.querySelector('.remove-row').addEventListener('click', () => row.remove());
    segmentRowsEl.appendChild(row);
  }

  function escapeAttr(value) {
    return String(value ?? '').replace(/"/g, '&quot;');
  }

  function collectKeepColumns() {
    return document
      .getElementById('segKeepColumns')
      .value.split(',')
      .map((c) => c.trim())
      .filter(Boolean);
  }

  function collectSegments() {
    return [...segmentRowsEl.querySelectorAll('[data-role="segment"]')].map((row) => ({
      name: row.querySelector('.sg-name').value.trim(),
      column: row.querySelector('.sg-column').value.trim(),
      contains: row.querySelector('.sg-contains').value.trim(),
    }));
  }

  // Seed with the att/vz/tmob carrier-segment workflow as a starting point.
  document.getElementById('segKeepColumns').value = 'sub2, sub4';
  addSegmentRow({ name: 'att', column: 'campaign', contains: '_att' });
  addSegmentRow({ name: 'vz', column: 'campaign', contains: '_vz' });
  addSegmentRow({ name: 'tmob', column: 'campaign', contains: '_tmob' });

  document.getElementById('addSegment').addEventListener('click', () => addSegmentRow());

  document.getElementById('previewSegmentsBtn').addEventListener('click', async () => {
    clearError();
    segCountsEl.innerHTML = '';
    try {
      const res = await fetch('/api/segment-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keepColumns: collectKeepColumns(),
          segments: collectSegments(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed.');
      segCountsEl.innerHTML = data.counts
        .map(
          (c) =>
            `<div class="log-entry seg-count-row"><span>${escapeHtml(c.name)}</span><span class="n">${c.rowCount} rows</span></div>`
        )
        .join('');
    } catch (err) {
      showError(err.message);
    }
  });

  document.getElementById('generateSegmentsBtn').addEventListener('click', async () => {
    clearError();
    try {
      const res = await fetch('/api/export-segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keepColumns: collectKeepColumns(),
          segments: collectSegments(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Export failed.');
      }
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = /filename="?([^"]+)"?/.exec(disposition);
      const filename = match ? match[1] : 'segments.xlsx';
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      showError(err.message);
    }
  });
})();
