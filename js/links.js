/* links.js —— 快捷入口模块（常用网站 + 常用文本）
 * 字段（PRD）：网站 id, name, url, order, createdAt；文本 id, name, text, order, createdAt
 * 约定（AGENTS）：只接受 http/https；新窗口用 noopener；只通过 WB.storage 读写
 * 本文件只挂函数 + render，不自行 init（启动由 app.js 负责）
 */
(function (WB) {
  var SITE = 'links';
  var TEXT = 'snippets';

  var PRESET_SITES = [
    { name: 'QQ邮箱', url: 'https://mail.qq.com' },
    { name: '腾讯文档', url: 'https://docs.qq.com' },
    { name: 'GitHub', url: 'https://github.com' },
    { name: '知乎', url: 'https://www.zhihu.com' }
  ];

  var state = { kind: 'site' };
  var hintTimer = null;

  function list(kind) {
    return WB.storage.get(kind === TEXT ? TEXT : SITE);
  }

  function persist(kind, items) {
    WB.storage.set(kind === TEXT ? TEXT : SITE, items);
  }

  function newItem(kind, name, value) {
    return {
      id: WB.storage.newId(),
      name: name,
      url: kind === SITE ? value : undefined,
      text: kind === TEXT ? value : undefined,
      order: list(kind).length + 1,
      createdAt: Date.now()
    };
  }

  function add(kind, name, value) {
    var n = String(name || '').trim();
    var v = String(value || '').trim();
    if (!n || !v) return { ok: false, message: '名称和内容都要填。' };
    if (kind === SITE) {
      var normalized = normalizeUrl(v);
      if (!normalized.ok) return { ok: false, message: normalized.message };
      v = normalized.url;
    }
    var items = list(kind);
    items.push(newItem(kind, n, v));
    persist(kind, items);
    return { ok: true };
  }

  function remove(kind, id) {
    var items = list(kind).filter(function (it) { return it.id !== id; });
    items.forEach(function (it, i) { it.order = i + 1; });
    persist(kind, items);
  }

  /* URL 规则：没写协议补 https://；只放行 http / https */
  function normalizeUrl(raw) {
    var value = String(raw || '').trim();
    if (!value) return { ok: false, message: '网址不能为空。' };
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
      value = 'https://' + value;
    }
    var parsed;
    try {
      parsed = new URL(value);
    } catch (err) {
      return { ok: false, message: '网址格式不对，请检查。' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, message: '只支持 http:// 和 https://，其他协议不保存。' };
    }
    return { ok: true, url: parsed.href };
  }

  /* 复制：优先 navigator.clipboard，不可用时走 execCommand 兜底 */
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text)
        .then(function () { return true; })
        .catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function showHint(id, message, good) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || '';
    el.className = 'detail-hint' + (message ? (good ? ' is-ok' : ' is-err') : '');
    if (hintTimer) clearTimeout(hintTimer);
    if (message) {
      hintTimer = setTimeout(function () {
        el.textContent = '';
        el.className = 'detail-hint';
      }, 2600);
    }
  }

  /* ---------- 首次使用预置 4 个网站 ---------- */
  function ensurePreset() {
    var meta = WB.storage.get('meta');
    if (meta.linksInitialized) return; // 已初始化过：用户删光也不再恢复
    meta.linksInitialized = true;
    WB.storage.set('meta', meta);
    if (list(SITE).length === 0) {
      var items = PRESET_SITES.map(function (s, i) {
        return {
          id: WB.storage.newId(),
          name: s.name,
          url: s.url,
          order: i + 1,
          createdAt: Date.now()
        };
      });
      persist(SITE, items);
    }
  }

  /* ---------- 渲染 ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function renderSites() {
    var ul = document.getElementById('siteList');
    var empty = document.getElementById('siteEmpty');
    if (!ul) return;
    ul.textContent = '';

    var items = list(SITE).slice().sort(function (a, b) { return a.order - b.order; });
    if (empty) empty.style.display = items.length === 0 ? '' : 'none';

    items.forEach(function (it) {
      var li = el('li', 'link-item');

      var main = el('div', 'link-main');
      // 用 <a> 而不是 window.open：不会被弹窗拦截器拦下，rel 里带 noopener 同样安全
      var link = el('a', 'link-name', it.name);
      link.setAttribute('href', it.url);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      main.appendChild(link);
      main.appendChild(el('div', 'link-sub', it.url));
      li.appendChild(main);

      var del = el('button', 'link-btn is-danger', '删除');
      del.type = 'button';
      del.addEventListener('click', function () {
        if (!window.confirm('删除「' + it.name + '」？')) return;
        remove(SITE, it.id);
      });
      li.appendChild(del);

      ul.appendChild(li);
    });
  }

  function renderSnippets() {
    var ul = document.getElementById('snippetList');
    var empty = document.getElementById('snippetEmpty');
    if (!ul) return;
    ul.textContent = '';

    var items = list(TEXT).slice().sort(function (a, b) { return a.order - b.order; });
    if (empty) empty.style.display = items.length === 0 ? '' : 'none';

    items.forEach(function (it) {
      var li = el('li', 'link-item');

      var main = el('div', 'link-main');
      main.appendChild(el('div', 'link-name-text', it.name));
      main.appendChild(el('div', 'link-sub', it.text));
      li.appendChild(main);

      var actions = el('div', 'link-actions');
      var copyBtn = el('button', 'link-btn', '复制');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', function () {
        copy(it.text).then(function (ok) {
          showHint('snippetHint', ok ? '已复制到剪贴板。' : '复制失败，请手动选中后复制。', ok);
        });
      });
      actions.appendChild(copyBtn);

      var del = el('button', 'link-btn is-danger', '删除');
      del.type = 'button';
      del.addEventListener('click', function () {
        if (!window.confirm('删除「' + it.name + '」？')) return;
        remove(TEXT, it.id);
      });
      actions.appendChild(del);

      li.appendChild(actions);
      ul.appendChild(li);
    });
  }

  function renderPanes() {
    var site = document.getElementById('linksPaneSite');
    var text = document.getElementById('linksPaneText');
    if (site) site.hidden = state.kind !== 'site';
    if (text) text.hidden = state.kind !== 'text';
    var tabs = document.querySelectorAll('.links-tab');
    tabs.forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.kind === state.kind);
    });
  }

  function bind() {
    var tabs = document.getElementById('linksTabs');
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.links-tab') : null;
        if (!btn) return;
        state.kind = btn.dataset.kind;
        renderPanes();
      });
    }

    var siteAdd = document.getElementById('siteAdd');
    if (siteAdd) {
      siteAdd.addEventListener('click', function () {
        var res = add(SITE, document.getElementById('siteName').value, document.getElementById('siteUrl').value);
        showHint('siteHint', res.message || '', res.ok);
        if (res.ok) {
          document.getElementById('siteName').value = '';
          document.getElementById('siteUrl').value = '';
          showHint('siteHint', '已添加。', true);
          document.getElementById('siteName').focus();
        }
      });
    }

    var snippetAdd = document.getElementById('snippetAdd');
    if (snippetAdd) {
      snippetAdd.addEventListener('click', function () {
        var res = add(TEXT, document.getElementById('snippetName').value, document.getElementById('snippetText').value);
        showHint('snippetHint', res.message || '', res.ok);
        if (res.ok) {
          document.getElementById('snippetName').value = '';
          document.getElementById('snippetText').value = '';
          showHint('snippetHint', '已添加。', true);
          document.getElementById('snippetName').focus();
        }
      });
    }
  }

  function renderWithBind() {
    if (!WB.__linksBound) {
      bind();
      WB.__linksBound = true;
    }
    renderPanes();
    renderSites();
    renderSnippets();
  }

  WB.links = {
    SITE: SITE,
    TEXT: TEXT,
    list: list,
    add: add,
    remove: remove,
    normalizeUrl: normalizeUrl,
    copy: copy,
    ensurePreset: ensurePreset,
    render: renderWithBind
  };
})(window.WB);
