(function(){
  function sleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
  function $(s, r){ return (r||document).querySelector(s); }
  function $all(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }

  function ensurePanel(){
    var wrap = $('#gidx-panel'); if (wrap) return wrap;
    wrap = document.createElement('div');
    wrap.id = 'gidx-panel';
    wrap.style.position = 'fixed';
    wrap.style.right = '16px';
    wrap.style.bottom = '16px';
    wrap.style.zIndex = '2147483647';
    wrap.style.width = 'min(380px, 92vw)';
    wrap.style.maxHeight = '64vh';
    wrap.style.overflow = 'hidden';
    wrap.style.background = 'rgba(255,255,255,0.98)';
    wrap.style.border = '1px solid #e5e7eb';
    wrap.style.borderRadius = '14px';
    wrap.style.boxShadow = '0 6px 28px rgba(0,0,0,0.18)';
    wrap.style.font = '14px system-ui, -apple-system, Segoe UI, Roboto';
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
    status.style.opacity = '0.8';
    status.textContent = '…';

    bar.appendChild(btnSelectAll);
    bar.appendChild(btnClear);
    bar.appendChild(btnDownload);
    bar.appendChild(btnExport);
    bar.appendChild(btnReload);
    bar.appendChild(status);

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
    debugBox.style.maxHeight = '28vh';
    debugBox.style.overflow = 'auto';
    debugBox.style.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    debugBox.textContent = 'Debug log will appear here…';

    wrap.appendChild(bar);
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

    wrap.__setStatus = function(t){ status.textContent = t; };
    wrap.__setDebug = function(t){ debugBox.textContent = t; };
    wrap.__appendDebug = function(t){ debugBox.textContent += '\n' + t; };
    wrap.__clearList = function(){ list.innerHTML = ''; };
    wrap.__addItem = function(name, url){
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'gidx-cb'; cb.dataset.url = url; cb.onchange = updateStatus;
      var label = document.createElement('label'); label.textContent = name; label.style.userSelect = 'none'; label.style.whiteSpace='nowrap'; label.style.overflow='hidden'; label.style.textOverflow='ellipsis'; label.title = name;
      list.appendChild(cb); list.appendChild(label);
    };
    wrap.__updateStatus = updateStatus;
    return wrap;
  }

  function buildURL(base, name){ return base + encodeURIComponent(String(name)); }

  async function fetchJSONListing(log){
    var base = location.origin + location.pathname.replace(/\/+$/,'') + '/';
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
        var items = [];
        if (Array.isArray(data)) items = data;
        else if (Array.isArray(data.files)) items = data.files;
        else if (Array.isArray(data.data)) items = data.data;
        else if (data.list && Array.isArray(data.list)) items = data.list;
        else if (data.children && Array.isArray(data.children)) items = data.children;
        items = items.map(function(it){
          var name = it.name || it.filename || it.title || (it.path? String(it.path).split('/').pop(): '');
          var fold = (it.type===1) || (it.isFolder===true) || (String(it.mime||'').toLowerCase()==='folder');
          if (typeof it.size === 'undefined' && !/\.[a-z0-9]{1,8}$/i.test(String(name))) fold = true;
          return { name: String(name||''), isFolder: !!fold };
        }).filter(function(it){ return it.name; });
        if (items.length) return { base: base, items: items };
      }catch(e){ log('ERR ' + url + ' -> ' + (e && e.message ? e.message : String(e))); }
    }
    return null;
  }

  function scrapeDOMAnchors(log){
    var anchors = $all('a[href]'); log('DOM anchors found: ' + anchors.length);
    var out = [], seen = {};
    for (var i=0;i<anchors.length;i++){
      var a = anchors[i];
      try{
        var u = new URL(a.getAttribute('href'), location.href);
        var name = decodeURIComponent((u.pathname.split('/').pop() || '').trim());
        if (!name) continue;
        var isDir = /\/$/.test(u.pathname) || /(\?|&)(id|path|p)=/.test(u.search) || name === '..' || name.toLowerCase()==='parent';
        if (isDir) continue;
        var abs = u.href;
        if (!seen[abs]){ seen[abs] = 1; out.push({ name: name, url: abs }); }
      }catch(e){}
    }
    return out;
  }

  async function init(force){
    var panel = ensurePanel();
    if (!force && panel.__initing) return;
    panel.__initing = true;
    panel.__setStatus('Đang nạp…');
    panel.__setDebug('Starting…');
    panel.__clearList();

    function log(line){ try{ panel.__appendDebug(line); }catch(e){} }

    var listing = await fetchJSONListing(log);
    if (listing && listing.items && listing.items.length){
      var base = listing.base;
      var files = listing.items.filter(function(it){ return !it.isFolder; });
      log('JSON ok, items=' + listing.items.length + ', files=' + files.length);
      if (files.length){
        for (var i=0;i<files.length;i++){ var f = files[i]; panel.__addItem(f.name, buildURL(base, f.name)); }
        panel.__setStatus('Sẵn sàng (JSON)'); panel.__updateStatus(); panel.__initing = false; return;
      }
    }

    var anchors = scrapeDOMAnchors(log);
    if (anchors.length){
      log('DOM scrape ok, files=' + anchors.length);
      for (var j=0;j<anchors.length;j++){ panel.__addItem(anchors[j].name, anchors[j].url); }
      panel.__setStatus('Sẵn sàng (DOM)'); panel.__updateStatus(); panel.__initing = false; return;
    }

    panel.__setStatus('Không lấy được danh sách');
    log('No JSON matched and no file-like anchors found.');
    panel.__initing = false;
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', function(){ init(true); }); }
  else { init(true); }

  setInterval(function(){ if (!document.body.contains($('#gidx-panel'))) { ensurePanel(); } }, 1000);

  (function(){
    var oldHref = location.href;
    var obs = new MutationObserver(function(){ if (oldHref !== location.href) { oldHref = location.href; init(true); } });
    if (document.body) obs.observe(document.body, {childList:true,subtree:true});
    ['pushState','replaceState'].forEach(function(m){
      var orig = history[m]; if (!orig) return;
      history[m] = function(){ var ret = orig.apply(this, arguments); try { window.dispatchEvent(new Event('locationchange')); } catch(e){} return ret; };
    });
    window.addEventListener('locationchange', function(){ init(true); });
  })();
})();
