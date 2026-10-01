/* notes.js —— 快速笔记模块
 * 字段（PRD）：id, cause(可空), body, createdAt
 * 铁律：只有点「提交」才写入，输入过程不自动保存，也不存草稿
 * 本文件只挂函数 + render，不自行 init（启动由 app.js 负责）
 */
(function (WB) {
  var MODULE = 'notes';
  var state = { selectedId: null, flashId: null };

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

  function add(cause, body) {
    var text = String(body || '').trim();
    if (!text) return null; // 内容必填
    var why = String(cause || '').trim();
    var item = {
      id: WB.storage.newId(),
      cause: why || null,
      body: text,
      createdAt: Date.now()
    };
    var items = list();
    items.push(item);
    persist(items);
    return item;
  }

  function remove(id) {
    persist(list().filter(function (n) { return n.id !== id; }));
    if (state.selectedId === id) state.selectedId = null;
  }

  function formatTime(ms) {
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

  function renderList() {
    var ul = document.getElementById('noteList');
    var empty = document.getElementById('noteEmpty');
    if (!ul) return;
    ul.textContent = '';

    var items = list().slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (empty) empty.style.display = items.length === 0 ? '' : 'none';

    items.forEach(function (n) {
      var li = el('li', 'note-item' + (n.id === state.selectedId ? ' is-selected' : '') +
        (n.id === state.flashId ? ' is-flash' : ''));

      if (n.cause) li.appendChild(el('div', 'note-cause', n.cause));
      li.appendChild(el('div', 'note-body-text', n.body));
      li.appendChild(el('div', 'note-time', formatTime(n.createdAt)));

      li.addEventListener('click', function () {
        state.selectedId = n.id;
        state.flashId = null;
        render();
      });
      ul.appendChild(li);
    });

    if (state.flashId) {
      setTimeout(function () {
        state.flashId = null;
        render();
      }, 1500);
    }
  }

  function renderPane() {
    var form = document.getElementById('noteForm');
    var detail = document.getElementById('noteDetail');
    var head = document.getElementById('notePaneHead');
    if (!form || !detail) return;

    var item = state.selectedId ? find(state.selectedId) : null;
    if (!item) {
      form.hidden = false;
      detail.hidden = true;
      if (head) head.textContent = '写一条';
      return;
    }
    form.hidden = true;
    detail.hidden = false;
    if (head) head.textContent = '详情';
    document.getElementById('viewCause').textContent = item.cause || '（未填起因）';
    document.getElementById('viewBody').textContent = item.body;
    document.getElementById('viewTime').textContent = formatTime(item.createdAt);
  }

  function bind() {
    var submit = document.getElementById('noteSubmit');
    var cause = document.getElementById('noteCause');
    var body = document.getElementById('noteBody');
    var hint = document.getElementById('noteHint');

    if (submit) {
      submit.addEventListener('click', function () {
        if (!body.value.trim()) {
          if (hint) hint.textContent = '内容不能为空，写完再提交。';
          body.focus();
          return;
        }
        var item = add(cause.value, body.value);
        if (!item) return; // 内容必填
        if (hint) hint.textContent = '已保存。';
        cause.value = '';
        body.value = '';
        state.selectedId = item.id;
        render();
      });
    }

    var back = document.getElementById('noteBack');
    if (back) {
      back.addEventListener('click', function () {
        state.selectedId = null;
        render();
      });
    }

    var del = document.getElementById('noteDelete');
    if (del) {
      del.addEventListener('click', function () {
        if (!window.confirm('删除这条笔记？')) return;
        remove(state.selectedId);
        render();
      });
    }
  }

  function render() {
    renderList();
    renderPane();
  }

  // 供 app.js 的统一导航调用：切到笔记页并高亮目标笔记
  function focus(id) {
    if (!id) return;
    state.selectedId = id;
    state.flashId = id;
    render();
  }

  function renderWithBind() {
    if (!WB.__notesBound) {
      bind();
      WB.__notesBound = true;
    }
    render();
  }

  WB.notes = {
    MODULE: MODULE,
    list: list,
    add: add,
    remove: remove,
    find: find,
    formatTime: formatTime,
    focus: focus,
    render: renderWithBind
  };
})(window.WB);
