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

  const MAX_PREVIEW_ROWS = 500;

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.add('show');
  }
  function clearError() {
    errorBanner.classList.remove('show');
  }

  function render(data) {
    status.innerHTML = `<strong>${data.fileBase}</strong> — ${data.rowCount} rows, ${data.columns.length} columns`;
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

    const rows = data.rows.slice(0, MAX_PREVIEW_ROWS);
    const head = `<tr><th class="rownum-col">#</th>${data.columns
      .map((c) => `<th>${escapeHtml(c)}</th>`)
      .join('')}</tr>`;
    const body = rows
      .map(
        (row, i) =>
          `<tr><td class="rownum-col">${i + 1}</td>${data.columns
            .map((c) => `<td>${escapeHtml(row[c])}</td>`)
            .join('')}</tr>`
      )
      .join('');

    const truncNote =
      data.rowCount > MAX_PREVIEW_ROWS
        ? `<div class="log-entry" style="margin:8px;">Showing first ${MAX_PREVIEW_ROWS} of ${data.rowCount} rows — download to see the rest.</div>`
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
    } catch (err) {
      showError(err.message);
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
      } else if (op === 'dedupe') {
        body = { column: document.getElementById('dd-column').value.trim() };
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
})();
