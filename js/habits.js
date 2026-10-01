/* habits.js —— 打卡模块
 * 四种固定：喝水(多次) / 运动(一次) / 学习(多次) / 工作(一次)，不让增删
 * 数据（PRD）：记录 { id, kind, date, count, updatedAt }；目标 { kind, targetType, targetValue, updatedAt }
 * 周期：每日 = 本地自然日；每周 = 周一 00:00 起算的新周期。历史周期数据只累加不删除
 * 本文件只挂函数 + render，不自行 init（启动由 app.js 负责）
 */
(function (WB) {
  var MODULE = 'habits';
  var DAY = 86400000;

  var KINDS = {
    water: { label: '喝水', mode: 'multi', unit: '杯', order: 1, defaultTarget: 8 },
    move: { label: '运动', mode: 'once', unit: '次', order: 2, defaultTarget: 1 },
    study: { label: '学习', mode: 'multi', unit: '分钟', order: 3, defaultTarget: 60 },
    work: { label: '工作', mode: 'once', unit: '次', order: 4, defaultTarget: 1 }
  };
  var ORDER = ['water', 'move', 'study', 'work'];

  function load() {
    var data = WB.storage.get(MODULE);
    if (!data || !Array.isArray(data.records)) data.records = [];
    if (!Array.isArray(data.targets)) data.targets = [];
    return data;
  }

  function save(data) {
    WB.storage.set(MODULE, data);
  }

  /* ---------- 本地日期 ---------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function todayKey() {
    return dateKey(new Date());
  }

  // 本周一 00:00 对应的日期串（周一为一周起点）
  function weekStartKey() {
    var n = new Date();
    var offset = (n.getDay() + 6) % 7; // 周日=0 时回退 6 天
    return dateKey(new Date(n.getFullYear(), n.getMonth(), n.getDate() - offset));
  }

  function weekDates() {
    var start = weekStartKey();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
    var base = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var out = [];
    for (var i = 0; i < 7; i += 1) {
      out.push(dateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)));
    }
    return out;
  }

  /* ---------- 目标 ---------- */

  function getTarget(kind, data) {
    var d = data || load();
    for (var i = 0; i < d.targets.length; i += 1) {
      if (d.targets[i].kind === kind) return d.targets[i];
    }
    return { kind: kind, targetType: 'daily', targetValue: KINDS[kind].defaultTarget, updatedAt: null };
  }

  function setTarget(kind, targetType, targetValue) {
    var data = load();
    var value = KINDS[kind].mode === 'once' ? 1 : Math.max(1, Math.floor(Number(targetValue) || 1));
    var found = null;
    data.targets.forEach(function (t) { if (t.kind === kind) found = t; });
    if (found) {
      found.targetType = targetType;
      found.targetValue = value;
      found.updatedAt = Date.now();
    } else {
      data.targets.push({ kind: kind, targetType: targetType, targetValue: value, updatedAt: Date.now() });
    }
    save(data);
  }

  /* ---------- 记录 ---------- */

  function recordFor(kind, date, data) {
    for (var i = 0; i < data.records.length; i += 1) {
      if (data.records[i].kind === kind && data.records[i].date === date) return data.records[i];
    }
    return null;
  }

  function progress(kind) {
    var data = load();
    var target = getTarget(kind, data);
    if (target.targetType === 'weekly') {
      var days = weekDates();
      var sum = 0;
      data.records.forEach(function (r) {
        if (r.kind === kind && days.indexOf(r.date) >= 0) sum += r.count;
      });
      return sum;
    }
    var rec = recordFor(kind, todayKey(), data);
    return rec ? rec.count : 0;
  }

  /* 多次型：+1，到目标就停；一次型：在完成 / 未完成之间切换 */
  function bump(kind) {
    var cfg = KINDS[kind];
    var data = load();
    var target = getTarget(kind, data);
    var date = todayKey();
    var rec = recordFor(kind, date, data);

    if (cfg.mode === 'once') {
      var next = rec && rec.count >= 1 ? 0 : 1;
      if (rec) {
        rec.count = next;
        rec.updatedAt = Date.now();
      } else {
        data.records.push({ id: WB.storage.newId(), kind: kind, date: date, count: next, updatedAt: Date.now() });
      }
      save(data);
      return;
    }

    var current = progress(kind);
    if (current >= target.targetValue) return; // 已达标，不再增加
    if (rec) {
      rec.count += 1;
      rec.updatedAt = Date.now();
    } else {
      data.records.push({ id: WB.storage.newId(), kind: kind, date: date, count: 1, updatedAt: Date.now() });
    }
    save(data);
  }

  // 多次型回退：只减「今天」这条记录，减到 0 就删掉这条记录（历史周期的数据不受影响）
  function minus(kind) {
    var data = load();
    var rec = recordFor(kind, todayKey(), data);
    if (!rec || rec.count <= 0) return false;
    rec.count -= 1;
    rec.updatedAt = Date.now();
    if (rec.count === 0) {
      data.records = data.records.filter(function (r) { return r !== rec; });
    }
    save(data);
    return true;
  }

  // 今天这一天记了多少（周目标时用来判断能不能减）
  function todayCount(kind) {
    var rec = recordFor(kind, todayKey(), load());
    return rec ? rec.count : 0;
  }

  /* ---------- 状态（供看板与页面共用） ---------- */

  function status(kind) {
    var cfg = KINDS[kind];
    var target = getTarget(kind);
    var current = progress(kind);
    var goal = cfg.mode === 'once' ? 1 : target.targetValue;
    return {
      kind: kind,
      label: cfg.label,
      unit: cfg.unit,
      mode: cfg.mode,
      targetType: target.targetType,
      targetValue: goal,
      current: current,
      todayCount: todayCount(kind),
      done: current >= goal,
      periodLabel: target.targetType === 'weekly' ? '本周（' + weekStartKey() + ' 起）' : '今日'
    };
  }

  function allStatus() {
    return ORDER.map(status);
  }

  function doneCount() {
    return allStatus().filter(function (s) { return s.done; }).length;
  }

  /* ---------- 渲染 ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function renderGrid() {
    var grid = document.getElementById('habitGrid');
    if (!grid) return;
    grid.textContent = '';

    allStatus().forEach(function (s) {
      var card = el('div', 'habit-card' + (s.done ? ' is-done' : ''));

      var head = el('div', 'habit-head');
      head.appendChild(el('div', 'habit-name', s.label));
      head.appendChild(el('div', 'habit-period', s.periodLabel));
      card.appendChild(head);

      card.appendChild(el('div', 'habit-progress',
        s.mode === 'once'
          ? (s.done ? '已完成' : '未完成')
          : s.current + ' / ' + s.targetValue + ' ' + s.unit));

      var bar = el('div', 'bar');
      var fill = el('span', 'bar-fill');
      var pct = s.targetValue === 0 ? 0 : Math.min(100, (s.current / s.targetValue) * 100);
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      card.appendChild(bar);

      card.appendChild(el('div', 'habit-state', s.done ? '已达标' : '还没达标'));

      var actions = el('div', 'habit-actions');
      if (s.mode === 'once') {
        var onceBtn = el('button', 'habit-btn', s.done ? '取消完成' : '完成');
        onceBtn.type = 'button';
        onceBtn.addEventListener('click', function () { bump(s.kind); });
        actions.appendChild(onceBtn);
      } else {
        var plus = el('button', 'habit-btn', '+1');
        plus.type = 'button';
        if (s.done) {
          plus.disabled = true;
          plus.className = 'habit-btn is-disabled';
          plus.title = '已达到目标，不再累加';
        } else {
          plus.addEventListener('click', function () { bump(s.kind); });
        }
        actions.appendChild(plus);

        var back = el('button', 'habit-btn', '−1');
        back.type = 'button';
        if (s.todayCount <= 0) {
          back.disabled = true;
          back.className = 'habit-btn is-disabled';
          back.title = '今天还没有记录，没得减';
        } else {
          back.addEventListener('click', function () { minus(s.kind); });
        }
        actions.appendChild(back);
      }
      card.appendChild(actions);

      var setting = el('div', 'habit-setting');
      var typeSel = el('select', 'habit-select');
      [['daily', '每日'], ['weekly', '每周']].forEach(function (opt) {
        var o = el('option', null, opt[1]);
        o.value = opt[0];
        if (opt[0] === s.targetType) o.selected = true;
        typeSel.appendChild(o);
      });
      typeSel.addEventListener('change', function () {
        setTarget(s.kind, typeSel.value, numInput ? numInput.value : s.targetValue);
      });
      setting.appendChild(typeSel);

      if (s.mode === 'multi') {
        var numInput = el('input', 'habit-input');
        numInput.type = 'number';
        numInput.min = '1';
        numInput.value = String(s.targetValue);
        numInput.addEventListener('change', function () {
          setTarget(s.kind, typeSel.value, numInput.value);
        });
        setting.appendChild(numInput);
        setting.appendChild(el('span', 'habit-unit', s.unit));
      } else {
        setting.appendChild(el('span', 'habit-unit', '一次完成，目标固定为 1'));
      }
      card.appendChild(setting);

      grid.appendChild(card);
    });
  }

  function renderWithBind() {
    renderGrid();
  }

  WB.habits = {
    MODULE: MODULE,
    KINDS: KINDS,
    kinds: function () { return ORDER.slice(); },
    status: status,
    allStatus: allStatus,
    doneCount: doneCount,
    bump: bump,
    minus: minus,
    todayCount: todayCount,
    setTarget: setTarget,
    progress: progress,
    todayKey: todayKey,
    weekStartKey: weekStartKey,
    render: renderWithBind
  };
})(window.WB);
