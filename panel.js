/* panel.js – GoIndex Batch Download (no ZIP) */
(function(){
  /* ========== tiny utils ========== */
  function sleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
  function $(s, r){ return (r||document).querySelector(s); }
  function $all(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }
  function safe(fn){ try{ return fn(); }catch(e){ return undefined; } }
  function basePath(){ return location.origin + location.pathname.replace(/\/+$/,'') + '/'; }

  /* lọc tên hợp lệ (tránh rác như aswift_0, gB, …) */
  function looksLikeFileName(name){
    if (!name || typeof name !== 'string') return false;
    var raw = name.trim();
    if (!raw) return false;
    if (raw === '..' || raw.toLowerCase() === 'parent') return false;
    if (raw.length < 4) return false;
    if (/^(aswift|gB|fB|gf|fb|ads?|adserver|_.*)$/i.test(raw)) return false;
    return /\.[a-z0-9]{2,8}$/i.test(raw); /* có phần mở rộng */
  }

  /* ========== UI panel ========== */
  function ensurePanel(){
    var wrap = $('#gidx-panel'); if (wrap) return wrap;

    wrap = document.createElement('div');
    wrap.id = 'gidx-panel';
    wrap.style.position = 'fixed';
    wrap.style.right = '16px';
    wrap.style.bottom = '16px';
    wrap.style.zIndex = '2147483647';
    wrap.style.width = 'min(400px, 92vw)';
    wrap.style.maxHeight = '64vh';
    wrap.style.overflow = 'hidden';
    wrap.style.background = 'rgba(255,255,255,0.98)';
    wrap.style.border = '1px solid #e5e7eb';
    wrap.style.borderRadius = '14px';
    wrap.style.boxShadow = '0 6px 28px rgba(0,0,0,0.18)';
    wrap.style.font = '14px system-ui, -apple-system, Segoe UI, Roboto';
    wrap.style.color = '#111';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';

    var bar = document.createElement('div');
    bar.style.display = 'flex';
    bar.style.gap = '8px';
    bar.style.flexWrap = 'wrap';
    bar.style.padding = '10px';
    bar.style.borderBottom = '1px solid #eee';
    bar.style.position = 'sticky';
    bar.style.top = '0';
    bar.style.background = 'inherit';

    function mkBtn(txt){
      var b = document.createElement('button');
      b.textContent = txt;
      b.style.padding = '6px 10px';
      b.style.borderRadius = '10px';
      b.style.border = '1px solid #d1d5db';
      b.style.background = '#fff';
      b.style.color = '#111';
      b.style.cursor = 'pointer';
      b.style.transition = '.15s';
      b.style.fontWeight = '500';
      b.addEventListener('mouseenter', function(){ b.style.background = '#f3f4f6'; });
      b.addEventListener('mouseleave', function(){ b.style.background = '#fff'; });
      return b;
    }

    var btnSelectAll = mkBtn('Select all');
    var btnClear = mkBtn('Clear');
    var btnDownload = mkBtn('Download selected');
    var btnExport = mkBtn('Export aria2');
    var btnReload = mkBtn('Reload');
    var status = document.createElement('div');
    status.style.marginLeft = 'auto';
    status.style.alignSelf = 'center';
    status.style.fontSize = '12px';
    status.style.opacity = '0.9';
    status.textContent = '…';

    bar.appendChild(btnSelectAll);
    bar.appendChild(btnClear);
    bar.appendChild(btnDownload);
    bar.appendChild(btnExport);
    bar.appendChild(btnReload);
    bar.appendChild(status);

    var opts = document.createElement('div');
    opts.style.display = 'flex';
    opts.style.gap = '10px';
    opts.style.alignItems = 'center';
    opts.style.padding = '6px 10px';
    opts.style.borderBottom = '1px solid #eee';

    var encWrap = document.createElement('label');
    var encCb = document.createElement('input'); encCb.type='checkbox'; encCb.checked=false; encCb.style.marginRight='6px';
    encWrap.appendChild(encCb); encWrap.appendChild(document.createTextNode('Use encoded URL'));
    opts.appendChild(encWrap);

    var list = document.createElement('div');
    list.id = 'gidx-list';
    list.style.overflow = 'auto';
    list.style.padding = '8px 10px';
    list.style.display = 'grid';
    list.style.gridTemplateColumns = '24px 1fr';
    list.style.alignItems = 'center';
    list.style.rowGap = '6px';

    var debugBox = document.createElement('pre');
    debugBox.id = 'gidx-debug';
    debugBox.style.margin = '0';
    debugBox.style.padding = '8px 10px';
    debugBox.style.borderTop = '1px solid #eee';
    debugBox.style.background = '#fafafa';
    debugBox.style.color = '#111';
    debugBox.style.maxHeight = '20vh';
    debugBox.style.overflow = 'auto';
    debugBox.style.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    debugBox.textContent = 'Debug log will appear here…';

    wrap.appendChild(bar);
    wrap.appendChild(opts);
    wrap.appendChild(list);
    wrap.appendChild(debugBox);
    document.body.appendChild(wrap);

    function getSelectedLinks(){
      return $all('input.gidx-cb:checked', list).map(function(cb){ return cb.dataset.url; });
    }
    function updateStatus(){
      var total = $all('input.gidx-cb', list).length;
      var sel = $all('input.gidx-cb:checked', list).length;
      status.textContent = sel + '/' + total + ' selected';
    }

    btnSelectAll.onclick = function(){
      $all('input.gidx-cb', list).forEach(function(cb){ cb.checked = true; });
      updateStatus();
    };
    btnClear.onclick = function(){
      $all('input.gidx-cb', list).forEach(function(cb){ cb.checked = false; });
      updateStatus();
    };
    btnExport.onclick = function(){
      var links = getSelectedLinks();
      if (!links.length) return alert('Chưa chọn file nào.');
      var blob = new Blob([links.join('\n') + '\n'], {type:'text/plain;charset=utf-8'});
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'aria2.txt';
      a.click();
      URL.revokeObjectURL(a.href);
    };
    btnDownload.onclick = function(){
      (async function(){
        var links = getSelectedLinks();
        if (!links.length) return alert('Chưa chọn file nào.');
        var concurrency = 3, q = links.slice();
        async function worker(){
          while(q.length){
            var url = q.shift();
            try{
              var a = document.createElement('a');
              a.href = url;
              a.rel = 'noreferrer';
              a.target = '_blank';
              try{ a.download = decodeURIComponent((new URL(url)).pathname.split('/').pop() || ''); }catch(e){}
              document.body.appendChild(a);
              a.click();
              a.remove();
            }catch(e){}
            await sleep(60);
          }
        }
        await Promise.all([worker(),worker(),worker()].slice(0,concurrency));
      })();
    };
    btnReload.onclick = function(){ init(true); };

    /* expose */
    wrap.__setStatus = function(t){ status.textContent = t; };
    wrap.__setDebug  = function(t){ debugBox.textContent = t; try{ console.log('[gidx]', t); }catch(e){} };
    wrap.__appendDebug = function(t){ debugBox.textContent += '\n' + t; try{ console.log('[gidx]', t); }catch(e){} };
    wrap.__clearList = function(){ list.innerHTML = ''; };
    wrap.__addItem = function(name, url){
      var cb = document.createElement('input'); cb.type='checkbox'; cb.className='gidx-cb'; cb.dataset.url=url; cb.onchange=updateStatus;
      var label = document.createElement('label'); label.textContent=name; label.style.userSelect='none'; label.style.whiteSpace='nowrap'; label.style.overflow='hidden'; label.style.textOverflow='ellipsis'; label.title=name;
      list.appendChild(cb); list.appendChild(label);
    };
    wrap.__updateStatus = updateStatus;
    wrap.__useEncoded = function(){ return !!encCb.checked; };
    return wrap;
  }

  /* ========== Sources ========== */
  function joinURL(base, name, encoded){ return base + (encoded ? encodeURIComponent(String(name)) : String(name)); }

  /* S1: JSON endpoints phổ biến */
  async function fetchJSONListing(log){
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
    var tried = {};
    for (var i=0;i<trials.length;i++){
      var url = trials[i]; if (tried[url]) continue; tried[url]=1;
      try{
        var r = await fetch(url, { credentials:'omit' });
        log('GET ' + url + ' -> ' + r.status + ' ' + (r.headers.get('content-type')||''));
        if(!r.ok) continue;
        var ct = (r.headers.get('content-type')||'').toLowerCase();
        if (ct.indexOf('json') === -1) continue;
        var data = await r.json();
        var items = normalizeItemsFromAnyJSON(data).filter(function(it){ return looksLikeFileName(it.name) || it.isFolder; });
        if (items.length) return { base: base, items: items };
      }catch(e){ log('ERR ' + url + ' -> ' + (e && e.message ? e.message : String(e))); }
    }
    return null;
  }

  /* S2: DOM anchors */
  function scrapeDOMAnchors(log){
    var anchors = $all('a[href]');
    log('DOM anchors count=' + anchors.length);
    var out = [], seen = {};
    for (var i=0;i<anchors.length;i++){
      var a = anchors[i];
      try{
        var u = new URL(a.getAttribute('href'), location.href);
        var name = decodeURIComponent((u.pathname.split('/').pop() || '').trim());
        if (!name) continue;
        var isDir = /\/$/.test(u.pathname) || /(\?|&)(id|path|p)=/.test(u.search) || name === '..' || name.toLowerCase()==='parent';
        if (isDir) continue;
        if (!looksLikeFileName(name)) continue;
        var abs = u.href;
        if (!seen[abs]){ seen[abs]=1; out.push({ name:name, url:abs }); }
      }catch(e){}
    }
    /* data-* fallback */
    var nodes = $all('[data-href],[data-url],[data-download]');
    log('DOM data-* candidates=' + nodes.length);
    for (var j=0;j<nodes.length;j++){
      var el = nodes[j];
      var url = el.getAttribute('data-href') || el.getAttribute('data-url') || el.getAttribute('data-download');
      if (!url) continue;
      try{
        var u2 = new URL(url, location.href);
        var n2 = decodeURIComponent((u2.pathname.split('/').pop()||'').trim());
        if (!looksLikeFileName(n2)) continue;
        var abs2 = u2.href;
        if (!seen[abs2]){ seen[abs2]=1; out.push({ name:n2, url:abs2 }); }
      }catch(e){}
    }
    return out;
  }

  /* S3: quét window.MODEL / UI / globals */
  function scanWindowForListing(log){
    var bases = [ safe(function(){return window.MODEL;}), safe(function(){return window.UI;}), window ];
    var items = [];
    for (var b=0;b<bases.length;b++){
      var root = bases[b];
      try{
        var found = collectArraysWithFiles(root, 0, 3);
        if (found.length){
          log('window-scan found arrays=' + found.length);
          for (var i=0;i<found.length;i++){
            var arr = found[i];
            for (var k=0;k<arr.length;k++){
              var it = arr[k];
              var name = it && (it.name || it.filename || it.title || (it.path? String(it.path).split('/').pop(): ''));
              if (!name) continue;
              var isFolder = !!(it.type===1 || it.isFolder===true || String(it.mime||'').toLowerCase()==='folder');
              items.push({ name:String(name), isFolder:isFolder });
            }
          }
        }
      }catch(e){}
    }
    /* dedup & filter */
    var seen = {}, dedup = [];
    for (var t=0;t<items.length;t++){
      var nm = items[t].name;
      if (!looksLikeFileName(nm) && !items[t].isFolder) continue;
      var key = nm + '|' + (items[t].isFolder?'1':'0');
      if (!seen[key]){ seen[key]=1; dedup.push(items[t]); }
    }
    return dedup;
  }
  function collectArraysWithFiles(obj, depth, maxDepth){
    var out = [];
    if (!obj || depth>maxDepth) return out;
    if (Array.isArray(obj)){
      var good = obj.filter(function(x){ return x && (x.name || x.filename || x.title || x.path); });
      if (good.length >= Math.min(2, obj.length)) out.push(obj);
      return out;
    }
    if (typeof obj === 'object'){
      var keys = Object.keys(obj); if (keys.length>1000) return out;
      for (var i=0;i<keys.length;i++){
        var v = obj[keys[i]];
        try{ out = out.concat(collectArraysWithFiles(v, depth+1, maxDepth)); }catch(e){}
      }
    }
    return out;
  }

  /* S4: sniff fetch/XHR */
  (function setupSniffers(){
    if (window.__gidx_sniffer_installed) return;
    window.__gidx_sniffer_installed = true;

    function pushJson(j){
      try{
        var items = normalizeItemsFromAnyJSON(j).filter(function(it){ return looksLikeFileName(it.name) || it.isFolder; });
        if (items.length){ window.__GIDX_SEEN_ITEMS__ = items; }
      }catch(e){}
    }

    var ofetch = window.fetch;
    if (ofetch){
      window.fetch = function(input, init){
        return ofetch(input, init).then(function(res){
          try{
            var ct = (res.headers && res.headers.get('content-type') || '').toLowerCase();
            if (ct.indexOf('json') !== -1){ res.clone().json().then(pushJson).catch(function(){}); }
          }catch(e){}
          return res;
        });
      };
    }

    var OXHR = window.XMLHttpRequest;
    if (OXHR){
      function PXHR(){ var x = new OXHR(); return x; }
      PXHR.prototype = OXHR.prototype;
      window.XMLHttpRequest = PXHR;
      var open = OXHR.prototype.open, send = OXHR.prototype.send;
      PXHR.prototype.open = function(){ this.__gidx_method = arguments[0]; this.__gidx_url = arguments[1]; return open.apply(this, arguments); };
      PXHR.prototype.send = function(){
        this.addEventListener('load', function(){
          try{
            var ct = (this.getResponseHeader && this.getResponseHeader('content-type') || '').toLowerCase();
            if (ct.indexOf('json') !== -1){
              var txt = this.responseText; try{ pushJson(JSON.parse(txt)); }catch(e){}
            }
          }catch(e){}
        });
        return send.apply(this, arguments);
      };
    }
  })();

  /* JSON normalizer */
  function normalizeItemsFromAnyJSON(data){
    var items = [];
    try{
      if (Array.isArray(data)) items = data;
      else if (Array.isArray(data.files)) items = data.files;
      else if (Array.isArray(data.data)) items = data.data;
      else if (data.list && Array.isArray(data.list)) items = data.list;
      else if (data.children && Array.isArray(data.children)) items = data.children;
      else if (data.items && Array.isArray(data.items)) items = data.items;
    }catch(e){ items = []; }
    if (!items || !items.length) return [];
    return items.map(function(it){
      var name = it && (it.name || it.filename || it.title || (it.path? String(it.path).split('/').pop(): ''));
      var fold = !!(it && (it.type===1 || it.isFolder===true || String(it.mime||'').toLowerCase()==='folder'));
      return name ? { name:String(name), isFolder:fold } : null;
    }).filter(function(x){ return !!x; });
  }

  /* S5: scraper dành riêng cho alx-xlx: đọc cột "File" trong bảng */
  function scrapeAlxTable(log){
    var tables = document.querySelectorAll('table');
    if (!tables || !tables.length) { log('alx-table: no <table>'); return []; }
    var target = null;
    for (var i=0;i<tables.length;i++){
      var t = tables[i];
      var head = t.querySelector('thead') || t;
      var txt = (head.textContent || '').toLowerCase();
      if (txt.indexOf('file') !== -1 && (txt.indexOf('modified') !== -1 || txt.indexOf('size') !== -1)) { target = t; break; }
    }
    if (!target) { log('alx-table: no header match'); return []; }

    var rows = target.querySelectorAll('tbody tr, tr');
    var out = [];
    for (var r=0;r<rows.length;r++){
      var tr = rows[r];
      var firstCell = tr.querySelector('td') || tr.children[0];
      if (!firstCell) continue;
      var name = (firstCell.textContent || '').replace(/\u00A0/g,' ').trim();
      if (!name) continue;
      if (/[\/\\]$/.test(name)) continue; /* bỏ thư mục */
      if (!looksLikeFileName(name)) continue;
      out.push({ name: name });
    }
    return out;
  }

  /* ========== init flow ========== */
  async function init(force){
    var panel = ensurePanel();
    if (!force && panel.__initing) return;
    panel.__initing = true;
    panel.__setStatus('Đang nạp…');
    panel.__setDebug('Starting…');
    panel.__clearList();

    function log(line){ panel.__appendDebug(line); }

    var base = basePath();

    /* 1) JSON endpoints */
    var listing = await fetchJSONListing(log);
    if (listing && listing.items && listing.items.length){
      var files = listing.items.filter(function(it){ return !it.isFolder && looksLikeFileName(it.name); });
      log('JSON ok: total=' + listing.items.length + ', files=' + files.length);
      if (files.length){
        var enc = panel.__useEncoded();
        for (var i=0;i<files.length;i++){ panel.__addItem(files[i].name, joinURL(base, files[i].name, enc)); }
        panel.__setStatus('Sẵn sàng (JSON)'); panel.__updateStatus(); panel.__initing = false; return;
      }
    }

    /* 2) sniff fetch/XHR */
    var sniff = window.__GIDX_SEEN_ITEMS__;
    if (sniff && sniff.length){
      var files2 = sniff.filter(function(x){ return !x.isFolder && looksLikeFileName(x.name); });
      log('Sniffer ok: files=' + files2.length);
      if (files2.length){
        var enc2 = panel.__useEncoded();
        for (var s=0;s<files2.length;s++){ panel.__addItem(files2[s].name, joinURL(base, files2[s].name, enc2)); }
        panel.__setStatus('Sẵn sàng (sniff)'); panel.__updateStatus(); panel.__initing = false; return;
      }
    }

    /* 3) window scan */
    var winItems = scanWindowForListing(log);
    if (winItems && winItems.length){
      var files3 = winItems.filter(function(x){ return !x.isFolder && looksLikeFileName(x.name); });
      log('window-scan: files=' + files3.length + ' (from ' + winItems.length + ' items)');
      if (files3.length){
        var enc3 = panel.__useEncoded();
        for (var w=0; w<files3.length; w++){ panel.__addItem(files3[w].name, joinURL(base, files3[w].name, enc3)); }
        panel.__setStatus('Sẵn sàng (window)'); panel.__updateStatus(); panel.__initing = false; return;
      }
    }

    /* 4) alx-xlx table scraper */
    var alx = scrapeAlxTable(log);
    if (alx && alx.length){
      var filesA = alx.filter(function(x){ return looksLikeFileName(x.name); });
      log('alx-table: files=' + filesA.length);
      if (filesA.length){
        var encA = panel.__useEncoded();
        for (var a=0;a<filesA.length;a++){ panel.__addItem(filesA[a].name, joinURL(base, filesA[a].name, encA)); }
        panel.__setStatus('Sẵn sàng (alx-table)'); panel.__updateStatus(); panel.__initing = false; return;
      }
    }

    /* 5) DOM anchors */
    var anchors = scrapeDOMAnchors(log);
    if (anchors.length){
      log('DOM scrape: files=' + anchors.length);
      for (var j=0;j<anchors.length;j++){ panel.__addItem(anchors[j].name, anchors[j].url); }
      panel.__setStatus('Sẵn sàng (DOM)'); panel.__updateStatus(); panel.__initing = false; return;
    }

    panel.__setStatus('Không lấy được danh sách');
    log('No source produced items.');
    panel.__initing = false;
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', function(){ init(true); }); }
  else { init(true); }

  /* re-init khi SPA đổi URL / DOM */
  (function(){
    var oldHref = location.href;
    var obs = new MutationObserver(function(){ if (oldHref !== location.href) { oldHref = location.href; init(true); } });
    if (document.body) obs.observe(document.body, {childList:true,subtree:true});
    ['pushState','replaceState'].forEach(function(m){
      var orig = history[m]; if (!orig) return;
      history[m] = function(){ var ret = orig.apply(this, arguments); try { window.dispatchEvent(new Event('locationchange')); } catch(e){} return ret; };
    });
    window.addEventListener('locationchange', function(){ init(true); });
    setInterval(function(){ if (!document.body.contains($('#gidx-panel'))) { ensurePanel(); } }, 1000);
  })();
})();
