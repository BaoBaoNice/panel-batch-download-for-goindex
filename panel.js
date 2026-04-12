/* panel.js - GoIndex Batch Download Panel with Queue
 * - Better file discovery
 * - Waits for delayed DOM rendering
 * - Real queue download
 * - Default concurrency: 2
 * - Button label: Download Selected
 */
(function () {
  'use strict';

  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }

  function fmtBytes(n) {
    if (!isFinite(n) || n <= 0) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(n) / Math.log(1024));
    i = Math.max(0, Math.min(i, u.length - 1));
    var v = n / Math.pow(1024, i);
    return (v >= 100 || i === 0 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + u[i];
  }

  function fmtPct(done, total) {
    if (!total || total <= 0) return '...';
    var pct = Math.floor((done / total) * 100);
    pct = Math.max(0, Math.min(100, pct));
    return pct + '%';
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function sanitizeFileName(name) {
    name = String(name || 'download');
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim() || 'download';
  }

  function cssEscape(str) {
    return String(str).replace(/[^a-zA-Z0-9\-_:.]/g, '_');
  }

  function basePath() {
    return location.origin + location.pathname.replace(/\/+$/, '') + '/';
  }

  function logLine(msg) {
    var box = $('#gidx-debug');
    if (!box) return;
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    var ss = String(now.getSeconds()).padStart(2, '0');
    box.textContent += '\n[' + hh + ':' + mm + ':' + ss + '] ' + msg;
    box.scrollTop = box.scrollHeight;
    try { console.log('[gidx]', msg); } catch (e) {}
  }

  function joinURL(base, name, encoded) {
    return base + (encoded ? encodeURIComponent(String(name)) : String(name));
  }

  function guessNameFromUrl(url) {
    return safe(function () {
      var u = new URL(url, location.href);
      var raw = u.pathname.split('/').pop() || 'download';
      return sanitizeFileName(decodeURIComponent(raw));
    }, 'download');
  }

  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    var href = URL.createObjectURL(blob);
    a.href = href;
    a.download = sanitizeFileName(name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(href);
    }, 30000);
  }

  var C = {
    bg: '#2b2f36',
    bgSoft: '#323843',
    bgSoft2: '#262b33',
    border: '#3a404a',
    shadow: '0 6px 28px rgba(0,0,0,0.35)',
    text: '#e5e7eb',
    textDim: '#cbd5e1',
    muted: '#94a3b8',
    btnBg: '#3a404a',
    btnBgHover: '#475066',
    btnBorder: '#556070',
    chipBg: '#1f242d',
    debugBg: '#1e232b',
    green: '#22c55e',
    yellow: '#f59e0b',
    red: '#ef4444',
    blue: '#38bdf8',
    gray: '#64748b'
  };

  var STORE = {
    minKey: 'gidx_minimized',
    encodedKey: 'gidx_use_encoded',
    concKey: 'gidx_concurrency'
  };

  function getConcurrency() {
    var v = parseInt(localStorage.getItem(STORE.concKey) || '2', 10);
    if (!isFinite(v) || v < 1) v = 2;
    if (v > 8) v = 8;
    return v;
  }

  var queue = [];
  var jobsById = Object.create(null);
  var activeCount = 0;
  var isPumpRunning = false;
  var nextJobId = 1;
  var __gidxObserverBound = false;

  function makeJob(name, url) {
    return {
      id: String(nextJobId++),
      name: name,
      url: url,
      state: 'waiting',
      loaded: 0,
      total: 0,
      error: '',
      controller: null,
      addedAt: Date.now(),
      startedAt: 0,
      finishedAt: 0
    };
  }

  function stateColor(state) {
    if (state === 'done') return C.green;
    if (state === 'downloading') return C.blue;
    if (state === 'waiting') return C.yellow;
    if (state === 'error') return C.red;
    if (state === 'canceled') return C.gray;
    return C.muted;
  }

  function stateText(job) {
    switch (job.state) {
      case 'waiting': return 'Waiting';
      case 'downloading':
        if (job.total > 0) return 'Downloading ' + fmtPct(job.loaded, job.total);
        if (job.loaded > 0) return 'Downloading ' + fmtBytes(job.loaded);
        return 'Downloading';
      case 'done': return 'Done';
      case 'error': return 'Error';
      case 'canceled': return 'Canceled';
      default: return job.state || 'Unknown';
    }
  }

  function mkBtn(text) {
    var b = document.createElement('button');
    b.textContent = text;
    b.style.padding = '6px 10px';
    b.style.borderRadius = '10px';
    b.style.border = '1px solid ' + C.btnBorder;
    b.style.background = C.btnBg;
    b.style.color = C.text;
    b.style.cursor = 'pointer';
    b.style.transition = '.15s';
    b.style.fontWeight = '500';
    b.onmouseenter = function () { b.style.background = C.btnBgHover; };
    b.onmouseleave = function () { b.style.background = C.btnBg; };
    return b;
  }

  function mkChip(text) {
    var el = document.createElement('span');
    el.textContent = text;
    el.style.display = 'inline-block';
    el.style.padding = '2px 8px';
    el.style.borderRadius = '999px';
    el.style.background = C.chipBg;
    el.style.color = C.textDim;
    el.style.fontSize = '12px';
    return el;
  }

  function ensurePanel() {
    var wrap = $('#gidx-panel');
    if (wrap) return wrap;

    wrap = document.createElement('div');
    wrap.id = 'gidx-panel';
    wrap.style.position = 'fixed';
    wrap.style.right = '16px';
    wrap.style.bottom = '16px';
    wrap.style.zIndex = '2147483647';
    wrap.style.width = 'min(560px, 95vw)';
    wrap.style.maxHeight = '80vh';
    wrap.style.overflow = 'hidden';
    wrap.style.background = C.bg;
    wrap.style.border = '1px solid ' + C.border;
    wrap.style.borderRadius = '14px';
    wrap.style.boxShadow = C.shadow;
    wrap.style.font = '14px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
    wrap.style.color = C.text;
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';

    var header = document.createElement('div');
    header.style.display = 'flex';
    header.style.flexWrap = 'wrap';
    header.style.gap = '8px';
    header.style.padding = '10px';
    header.style.borderBottom = '1px solid ' + C.border;
    header.style.background = C.bg;

    var btnSelectAll = mkBtn('Select all');
    var btnUnselect = mkBtn('Unselect');
    var btnDownload = mkBtn('Download Selected');
    var btnExport = mkBtn('Export list');
    var btnReload = mkBtn('Reload');
    var btnRetryFailed = mkBtn('Retry failed');
    var btnClearDone = mkBtn('Clear done');
    var btnToggle = mkBtn('▾');

    btnToggle.title = 'Collapse / Expand';
    btnToggle.style.marginLeft = 'auto';
    btnToggle.style.width = '36px';
    btnToggle.style.textAlign = 'center';
    btnToggle.style.padding = '6px 0';

    var status = document.createElement('div');
    status.id = 'gidx-status';
    status.style.width = '100%';
    status.style.fontSize = '12px';
    status.style.color = C.textDim;
    status.textContent = 'Loading…';

    header.appendChild(btnSelectAll);
    header.appendChild(btnUnselect);
    header.appendChild(btnDownload);
    header.appendChild(btnExport);
    header.appendChild(btnReload);
    header.appendChild(btnRetryFailed);
    header.appendChild(btnClearDone);
    header.appendChild(btnToggle);
    header.appendChild(status);

    var opts = document.createElement('div');
    opts.style.display = 'flex';
    opts.style.flexWrap = 'wrap';
    opts.style.gap = '16px';
    opts.style.alignItems = 'center';
    opts.style.padding = '8px 10px';
    opts.style.borderBottom = '1px solid ' + C.border;
    opts.style.background = C.bgSoft;

    var encWrap = document.createElement('label');
    encWrap.style.display = 'inline-flex';
    encWrap.style.alignItems = 'center';
    encWrap.style.gap = '6px';
    var encCb = document.createElement('input');
    encCb.type = 'checkbox';
    encCb.checked = localStorage.getItem(STORE.encodedKey) === '1';
    var encTxt = document.createElement('span');
    encTxt.textContent = 'Use encoded URL';
    encTxt.style.color = C.textDim;
    encWrap.appendChild(encCb);
    encWrap.appendChild(encTxt);

    var concWrap = document.createElement('label');
    concWrap.style.display = 'inline-flex';
    concWrap.style.alignItems = 'center';
    concWrap.style.gap = '6px';
    var concTxt = document.createElement('span');
    concTxt.textContent = 'Concurrent';
    concTxt.style.color = C.textDim;
    var concInput = document.createElement('input');
    concInput.type = 'number';
    concInput.min = '1';
    concInput.max = '8';
    concInput.step = '1';
    concInput.value = String(getConcurrency());
    concInput.style.width = '56px';
    concInput.style.padding = '4px 6px';
    concInput.style.borderRadius = '8px';
    concInput.style.border = '1px solid ' + C.btnBorder;
    concInput.style.background = C.bgSoft2;
    concInput.style.color = C.text;
    concWrap.appendChild(concTxt);
    concWrap.appendChild(concInput);

    var stats = document.createElement('div');
    stats.style.display = 'inline-flex';
    stats.style.alignItems = 'center';
    stats.style.gap = '8px';
    stats.appendChild(mkChip('Queue'));
    var queueSummary = document.createElement('span');
    queueSummary.id = 'gidx-queue-summary';
    queueSummary.style.fontSize = '12px';
    queueSummary.style.color = C.textDim;
    queueSummary.textContent = '0 waiting | 0 active | 0 done';
    stats.appendChild(queueSummary);

    opts.appendChild(encWrap);
    opts.appendChild(concWrap);
    opts.appendChild(stats);

    var body = document.createElement('div');
    body.id = 'gidx-body';
    body.style.display = 'grid';
    body.style.gridTemplateColumns = 'minmax(220px, 1fr) minmax(260px, 1fr)';
    body.style.minHeight = '260px';
    body.style.maxHeight = '42vh';

    var filePane = document.createElement('div');
    filePane.style.borderRight = '1px solid ' + C.border;
    filePane.style.display = 'flex';
    filePane.style.flexDirection = 'column';
    filePane.style.minWidth = '0';

    var fileHead = document.createElement('div');
    fileHead.textContent = 'Files';
    fileHead.style.padding = '8px 10px';
    fileHead.style.borderBottom = '1px solid ' + C.border;
    fileHead.style.background = C.bgSoft2;
    fileHead.style.fontWeight = '600';

    var fileList = document.createElement('div');
    fileList.id = 'gidx-list';
    fileList.style.overflow = 'auto';
    fileList.style.padding = '8px 10px';
    fileList.style.display = 'grid';
    fileList.style.gridTemplateColumns = '24px 1fr';
    fileList.style.alignItems = 'center';
    fileList.style.rowGap = '6px';
    fileList.style.minWidth = '0';

    filePane.appendChild(fileHead);
    filePane.appendChild(fileList);

    var queuePane = document.createElement('div');
    queuePane.style.display = 'flex';
    queuePane.style.flexDirection = 'column';
    queuePane.style.minWidth = '0';

    var queueHead = document.createElement('div');
    queueHead.textContent = 'Queue';
    queueHead.style.padding = '8px 10px';
    queueHead.style.borderBottom = '1px solid ' + C.border;
    queueHead.style.background = C.bgSoft2;
    queueHead.style.fontWeight = '600';

    var queueList = document.createElement('div');
    queueList.id = 'gidx-queue';
    queueList.style.overflow = 'auto';
    queueList.style.padding = '8px 10px';
    queueList.style.display = 'flex';
    queueList.style.flexDirection = 'column';
    queueList.style.gap = '8px';
    queueList.style.minWidth = '0';

    queuePane.appendChild(queueHead);
    queuePane.appendChild(queueList);

    body.appendChild(filePane);
    body.appendChild(queuePane);

    var debugBox = document.createElement('pre');
    debugBox.id = 'gidx-debug';
    debugBox.style.margin = '0';
    debugBox.style.padding = '8px 10px';
    debugBox.style.borderTop = '1px solid ' + C.border;
    debugBox.style.background = C.debugBg;
    debugBox.style.color = C.textDim;
    debugBox.style.maxHeight = '18vh';
    debugBox.style.overflow = 'auto';
    debugBox.style.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    debugBox.textContent = 'Debug log ready.';

    wrap.appendChild(header);
    wrap.appendChild(opts);
    wrap.appendChild(body);
    wrap.appendChild(debugBox);
    document.body.appendChild(wrap);

    function getSelectedItems() {
      return $all('input.gidx-cb:checked', fileList).map(function (cb) {
        return {
          name: cb.dataset.name,
          url: cb.dataset.url
        };
      });
    }

    function updateFileStatus() {
      var total = $all('input.gidx-cb', fileList).length;
      var sel = $all('input.gidx-cb:checked', fileList).length;
      var waiting = queue.filter(function (j) { return j.state === 'waiting'; }).length;
      var downloading = queue.filter(function (j) { return j.state === 'downloading'; }).length;
      var done = queue.filter(function (j) { return j.state === 'done'; }).length;
      var failed = queue.filter(function (j) { return j.state === 'error'; }).length;
      var canceled = queue.filter(function (j) { return j.state === 'canceled'; }).length;

      status.textContent =
        sel + '/' + total + ' selected | ' +
        waiting + ' waiting | ' +
        downloading + ' downloading | ' +
        done + ' done | ' +
        failed + ' failed | ' +
        canceled + ' canceled';

      queueSummary.textContent =
        waiting + ' waiting | ' +
        downloading + ' active | ' +
        done + ' done';
    }

    function applyMinimized(min) {
      var isMin = !!min;
      opts.style.display = isMin ? 'none' : 'flex';
      body.style.display = isMin ? 'none' : 'grid';
      debugBox.style.display = isMin ? 'none' : 'block';
      btnToggle.textContent = isMin ? '▸' : '▾';
      localStorage.setItem(STORE.minKey, isMin ? '1' : '0');
    }

    btnToggle.onclick = function () {
      var cur = localStorage.getItem(STORE.minKey) === '1';
      applyMinimized(!cur);
    };

    btnSelectAll.onclick = function () {
      $all('input.gidx-cb', fileList).forEach(function (cb) { cb.checked = true; });
      updateFileStatus();
    };

    btnUnselect.onclick = function () {
      $all('input.gidx-cb', fileList).forEach(function (cb) { cb.checked = false; });
      updateFileStatus();
    };

    btnExport.onclick = function () {
      var items = getSelectedItems();
      if (!items.length) return alert('Chưa chọn file nào.');
      var lines = items.map(function (x) { return x.url; });
      var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
      downloadBlob(blob, 'list.txt');
    };

    btnDownload.onclick = function () {
      var items = getSelectedItems();
      if (!items.length) return alert('Chưa chọn file nào.');

      var added = 0;
      items.forEach(function (it) {
        var dedupeKey = it.url;
        var old = jobsById[dedupeKey];
        if (old && (old.state === 'waiting' || old.state === 'downloading')) return;
        var job = makeJob(it.name || guessNameFromUrl(it.url), it.url);
        jobsById[dedupeKey] = job;
        queue.push(job);
        renderOrUpdateJob(job);
        added++;
      });

      updateFileStatus();
      logLine('Queued ' + added + ' item(s).');
      pumpQueue();
    };

    btnRetryFailed.onclick = function () {
      var count = 0;
      queue.forEach(function (job) {
        if (job.state === 'error' || job.state === 'canceled') {
          job.state = 'waiting';
          job.loaded = 0;
          job.total = 0;
          job.error = '';
          job.finishedAt = 0;
          renderOrUpdateJob(job);
          count++;
        }
      });
      updateFileStatus();
      logLine('Retry ' + count + ' item(s).');
      pumpQueue();
    };

    btnClearDone.onclick = function () {
      var kept = [];
      queue.forEach(function (job) {
        if (job.state === 'done') {
          var row = $('#gidx-job-' + cssEscape(job.id));
          if (row) row.remove();
          delete jobsById[job.url];
        } else {
          kept.push(job);
        }
      });
      queue = kept;
      updateFileStatus();
      logLine('Cleared done items.');
    };

    btnReload.onclick = function () {
      init(true);
    };

    encCb.onchange = function () {
      localStorage.setItem(STORE.encodedKey, encCb.checked ? '1' : '0');
      logLine('Use encoded URL = ' + (encCb.checked ? 'ON' : 'OFF'));
      init(true);
    };

    concInput.onchange = function () {
      var v = parseInt(concInput.value || '2', 10);
      if (!isFinite(v) || v < 1) v = 2;
      if (v > 8) v = 8;
      concInput.value = String(v);
      localStorage.setItem(STORE.concKey, String(v));
      updateFileStatus();
      logLine('Concurrency = ' + v);
      pumpQueue();
    };

    applyMinimized(localStorage.getItem(STORE.minKey) === '1');

    wrap.__fileList = fileList;
    wrap.__queueList = queueList;
    wrap.__setStatus = function (t) { status.textContent = t; };
    wrap.__clearFiles = function () { fileList.innerHTML = ''; };
    wrap.__updateFileStatus = updateFileStatus;
    wrap.__useEncoded = function () { return !!encCb.checked; };
    wrap.__concurrency = function () { return getConcurrency(); };
    wrap.__addFile = function (name, url) {
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'gidx-cb';
      cb.dataset.url = url;
      cb.dataset.name = name;
      cb.onchange = updateFileStatus;

      var label = document.createElement('label');
      label.textContent = name;
      label.title = name;
      label.style.userSelect = 'none';
      label.style.whiteSpace = 'nowrap';
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      label.style.minWidth = '0';

      fileList.appendChild(cb);
      fileList.appendChild(label);
    };

    return wrap;
  }

  function renderOrUpdateJob(job) {
    var panel = ensurePanel();
    var queueList = panel.__queueList;
    var id = 'gidx-job-' + cssEscape(job.id);
    var row = $('#' + id);

    if (!row) {
      row = document.createElement('div');
      row.id = id;
      row.style.border = '1px solid ' + C.border;
      row.style.borderRadius = '12px';
      row.style.padding = '8px';
      row.style.background = C.bgSoft2;
      row.style.display = 'grid';
      row.style.gap = '6px';

      var top = document.createElement('div');
      top.style.display = 'flex';
      top.style.alignItems = 'center';
      top.style.gap = '8px';
      top.style.minWidth = '0';

      var name = document.createElement('div');
      name.className = 'gidx-job-name';
      name.style.flex = '1';
      name.style.whiteSpace = 'nowrap';
      name.style.overflow = 'hidden';
      name.style.textOverflow = 'ellipsis';
      name.style.fontWeight = '600';

      var badge = document.createElement('span');
      badge.className = 'gidx-job-badge';
      badge.style.fontSize = '12px';
      badge.style.padding = '2px 8px';
      badge.style.borderRadius = '999px';
      badge.style.background = C.chipBg;

      top.appendChild(name);
      top.appendChild(badge);

      var meta = document.createElement('div');
      meta.className = 'gidx-job-meta';
      meta.style.fontSize = '12px';
      meta.style.color = C.textDim;

      var barWrap = document.createElement('div');
      barWrap.style.height = '8px';
      barWrap.style.borderRadius = '999px';
      barWrap.style.background = '#1a1f27';
      barWrap.style.overflow = 'hidden';

      var bar = document.createElement('div');
      bar.className = 'gidx-job-bar';
      bar.style.height = '100%';
      bar.style.width = '0%';
      bar.style.background = C.blue;
      bar.style.transition = 'width .15s linear';

      barWrap.appendChild(bar);

      var actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';

      var btnCancel = mkBtn('Cancel');
      btnCancel.className = 'gidx-job-cancel';
      btnCancel.style.padding = '4px 8px';

      var btnRemove = mkBtn('Remove');
      btnRemove.className = 'gidx-job-remove';
      btnRemove.style.padding = '4px 8px';

      actions.appendChild(btnCancel);
      actions.appendChild(btnRemove);

      row.appendChild(top);
      row.appendChild(meta);
      row.appendChild(barWrap);
      row.appendChild(actions);
      queueList.appendChild(row);

      btnCancel.onclick = function () {
        if (job.state === 'waiting') {
          job.state = 'canceled';
          job.finishedAt = Date.now();
          renderOrUpdateJob(job);
          ensurePanel().__updateFileStatus();
          logLine('Canceled waiting: ' + job.name);
          return;
        }
        if (job.state === 'downloading' && job.controller) {
          job.controller.abort();
          return;
        }
      };

      btnRemove.onclick = function () {
        if (job.state === 'downloading') {
          alert('File này đang tải. Hãy Cancel trước.');
          return;
        }
        delete jobsById[job.url];
        queue = queue.filter(function (x) { return x.id !== job.id; });
        row.remove();
        ensurePanel().__updateFileStatus();
      };
    }

    $('.gidx-job-name', row).textContent = truncate(job.name, 80);

    var badge = $('.gidx-job-badge', row);
    badge.textContent = stateText(job);
    badge.style.color = stateColor(job.state);

    var meta = $('.gidx-job-meta', row);
    if (job.state === 'downloading') {
      if (job.total > 0) {
        meta.textContent = fmtBytes(job.loaded) + ' / ' + fmtBytes(job.total);
      } else {
        meta.textContent = fmtBytes(job.loaded) + ' downloaded';
      }
    } else if (job.state === 'error') {
      meta.textContent = job.error || 'Unknown error';
    } else if (job.state === 'done') {
      meta.textContent = job.total > 0 ? fmtBytes(job.total) : 'Completed';
    } else {
      meta.textContent = job.total > 0 ? fmtBytes(job.total) : '';
    }

    var bar = $('.gidx-job-bar', row);
    if (job.state === 'done') {
      bar.style.width = '100%';
      bar.style.background = C.green;
    } else if (job.state === 'error') {
      bar.style.background = C.red;
      bar.style.width = (job.total > 0 ? Math.max(2, Math.floor((job.loaded / job.total) * 100)) : 100) + '%';
    } else if (job.state === 'canceled') {
      bar.style.background = C.gray;
      bar.style.width = (job.total > 0 ? Math.max(2, Math.floor((job.loaded / job.total) * 100)) : 20) + '%';
    } else if (job.state === 'downloading') {
      bar.style.background = C.blue;
      bar.style.width = (job.total > 0 ? Math.max(2, Math.floor((job.loaded / job.total) * 100)) : 35) + '%';
    } else {
      bar.style.background = C.yellow;
      bar.style.width = '2%';
    }

    var btnCancel = $('.gidx-job-cancel', row);
    btnCancel.disabled = !(job.state === 'waiting' || job.state === 'downloading');
    btnCancel.style.opacity = btnCancel.disabled ? '0.5' : '1';
  }

  async function runJob(job) {
    job.state = 'downloading';
    job.startedAt = Date.now();
    job.error = '';
    job.loaded = 0;
    job.total = 0;
    job.controller = new AbortController();
    renderOrUpdateJob(job);
    ensurePanel().__updateFileStatus();

    logLine('Start: ' + job.name);

    try {
      var res = await fetch(job.url, {
        method: 'GET',
        credentials: 'same-origin',
        signal: job.controller.signal
      });

      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }

      var len = parseInt(res.headers.get('content-length') || '0', 10);
      if (isFinite(len) && len > 0) job.total = len;

      var cd = res.headers.get('content-disposition') || '';
      var fileName = job.name;

      var matchUtf8 = /filename\*=UTF-8''([^;]+)/i.exec(cd);
      var matchPlain = /filename="?([^"]+)"?/i.exec(cd);
      if (matchUtf8 && matchUtf8[1]) {
        fileName = sanitizeFileName(decodeURIComponent(matchUtf8[1]));
      } else if (matchPlain && matchPlain[1]) {
        fileName = sanitizeFileName(matchPlain[1]);
      }

      if (!res.body || !res.body.getReader) {
        var fallbackBlob = await res.blob();
        job.loaded = fallbackBlob.size || job.total || 0;
        job.total = fallbackBlob.size || job.total || 0;
        renderOrUpdateJob(job);
        downloadBlob(fallbackBlob, fileName);
        job.state = 'done';
        job.finishedAt = Date.now();
        renderOrUpdateJob(job);
        ensurePanel().__updateFileStatus();
        logLine('Done: ' + job.name);
        return;
      }

      var reader = res.body.getReader();
      var chunks = [];
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        chunks.push(part.value);
        job.loaded += part.value.byteLength || 0;
        renderOrUpdateJob(job);
      }

      var blob = new Blob(chunks);
      if (!job.total && blob.size) job.total = blob.size;
      downloadBlob(blob, fileName);

      job.state = 'done';
      job.finishedAt = Date.now();
      renderOrUpdateJob(job);
      ensurePanel().__updateFileStatus();
      logLine('Done: ' + job.name);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        job.state = 'canceled';
        job.error = 'Canceled by user';
        logLine('Canceled: ' + job.name);
      } else {
        job.state = 'error';
        job.error = (err && err.message) ? err.message : String(err);
        logLine('Error: ' + job.name + ' -> ' + job.error);
      }
      job.finishedAt = Date.now();
      renderOrUpdateJob(job);
      ensurePanel().__updateFileStatus();
    } finally {
      job.controller = null;
    }
  }

  async function pumpQueue() {
    if (isPumpRunning) return;
    isPumpRunning = true;

    try {
      while (true) {
        var limit = getConcurrency();

        while (activeCount < limit) {
          var next = queue.find(function (j) { return j.state === 'waiting'; });
          if (!next) break;

          activeCount++;
          (function (job) {
            runJob(job)
              .catch(function (e) {
                logLine('Unexpected error: ' + ((e && e.message) || String(e)));
              })
              .finally(function () {
                activeCount--;
                ensurePanel().__updateFileStatus();
                pumpQueue();
              });
          })(next);
        }

        var hasWaiting = queue.some(function (j) { return j.state === 'waiting'; });
        var hasDownloading = queue.some(function (j) { return j.state === 'downloading'; });

        ensurePanel().__updateFileStatus();

        if (!hasWaiting && !hasDownloading) break;
        await sleep(250);
      }
    } finally {
      isPumpRunning = false;
    }
  }

  function looksLikeFileName(name) {
    if (!name || typeof name !== 'string') return false;
    var raw = name.trim();
    if (!raw) return false;
    if (raw === '..' || raw.toLowerCase() === 'parent') return false;

    if (/^(select all|unselect|download selected|queue selected|export list|reload|retry failed|clear done|files|queue)$/i.test(raw)) {
      return false;
    }

    if (/\.[a-z0-9]{1,16}$/i.test(raw)) return true;
    if (!/[\/\\]/.test(raw) && raw.length > 1 && raw.length < 260) return true;

    return false;
  }

  function normalizeItemsFromAnyJSON(data) {
    var out = [];

    function pushItem(name, isFolder) {
      if (!name) return;
      name = String(name).trim();
      if (!name || name === '.' || name === '..') return;
      out.push({ name: name, isFolder: !!isFolder });
    }

    function walk(node, depth) {
      if (!node || depth > 4) return;

      if (Array.isArray(node)) {
        node.forEach(function (it) {
          if (!it) return;

          if (typeof it === 'string') {
            pushItem(it, false);
            return;
          }

          if (typeof it === 'object') {
            var name = it.name || it.filename || it.title || it.path;
            var isFolder = !!(it.is_dir || it.isdir || it.isDirectory || it.type === 'folder' || it.mimeType === 'application/vnd.google-apps.folder');
            if (name) pushItem(name, isFolder);
          }
        });
        return;
      }

      if (typeof node === 'object') {
        ['files', 'data', 'items', 'children', 'list', 'objs'].forEach(function (k) {
          if (node[k]) walk(node[k], depth + 1);
        });
      }
    }

    walk(data, 0);

    var seen = Object.create(null);
    return out.filter(function (it) {
      var key = it.name + '|' + (it.isFolder ? 'd' : 'f');
      if (seen[key]) return false;
      seen[key] = 1;
      return true;
    });
  }

  async function fetchJSONListing() {
    var base = basePath();
    var trials = [
      location.href + (location.search ? '&' : '?') + 'json',
      base + '?json',
      location.href + (location.search ? '&' : '?') + 'a=ls',
      base + '?a=ls',
      location.href + (location.search ? '&' : '?') + 'ajax=1',
      base + '?ajax=1',
      location.href + (location.search ? '&' : '?') + 'format=json',
      base + '?format=json'
    ];

    var tried = Object.create(null);

    for (var i = 0; i < trials.length; i++) {
      var url = trials[i];
      if (tried[url]) continue;
      tried[url] = 1;

      try {
        logLine('Try JSON: ' + url);
        var res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) continue;
        var ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.indexOf('json') === -1) continue;

        var data = await res.json();
        var items = normalizeItemsFromAnyJSON(data).filter(function (it) {
          return !it.isFolder && looksLikeFileName(it.name);
        });

        if (items.length) {
          logLine('JSON listing ok: ' + items.length + ' file(s)');
          return { base: base, items: items };
        }
      } catch (e) {
        logLine('JSON error: ' + ((e && e.message) || String(e)));
      }
    }

    return null;
  }

  function scrapeDOMAnchors() {
    var out = [];
    var seen = Object.create(null);

    function addItem(name, url) {
      name = String(name || '').trim();
      url = String(url || '').trim();
      if (!name || !url) return;
      if (!looksLikeFileName(name)) return;
      if (seen[url]) return;
      seen[url] = 1;
      out.push({ name: name, url: url });
    }

    function filenameFromHref(href) {
      try {
        var u = new URL(href, location.href);
        var p = u.pathname || '';
        var seg = p.split('/').filter(Boolean).pop() || '';
        seg = decodeURIComponent(seg);

        if (!seg) return '';
        if (seg === '0:' || seg === '1:' || /^index\.(html?|php)$/i.test(seg)) return '';
        return seg;
      } catch (e) {
        return '';
      }
    }

    function normalizeUrl(href) {
      try {
        return new URL(href, location.href).href;
      } catch (e) {
        return '';
      }
    }

    $all('a[href]').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (!href) return;
      if (href.startsWith('#')) return;
      if (/^(javascript:|mailto:)/i.test(href)) return;

      var url = normalizeUrl(href);
      if (!url) return;
      if (url.indexOf(location.origin) !== 0) return;

      var text = (a.textContent || '').trim();
      var name = '';

      if (looksLikeFileName(text)) {
        name = text;
      } else {
        name = filenameFromHref(url);
      }

      if (/\/$/.test(href)) return;
      if (!name) return;

      addItem(name, url);
    });

    $all('[data-href], [data-url], [onclick]').forEach(function (el) {
      var href = el.getAttribute('data-href') || el.getAttribute('data-url') || '';
      var onclick = el.getAttribute('onclick') || '';
      var m = onclick.match(/['"]([^'"]+)['"]/);

      if (!href && m) href = m[1];
      if (!href) return;
      if (/^(javascript:|mailto:|#)/i.test(href)) return;

      var url = normalizeUrl(href);
      if (!url) return;
      if (url.indexOf(location.origin) !== 0) return;

      var text = (el.textContent || '').trim();
      var name = looksLikeFileName(text) ? text : filenameFromHref(url);
      if (!name) return;

      addItem(name, url);
    });

    out = out.filter(function (it) {
      var name = (it.name || '').trim();
      if (!name) return false;
      if (name === '..') return false;
      if (/^(favicon\.ico)$/i.test(name)) return false;
      if (/^(workers\.dev|googleusercontent\.com)$/i.test(name)) return false;
      return true;
    });

    logLine('DOM anchors/items: ' + out.length + ' file(s)');
    return out.length ? out : null;
  }

  async function discoverFiles() {
    var panel = ensurePanel();
    var encoded = panel.__useEncoded();

    var json = await fetchJSONListing();
    if (json && json.items && json.items.length) {
      return json.items.map(function (it) {
        return {
          name: it.name,
          url: joinURL(json.base, it.name, encoded)
        };
      });
    }

    for (var i = 0; i < 8; i++) {
      var dom = scrapeDOMAnchors();
      if (dom && dom.length) return dom;
      await sleep(500);
    }

    return [];
  }

  async function init(force) {
    var panel = ensurePanel();
    panel.__clearFiles();
    panel.__setStatus('Scanning files…');

    if (force) {
      logLine('Reload requested.');
    }

    try {
      var files = await discoverFiles();

      if (!files.length) {
        panel.__setStatus('Chưa quét được file. Đang chờ trang render...');
        logLine('No files found. Waiting for DOM changes...');

        if (!__gidxObserverBound) {
          __gidxObserverBound = true;

          var timer = null;
          var observer = new MutationObserver(function () {
            clearTimeout(timer);
            timer = setTimeout(async function () {
              var p = ensurePanel();

              if ($all('input.gidx-cb', p.__fileList).length > 0) return;

              var retryFiles = await discoverFiles();
              if (!retryFiles.length) return;

              p.__clearFiles();
              retryFiles.sort(function (a, b) {
                return String(a.name).localeCompare(String(b.name), undefined, {
                  numeric: true,
                  sensitivity: 'base'
                });
              });

              retryFiles.forEach(function (f) {
                p.__addFile(f.name, f.url);
              });

              p.__updateFileStatus();
              p.__setStatus('Đã quét được ' + retryFiles.length + ' file(s).');
              logLine('Observer loaded ' + retryFiles.length + ' file(s).');
            }, 400);
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true
          });
        }

        return;
      }

      files.sort(function (a, b) {
        return String(a.name).localeCompare(String(b.name), undefined, {
          numeric: true,
          sensitivity: 'base'
        });
      });

      files.forEach(function (f) {
        panel.__addFile(f.name, f.url);
      });

      panel.__updateFileStatus();
      panel.__setStatus('Đã quét được ' + files.length + ' file(s).');
      logLine('Loaded ' + files.length + ' file(s).');
    } catch (e) {
      panel.__setStatus('Lỗi khi load danh sách file.');
      logLine('Init error: ' + ((e && e.message) || String(e)));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      ensurePanel();
      init(false);
    });
  } else {
    ensurePanel();
    init(false);
  }
})();
