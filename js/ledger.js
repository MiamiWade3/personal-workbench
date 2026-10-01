/* ledger.js —— 记账模块（今日只做手动记账，不含 OCR）
 * 字段（PRD）：id, amount(整数分、恒为正), type(in|out), category, note(选填), createdAt, source
 * 本周按周一到周日计算；金额存整数分，展示两位小数（见 PRD「通用约定 · 金额」）
 * 本文件只挂函数 + render，不自行 init（启动由 app.js 负责）
 */
(function (WB) {
  var MODULE = 'ledger';
  var DAY = 86400000;

  // 预设分类，第一版不做自定义（PRD 第 6 节）
  var CATEGORIES = {
    out: ['餐饮', '交通', '购物', '居住', '通讯', '医疗', '学习', '娱乐', '其他'],
    in: ['工资', '奖金', '报销', '红包', '其他']
  };

  function list() {
    return WB.storage.get(MODULE);
  }

  function persist(items) {
    WB.storage.set(MODULE, items);
  }

  /* 金额校验：必须是大于 0 的数字，abc / 空 / 负数一律拒绝 */
  function parseAmount(input) {
    var raw = String(input === undefined || input === null ? '' : input).trim();
    if (!raw) return { ok: false, message: '金额不能为空。' };
    if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, message: '金额只能是数字，例如 12.5 或 12.50。' };
    var num = Number(raw);
    if (!isFinite(num) || num <= 0) return { ok: false, message: '金额必须是大于 0 的数字。' };
    var cents = Math.round(num * 100);
    if (cents <= 0) return { ok: false, message: '金额必须是大于 0 的数字。' };
    return { ok: true, cents: cents };
  }

  function add(type, amountInput, category, note, source) {
    var t = (type === 'in') ? 'in' : 'out';
    var money = parseAmount(amountInput);
    if (!money.ok) return { ok: false, message: money.message };
    var cat = String(category || '').trim();
    if (!cat) return { ok: false, message: '分类必填。' };
    if (CATEGORIES[t].indexOf(cat) < 0) return { ok: false, message: '分类不在预设列表里。' };

    var item = {
      id: WB.storage.newId(),
      amount: money.cents,
      type: t,
      category: cat,
      note: String(note || '').trim(),
      createdAt: Date.now(),
      source: (source === 'ocr') ? 'ocr' : 'manual'
    };
    var items = list();
    items.push(item);
    persist(items);
    return { ok: true, item: item };
  }

  function remove(id) {
    persist(list().filter(function (it) { return it.id !== id; }));
  }

  /* ---------- 本地时间范围 ---------- */

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function rangeToday() {
    var s = startOfDay(new Date());
    return { from: s, to: s + DAY - 1 };
  }

  function rangeWeek() {
    var n = new Date();
    var offset = (n.getDay() + 6) % 7; // 周一为一周起点
    var monday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - offset);
    var s = startOfDay(monday);
    return { from: s, to: s + 7 * DAY - 1 };
  }

  function rangeMonth() {
    var n = new Date();
    var s = new Date(n.getFullYear(), n.getMonth(), 1).getTime();
    var next = new Date(n.getFullYear(), n.getMonth() + 1, 1).getTime();
    return { from: s, to: next - 1 };
  }

  function sumIn(range, items, type) {
    var cents = 0;
    items.forEach(function (it) {
      if (it.type !== type) return;
      if (it.createdAt >= range.from && it.createdAt <= range.to) cents += it.amount;
    });
    return cents;
  }

  function sum(range) {
    var items = list();
    return { in: sumIn(range, items, 'in'), out: sumIn(range, items, 'out') };
  }

  function sums() {
    return { today: sum(rangeToday()), week: sum(rangeWeek()), month: sum(rangeMonth()) };
  }

  function formatTime(ms) {
    if (!ms) return '—';
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------- 渲染 ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function renderSummary() {
    var box = document.getElementById('ledgerSummary');
    if (!box) return;
    box.textContent = '';
    var s = sums();
    [['今日', s.today], ['本周', s.week], ['本月', s.month]].forEach(function (pair) {
      var cell = el('div', 'ledger-cell');
      cell.appendChild(el('div', 'ledger-cell-title', pair[0]));
      var rowIn = el('div', 'ledger-cell-row');
      rowIn.appendChild(el('span', 'ledger-tag is-in', '收'));
      rowIn.appendChild(el('span', 'ledger-num money', WB.storage.formatMoney(pair[1].in)));
      cell.appendChild(rowIn);
      var rowOut = el('div', 'ledger-cell-row');
      rowOut.appendChild(el('span', 'ledger-tag is-out', '支'));
      rowOut.appendChild(el('span', 'ledger-num money', WB.storage.formatMoney(pair[1].out)));
      cell.appendChild(rowOut);
      box.appendChild(cell);
    });
  }

  function renderList() {
    var ul = document.getElementById('ledgerList');
    var empty = document.getElementById('ledgerEmpty');
    if (!ul) return;
    ul.textContent = '';

    var items = list().slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (empty) empty.style.display = items.length === 0 ? '' : 'none';

    items.forEach(function (it) {
      var li = el('li', 'ledger-item');

      var main = el('div', 'link-main');
      main.appendChild(el('div', 'ledger-title', it.category + (it.note ? ' · ' + it.note : '')));
      main.appendChild(el('div', 'link-sub',
        formatTime(it.createdAt) + ' · ' + (it.source === 'ocr' ? '截图识别' : '手动')));
      li.appendChild(main);

      var amount = el('span', 'ledger-amount money ' + (it.type === 'in' ? 'is-in' : 'is-out'),
        (it.type === 'in' ? '+' : '-') + WB.storage.formatMoney(it.amount));
      li.appendChild(amount);

      var del = el('button', 'link-btn is-danger', '删除');
      del.type = 'button';
      del.addEventListener('click', function () {
        if (!window.confirm('删除这笔「' + it.category + ' ' +
          WB.storage.formatMoney(it.amount) + '」？')) return;
        remove(it.id);
      });
      li.appendChild(del);

      ul.appendChild(li);
    });
  }

  function renderCategories() {
    var type = document.getElementById('ledgerType');
    var cat = document.getElementById('ledgerCategory');
    if (!type || !cat) return;
    cat.textContent = '';
    CATEGORIES[type.value === 'in' ? 'in' : 'out'].forEach(function (name) {
      var opt = el('option', null, name);
      opt.value = name;
      cat.appendChild(opt);
    });
  }

  function bind() {
    var type = document.getElementById('ledgerType');
    if (type) {
      type.addEventListener('change', renderCategories);
    }

    var addBtn = document.getElementById('ledgerAdd');
    var hint = document.getElementById('ledgerHint');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        var res = add(
          document.getElementById('ledgerType').value,
          document.getElementById('ledgerAmount').value,
          document.getElementById('ledgerCategory').value,
          document.getElementById('ledgerNote').value
        );
        if (!res.ok) {
          if (hint) {
            hint.textContent = res.message;
            hint.className = 'detail-hint is-err';
          }
          return;
        }
        if (hint) {
          hint.textContent = '已记一笔。';
          hint.className = 'detail-hint is-ok';
        }
        document.getElementById('ledgerAmount').value = '';
        document.getElementById('ledgerNote').value = '';
        document.getElementById('ledgerAmount').focus();
      });
    }
  }

  function renderWithBind() {
    if (!WB.__ledgerBound) {
      bind();
      WB.__ledgerBound = true;
    }
    renderCategories();
    renderSummary();
    renderList();
  }

  WB.ledger = {
    MODULE: MODULE,
    CATEGORIES: CATEGORIES,
    list: list,
    add: add,
    remove: remove,
    parseAmount: parseAmount,
    sums: sums,
    formatTime: formatTime,
    render: renderWithBind
  };
})(window.WB);
