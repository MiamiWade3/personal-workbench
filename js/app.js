/* app.js —— 唯一的启动入口
 * 职责：启动、左侧导航、顶部日期与问候、看板刷新
 * 约束（AGENTS.md）：本文件最后引入；其它模块不得自行 init
 */
(function (WB) {
  var WEEK_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setWidth(id, percent) {
    var el = document.getElementById(id);
    if (el) el.style.width = Math.max(0, Math.min(100, percent)) + '%';
  }

  function toggleEmpty(listId, emptyId) {
    var list = document.getElementById(listId);
    var empty = document.getElementById(emptyId);
    if (!list || !empty) return;
    empty.style.display = list.children.length === 0 ? '' : 'none';
  }

  function switchView(view) {
    var navItems = document.querySelectorAll('.nav-item');
    var views = document.querySelectorAll('.view');
    navItems.forEach(function (btn) { btn.classList.remove('is-active'); });
    views.forEach(function (v) { v.classList.remove('is-active'); });

    var current = document.querySelector('.nav-item[data-view="' + view + '"]');
    if (current) current.classList.add('is-active');
    var target = document.getElementById('view-' + view);
    if (target) target.classList.add('is-active');
  }

  function bindNav() {
    var navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchView(btn.dataset.view);
      });
    });
  }

  function renderDate() {
    var now = new Date();
    setText('dayNum', String(now.getDate()));
    setText('monthText', now.getFullYear() + '年' + (now.getMonth() + 1) + '月');
    setText('weekText', WEEK_NAMES[now.getDay()]);

    var h = now.getHours();
    var greet = '晚上好';
    if (h < 5) greet = '夜深了';
    else if (h < 11) greet = '早上好';
    else if (h < 14) greet = '中午好';
    else if (h < 18) greet = '下午好';
    setText('greeting', greet);
  }

  // 今日看板下方的「本日待办」
  function renderBoardTodoList() {
    var ul = document.getElementById('boardTodoList');
    if (!ul || !WB.todo) return;
    ul.textContent = '';
    WB.todo.byBucket('today').forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'todo-item' + (item.done ? ' is-done' : '');

      var box = document.createElement('span');
      box.className = 'box';
      li.appendChild(box);

      var text = document.createElement('span');
      text.className = 'todo-text';
      text.textContent = item.text;
      li.appendChild(text);

      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = WB.todo.deadlineText(item.deadline);
      li.appendChild(tag);

      ul.appendChild(li);
    });
    toggleEmpty('boardTodoList', 'boardTodoEmpty');
  }

  // 今日看板下方的「打卡一览」：四项当前周期状态
  function renderBoardHabits() {
    var ul = document.getElementById('boardHabitList');
    if (!ul) return;
    ul.textContent = '';
    if (!WB.habits) {
      toggleEmpty('boardHabitList', 'boardHabitEmpty');
      return;
    }
    WB.habits.allStatus().forEach(function (h) {
      var li = document.createElement('li');
      li.className = 'checkin-item';

      var name = document.createElement('span');
      name.className = 'checkin-name';
      name.textContent = h.label;
      li.appendChild(name);

      var bar = document.createElement('span');
      bar.className = 'checkin-bar';
      var fill = document.createElement('span');
      fill.className = 'bar-fill';
      fill.style.width = (h.targetValue === 0 ? 0 : Math.min(100, (h.current / h.targetValue) * 100)) + '%';
      bar.appendChild(fill);
      li.appendChild(bar);

      var val = document.createElement('span');
      val.className = 'checkin-val money';
      val.textContent = h.mode === 'once'
        ? (h.done ? '已完成' : '未完成')
        : h.current + ' / ' + h.targetValue + ' ' + h.unit;
      li.appendChild(val);

      ul.appendChild(li);
    });
    toggleEmpty('boardHabitList', 'boardHabitEmpty');
  }

  /* 看板统一刷新函数（各模块数据变化时都会走到这里） */
  function refreshBoard() {
    var todos = WB.todo ? WB.todo.byBucket('today') : [];
    var done = todos.filter(function (t) { return t.done; }).length;
    var total = todos.length;
    setText('statTodoDone', String(done));
    setText('statTodoTotal', String(total));
    setWidth('statTodoBar', total === 0 ? 0 : (done / total) * 100);
    setText('statTodoFoot', total === 0
      ? '今天还没有待办'
      : (done === total ? '今天的待办全部完成' : '已完成 ' + done + ' 条，还剩 ' + (total - done) + ' 条'));
    renderBoardTodoList();

    var sums = WB.ledger ? WB.ledger.sums() : null;
    var todayIn = sums ? sums.today.in : 0;
    var todayOut = sums ? sums.today.out : 0;
    var money = function (cents) { return WB.storage.formatMoney(cents); };
    setText('statLedgerNet', money(todayOut));
    setWidth('statLedgerBar', (todayIn + todayOut) === 0 ? 0 : (todayOut / (todayIn + todayOut)) * 100);
    setText('statLedgerFoot', '今日收入 ' + money(todayIn) + ' · 支出 ' + money(todayOut));

    var habits = WB.habits ? WB.habits.allStatus() : [];
    var habitDone = habits.filter(function (h) { return h.done; }).length;
    setText('statHabitDone', String(habitDone));
    setWidth('statHabitBar', habits.length === 0 ? 0 : (habitDone / habits.length) * 100);
    setText('statHabitFoot', '当前周期达标 ' + habitDone + '/' + habits.length);
    renderBoardHabits();
  }

  /* ---------- 通用提示 ---------- */

  var toastTimer = null;

  function notify(message, kind) {
    var box = document.getElementById('toast');
    if (!box) return;
    box.textContent = message || '';
    box.className = 'toast' + (kind ? ' is-' + kind : '');
    box.hidden = !message;
    if (toastTimer) clearTimeout(toastTimer);
    if (message) {
      toastTimer = setTimeout(function () { box.hidden = true; }, 3200);
    }
  }

  /* ---------- 备份与恢复（导出 / 导入 / 清空） ---------- */

  var pendingImport = null;

  function moduleLabel(m) {
    return ({
      todos: '待办', notes: '笔记', links: '常用网站',
      snippets: '常用文本', ledger: '账目', habits: '打卡记录'
    })[m] || m;
  }

  function exportJson() {
    var text = JSON.stringify(WB.storage.exportData(), null, 2);
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var n = new Date();
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    a.href = url;
    a.download = 'workbench-' + n.getFullYear() + p(n.getMonth() + 1) + p(n.getDate()) +
      '-' + p(n.getHours()) + p(n.getMinutes()) + p(n.getSeconds()) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify('已导出 JSON。', 'ok');
  }

  function showImportPreview(result) {
    var panel = document.getElementById('ioPanel');
    var list = document.getElementById('ioList');
    if (!panel || !list) return;
    list.textContent = '';
    WB.storage.MODULES.forEach(function (m) {
      var li = document.createElement('li');
      li.textContent = moduleLabel(m) + '：' + result.counts[m] + ' 条';
      list.appendChild(li);
    });
    if (result.exportedAt) {
      var meta = document.createElement('li');
      meta.className = 'is-meta';
      meta.textContent = '导出时间：' + result.exportedAt;
      list.appendChild(meta);
    }
    panel.hidden = false;
  }

  function hideImportPreview() {
    var panel = document.getElementById('ioPanel');
    if (panel) panel.hidden = true;
    pendingImport = null;
    var input = document.getElementById('ioFile');
    if (input) input.value = '';
  }

  function handleImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try {
        obj = JSON.parse(String(reader.result));
      } catch (err) {
        notify('这个文件不是合法的 JSON，现有数据没有变动。', 'err');
        return;
      }
      var result = WB.storage.validateImport(obj);
      if (!result.ok) {
        notify('导入校验没通过：' + result.message + '现有数据没有变动。', 'err');
        return;
      }
      pendingImport = obj;
      showImportPreview(result);
    };
    reader.onerror = function () {
      notify('读不到这个文件，请重试。', 'err');
    };
    reader.readAsText(file);
  }

  function confirmImport() {
    if (!pendingImport) return;
    var res = WB.storage.importData(pendingImport);
    hideImportPreview();
    if (!res.ok) {
      notify(res.message, 'err');
      return;
    }
    notify('导入完成，数据已覆盖。', 'ok');
  }

  function clearAllData() {
    var total = 0;
    WB.storage.MODULES.forEach(function (m) {
      var v = WB.storage.get(m);
      total += (m === 'habits') ? (v.records ? v.records.length : 0) : (v ? v.length : 0);
    });
    if (!window.confirm('确定要清空全部数据吗？此操作不可恢复，建议先导出备份。')) {
      notify('已取消，数据没动。');
      return;
    }
    if (!window.confirm('最后确认：将删除约 ' + total + ' 条业务数据（待办、笔记、网站、文本、账目、打卡），继续？')) {
      notify('已取消，数据没动。');
      return;
    }
    var removed = WB.storage.clearAll();
    notify('已清空 ' + removed + ' 项本地数据。', 'ok');
  }

  function bindDataTools() {
    var exp = document.getElementById('btnExport');
    if (exp) exp.addEventListener('click', exportJson);

    var imp = document.getElementById('btnImport');
    var file = document.getElementById('ioFile');
    if (imp && file) {
      imp.addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () {
        handleImportFile(file.files && file.files[0]);
      });
    }

    var okBtn = document.getElementById('ioConfirm');
    if (okBtn) okBtn.addEventListener('click', confirmImport);

    var cancelBtn = document.getElementById('ioCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      hideImportPreview();
      notify('已取消导入，现有数据没动。');
    });

    var clearBtn = document.getElementById('btnClear');
    if (clearBtn) clearBtn.addEventListener('click', clearAllData);
  }

  function init() {
    if (WB.__booted) return;
    WB.__booted = true;

    bindNav();
    bindDataTools();
    renderDate();

    // 首次访问时落一条 meta（带 schemaVersion），后续导出/导入都靠它
    var meta = WB.storage.get('meta');
    if (!meta.createdAt) {
      meta.createdAt = Date.now();
      WB.storage.set('meta', meta);
    }

    // 首次使用时预置常用网站（只在 meta 里没标记过时才做）
    if (WB.links && WB.links.ensurePreset) WB.links.ensurePreset();

    refreshBoard();
    renderModules();
    document.addEventListener('workbench:data-changed', function () {
      refreshBoard();
      renderModules();
    });
  }

  function renderModules() {
    if (WB.todo && WB.todo.render) WB.todo.render();
    if (WB.notes && WB.notes.render) WB.notes.render();
    if (WB.links && WB.links.render) WB.links.render();
    if (WB.habits && WB.habits.render) WB.habits.render();
    if (WB.ledger && WB.ledger.render) WB.ledger.render();
    if (WB.ocr && WB.ocr.render) WB.ocr.render();
    if (WB.pomo && WB.pomo.render) WB.pomo.render();
  }

  // 统一导航：从待办跳到关联笔记，并高亮目标笔记
  function goToNote(noteId) {
    if (!noteId) return;
    switchView('note');
    if (WB.notes && WB.notes.focus) WB.notes.focus(noteId);
  }

  WB.app = {
    init: init,
    switchView: switchView,
    goToNote: goToNote,
    refreshBoard: refreshBoard,
    notify: notify
  };

  document.addEventListener('DOMContentLoaded', init);
})(window.WB);
