/* pomo.js —— 番茄钟（新模块，key = workbench.pomos）
 * 记录：{ id, minutes, startedAt, pausedMs, pausedAt, endedAt, status }
 * status：running | paused | done | abandoned
 * 剩余时间一律由 startedAt 计算，不靠计时器累加 —— 所以切页、刷新、休眠都不会归零
 * 今日完成数 / 累计分钟是每次现算的派生结果，不单独存（AGENTS：派生结果不重复存储）
 * 本文件只挂函数 + render，不自行 init（启动由 app.js 负责）
 */
(function (WB) {
  var MODULE = 'pomos';
  var MINUTE = 60000;
  var timer = null;
  var flashTimer = null;
  var baseTitle = document.title;

  function list() {
    return WB.storage.get(MODULE);
  }

  function persist(items) {
    WB.storage.set(MODULE, items);
  }

  function findActive() {
    var items = list();
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].status === 'running' || items[i].status === 'paused') return items[i];
    }
    return null;
  }

  function saveRecord(rec) {
    var items = list();
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].id === rec.id) { items[i] = rec; break; }
    }
    persist(items);
  }

  /* ---------- 时间计算 ---------- */

  function elapsedMs(rec) {
    var now = Date.now();
    var e = now - rec.startedAt - (rec.pausedMs || 0);
    if (rec.status === 'paused' && rec.pausedAt) e -= (now - rec.pausedAt);
    return e < 0 ? 0 : e;
  }

  function remainingMs(rec) {
    var left = rec.minutes * MINUTE - elapsedMs(rec);
    return left < 0 ? 0 : left;
  }

  function formatClock(ms) {
    var total = Math.ceil(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(m) + ':' + p(s);
  }

  function formatTime(ms) {
    if (!ms) return '—';
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function startOfToday() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  }

  /* ---------- 动作 ---------- */

  function start(minutes) {
    if (findActive()) return { ok: false, message: '已经有一轮在进行中，先结束它。' };
    var rec = {
      id: WB.storage.newId(),
      minutes: (Number(minutes) === 45) ? 45 : 25,
      startedAt: Date.now(),
      pausedMs: 0,
      pausedAt: null,
      endedAt: null,
      status: 'running'
    };
    var items = list();
    items.push(rec);
    persist(items);
    startLoop();
    return { ok: true, item: rec };
  }

  function pause() {
    var rec = findActive();
    if (!rec || rec.status !== 'running') return false;
    rec.status = 'paused';
    rec.pausedAt = Date.now();
    saveRecord(rec);
    return true;
  }

  function resume() {
    var rec = findActive();
    if (!rec || rec.status !== 'paused') return false;
    rec.pausedMs += Date.now() - rec.pausedAt;
    rec.pausedAt = null;
    rec.status = 'running';
    saveRecord(rec);
    startLoop();
    return true;
  }

  function giveUp() {
    var rec = findActive();
    if (!rec) return false;
    rec.status = 'abandoned';
    rec.endedAt = Date.now();
    saveRecord(rec);
    stopLoop();
    return true;
  }

  function finish(rec) {
    rec.status = 'done';
    rec.endedAt = Date.now();
    saveRecord(rec);
    stopLoop();
    flashTitle();
  }

  function flashTitle() {
    document.title = '⏰ 这一轮结束了 · 个人学习生活工作台';
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { document.title = baseTitle; }, 5000);
  }

  /* ---------- 每秒走一步 ---------- */

  function startLoop() {
    stopLoop();
    timer = setInterval(function () {
      var rec = findActive();
      if (!rec) { stopLoop(); return; }
      if (remainingMs(rec) <= 0) {
        finish(rec);
        if (WB.app && WB.app.notify) WB.app.notify('这一轮结束了，休息一下。', 'ok');
      }
      render();
    }, 1000);
  }

  function stopLoop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  /* ---------- 渲染 ---------- */

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function todayRecords() {
    var from = startOfToday();
    return list().filter(function (r) { return r.startedAt >= from; })
      .sort(function (a, b) { return b.startedAt - a.startedAt; });
  }

  function renderCurrent() {
    var time = document.getElementById('pomoTime');
    var state = document.getElementById('pomoState');
    var startBtn = document.getElementById('pomoStart');
    var pauseBtn = document.getElementById('pomoPause');
    var giveUpBtn = document.getElementById('pomoGiveUp');
    var sel = document.getElementById('pomoMinutes');

    var rec = findActive();
    if (!rec) {
      if (time) time.textContent = (sel && sel.value ? sel.value : '25') + ':00';
      if (state) state.textContent = '还没开始';
      if (startBtn) { startBtn.hidden = false; startBtn.textContent = '开始'; }
      if (pauseBtn) pauseBtn.hidden = true;
      if (giveUpBtn) giveUpBtn.hidden = true;
      if (sel) sel.disabled = false;
      return;
    }
    if (time) time.textContent = formatClock(remainingMs(rec));
    if (state) {
      state.textContent = rec.status === 'paused'
        ? '已暂停（' + rec.minutes + ' 分钟）'
        : '专注中（' + rec.minutes + ' 分钟）';
    }
    if (startBtn) startBtn.hidden = true;
    if (pauseBtn) {
      pauseBtn.hidden = false;
      pauseBtn.textContent = rec.status === 'paused' ? '继续' : '暂停';
    }
    if (giveUpBtn) giveUpBtn.hidden = false;
    if (sel) sel.disabled = true;
  }

  function renderToday() {
    var records = todayRecords();
    var done = records.filter(function (r) { return r.status === 'done'; });
    var minutes = 0;
    done.forEach(function (r) { minutes += r.minutes; });

    var count = document.getElementById('pomoDoneCount');
    if (count) count.textContent = String(done.length);
    var total = document.getElementById('pomoTotalMin');
    if (total) total.textContent = String(minutes);

    var ul = document.getElementById('pomoList');
    var empty = document.getElementById('pomoEmpty');
    if (!ul) return;
    ul.textContent = '';
    if (empty) empty.style.display = records.length === 0 ? '' : 'none';

    var label = { running: '进行中', paused: '已暂停', done: '已完成', abandoned: '已放弃' };
    records.forEach(function (r) {
      var li = el('li', 'pomo-item');
      var main = el('div', 'link-main');
      main.appendChild(el('div', 'pomo-title', r.minutes + ' 分钟 · ' + (label[r.status] || r.status)));
      main.appendChild(el('div', 'link-sub', '开始 ' + formatTime(r.startedAt) +
        (r.endedAt ? ' · 结束 ' + formatTime(r.endedAt) : '')));
      li.appendChild(main);
      ul.appendChild(li);
    });
  }

  function render() {
    renderCurrent();
    renderToday();
  }

  function bind() {
    var startBtn = document.getElementById('pomoStart');
    if (startBtn) {
      startBtn.addEventListener('click', function () {
        var sel = document.getElementById('pomoMinutes');
        var res = start(sel ? sel.value : 25);
        if (!res.ok && WB.app && WB.app.notify) WB.app.notify(res.message, 'err');
        render();
      });
    }

    var pauseBtn = document.getElementById('pomoPause');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', function () {
        var rec = findActive();
        if (!rec) return;
        if (rec.status === 'paused') resume(); else pause();
        render();
      });
    }

    var giveUpBtn = document.getElementById('pomoGiveUp');
    if (giveUpBtn) {
      giveUpBtn.addEventListener('click', function () {
        if (!window.confirm('放弃这一轮？这一轮不会计入今日完成数。')) return;
        giveUp();
        render();
      });
    }

    var sel = document.getElementById('pomoMinutes');
    if (sel) {
      sel.addEventListener('change', function () {
        if (!findActive()) renderCurrent();
      });
    }
  }

  function renderWithBind() {
    if (!WB.__pomoBound) {
      bind();
      WB.__pomoBound = true;
    }
    var rec = findActive();
    if (rec && rec.status === 'running') startLoop();
    render();
  }

  WB.pomo = {
    MODULE: MODULE,
    list: list,
    start: start,
    pause: pause,
    resume: resume,
    giveUp: giveUp,
    remainingMs: remainingMs,
    formatClock: formatClock,
    todayRecords: todayRecords,
    render: renderWithBind
  };
})(window.WB);
