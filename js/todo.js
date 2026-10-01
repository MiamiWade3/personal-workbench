/* todo.js —— 待办模块
 * 字段（PRD）：id, bucket(today|week|month), text, done, deadline(可空), noteId(可空), createdAt
 * 约定（AGENTS）：只通过 WB.storage 读写；改动后由 storage 派发 workbench:data-changed
 * 本文件只挂函数 + render，不自行 init（启动由 app.js 负责）
 */
(function (WB) {
  var MODULE = 'todos';
  var DAY = 86400000;
  var BUCKET_LABEL = { today: '本日', week: '本周', month: '本月' };

  var state = { bucket: 'today', selectedId: null };

  function list() {
    return WB.storage.get(MODULE);
  }

  function persist(items) {
    WB.storage.set(MODULE, items);
  }

  function find(id) {
    var items = list();
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }

  function add(text, bucket) {
    var value = String(text || '').trim();
    if (!value) return null; // 空字符串或只有空格：不添加
    var item = {
      id: WB.storage.newId(),
      bucket: bucket || 'today',
      text: value,
      done: false,
      deadline: null,
      noteId: null,
      createdAt: Date.now()
    };
    var items = list();
    items.push(item);
    persist(items);
    return item;
  }

  function update(id, patch) {
    var items = list();
    var hit = null;
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].id === id) {
        Object.keys(patch).forEach(function (k) { items[i][k] = patch[k]; });
        hit = items[i];
        break;
      }
    }
    if (hit) persist(items);
    return hit;
  }

  function remove(id) {
    var items = list().filter(function (it) { return it.id !== id; });
    persist(items);
    if (state.selectedId === id) state.selectedId = null;
  }

  function toggle(id) {
    var item = find(id);
    if (!item) return null;
    return update(id, { done: !item.done });
  }

  function byBucket(bucket) {
    return list().filter(function (it) { return it.bucket === bucket; });
  }

  // 按本地自然日比较：deadline 是 YYYY-MM-DD
  function startOfToday() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  }

  function parseLocalDate(text) {
    if (!text) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  }

  function deadlineText(deadline) {
    if (!deadline) return '未填截止日期';
    var target = parseLocalDate(deadline);
    if (target === null) return '未填截止日期';
    var diff = Math.round((target - startOfToday()) / DAY);
    if (diff === 0) return '今天到期';
    if (diff > 0) return '还剩 ' + diff + ' 天';
    return '已过期 ' + Math.abs(diff) + ' 天';
  }

  function isOverdue(deadline) {
    if (!deadline) return false;
    var target = parseLocalDate(deadline);
    return target !== null && target < startOfToday();
  }

  function formatCreatedAt(ms) {
    if (!ms) return '—';
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /* ---------- 渲染 ---------- */

  function renderList() {
    var ul = document.getElementById('todoList');
    var empty = document.getElementById('todoEmpty');
    if (!ul) return;
    ul.textContent = '';

    var items = byBucket(state.bucket);
    if (empty) empty.style.display = items.length === 0 ? '' : 'none';

    items.forEach(function (item) {
      var li = el('li', 'todo-item' + (item.id === state.selectedId ? ' is-selected' : ''));

      var box = el('span', 'box' + (item.done ? ' is-checked' : ''));
      box.addEventListener('click', function (e) {
        e.stopPropagation();
        toggle(item.id);
      });
      li.appendChild(box);

      var main = el('div', 'todo-main');
      main.appendChild(el('div', 'todo-text' + (item.done ? ' is-done' : ''), item.text));
      var meta = el('div', 'todo-meta');
      meta.appendChild(el('span', 'todo-due' + (isOverdue(item.deadline) && !item.done ? ' is-over' : ''), deadlineText(item.deadline)));
      main.appendChild(meta);
      li.appendChild(main);

      var del = el('button', 'todo-del', '删除');
      del.type = 'button';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!window.confirm('删除这条待办？')) return;
        remove(item.id);
      });
      li.appendChild(del);

      li.addEventListener('click', function () {
        state.selectedId = item.id;
        render();
      });

      ul.appendChild(li);
    });
  }

  function renderNotes(item) {
    var select = document.getElementById('detailNote');
    var hint = document.getElementById('detailNoteHint');
    var gotoBtn = document.getElementById('detailGotoNote');
    if (!select) return;
    select.textContent = '';

    var none = el('option', null, '不关联');
    none.value = '';
    select.appendChild(none);

    var notes = WB.storage.get('notes') || [];
    notes.forEach(function (n) {
      var label = (n.cause && String(n.cause).trim()) || String(n.body || '').split('\n')[0] || '（无正文）';
      if (label.length > 24) label = label.slice(0, 24) + '…';
      var opt = el('option', null, label);
      opt.value = n.id;
      select.appendChild(opt);
    });

    // 关联的笔记已被删除：保留原有 noteId 不动，只在界面上提示
    var linked = item && item.noteId;
    var missing = !!linked && !notes.some(function (n) { return n.id === item.noteId; });
    if (missing) {
      var ghost = el('option', null, '原笔记已删');
      ghost.value = item.noteId;
      select.appendChild(ghost);
    }
    if (hint) hint.textContent = missing ? '原笔记已删' : '';
    if (gotoBtn) gotoBtn.disabled = missing;
  }

  function renderDetail() {
    var empty = document.getElementById('todoDetailEmpty');
    var box = document.getElementById('todoDetail');
    if (!box) return;

    var item = state.selectedId ? find(state.selectedId) : null;
    if (!item) {
      box.hidden = true;
      if (empty) empty.style.display = '';
      return;
    }
    box.hidden = false;
    if (empty) empty.style.display = 'none';

    document.getElementById('detailText').value = item.text;
    document.getElementById('detailDone').checked = !!item.done;
    document.getElementById('detailBucket').value = item.bucket;
    document.getElementById('detailDeadline').value = item.deadline || '';
    document.getElementById('detailDeadlineHint').textContent = deadlineText(item.deadline);
    document.getElementById('detailCreatedAt').textContent = formatCreatedAt(item.createdAt);
    renderNotes(item);
    document.getElementById('detailNote').value = item.noteId || '';
  }

  function render() {
    renderList();
    renderDetail();
  }

  /* ---------- 事件绑定（只绑一次） ---------- */

  function bind() {
    var input = document.getElementById('todoInput');
    var bucket = document.getElementById('todoBucket');
    var addBtn = document.getElementById('todoAdd');

    function submit() {
      var item = add(input.value, bucket.value);
      if (!item) return; // 空的，什么都不做
      input.value = '';
      state.bucket = item.bucket;
      state.selectedId = item.id;
      syncTabs();
      render();
      input.focus();
    }

    if (addBtn) addBtn.addEventListener('click', submit);
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submit();
      });
    }

    var tabs = document.getElementById('todoTabs');
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.todo-tab') : null;
        if (!btn) return;
        state.bucket = btn.dataset.bucket;
        state.selectedId = null;
        syncTabs();
        render();
      });
    }

    var save = document.getElementById('detailSave');
    if (save) {
      save.addEventListener('click', function () {
        var v = document.getElementById('detailText').value.trim();
        if (!v) return; // 不允许改成空
        update(state.selectedId, { text: v });
      });
    }

    var done = document.getElementById('detailDone');
    if (done) {
      done.addEventListener('change', function () {
        update(state.selectedId, { done: done.checked });
      });
    }

    var dBucket = document.getElementById('detailBucket');
    if (dBucket) {
      dBucket.addEventListener('change', function () {
        update(state.selectedId, { bucket: dBucket.value });
        state.bucket = dBucket.value;
        syncTabs();
      });
    }

    var deadline = document.getElementById('detailDeadline');
    if (deadline) {
      deadline.addEventListener('change', function () {
        update(state.selectedId, { deadline: deadline.value || null });
      });
    }

    var clear = document.getElementById('detailClearDeadline');
    if (clear) {
      clear.addEventListener('click', function () {
        update(state.selectedId, { deadline: null });
      });
    }

    var note = document.getElementById('detailNote');
    if (note) {
      note.addEventListener('change', function () {
        update(state.selectedId, { noteId: note.value || null });
      });
    }

    var goto = document.getElementById('detailGotoNote');
    if (goto) {
      goto.addEventListener('click', function () {
        var item = find(state.selectedId);
        if (!item || !item.noteId) return;
        // 走 app.js 的统一导航：切页 + 高亮目标笔记
        if (WB.app && WB.app.goToNote) WB.app.goToNote(item.noteId);
      });
    }

    var del = document.getElementById('detailDelete');
    if (del) {
      del.addEventListener('click', function () {
        if (!window.confirm('删除这条待办？')) return;
        remove(state.selectedId);
        render();
      });
    }
  }

  function syncTabs() {
    var tabs = document.querySelectorAll('.todo-tab');
    tabs.forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.bucket === state.bucket);
    });
  }

  function renderWithBind() {
    if (!WB.__todoBound) {
      bind();
      WB.__todoBound = true;
    }
    syncTabs();
    render();
  }

  WB.todo = {
    MODULE: MODULE,
    list: list,
    add: add,
    update: update,
    remove: remove,
    toggle: toggle,
    byBucket: byBucket,
    deadlineText: deadlineText,
    isOverdue: isOverdue,
    formatCreatedAt: formatCreatedAt,
    render: renderWithBind
  };
})(window.WB);
