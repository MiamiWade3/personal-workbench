/* storage.js —— 唯一的 localStorage 读写入口
 * 加载顺序：本文件必须最先引入（app.js 最后引入）
 * 约定见 AGENTS.md「localStorage keys」与 PRD.md「通用约定」
 */
window.WB = window.WB || {};

(function (WB) {
  var SCHEMA_VERSION = 1;

  var KEYS = {
    todos: 'workbench.todos',
    notes: 'workbench.notes',
    links: 'workbench.links',
    snippets: 'workbench.snippets',
    ledger: 'workbench.ledger',
    habits: 'workbench.habits',
    pomos: 'workbench.pomos',
    meta: 'workbench.meta'
  };

  var DEFAULTS = {
    todos: [],
    notes: [],
    links: [],
    snippets: [],
    ledger: [],
    habits: { records: [], targets: [] },
    pomos: [],
    meta: { schemaVersion: SCHEMA_VERSION, createdAt: null, linksInitialized: false }
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // 校验：类型必须与默认值一致（数组对数组、对象对对象），否则视为损坏
  function isUsable(value, fallback) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(fallback)) return Array.isArray(value);
    if (typeof fallback === 'object') return typeof value === 'object' && !Array.isArray(value);
    return typeof value === typeof fallback;
  }

  function get(module) {
    var key = KEYS[module];
    var fallback = DEFAULTS[module];
    if (!key || fallback === undefined) {
      console.warn('[storage] 未知模块：' + module);
      return null;
    }
    var raw = null;
    try {
      raw = localStorage.getItem(key);
    } catch (err) {
      console.warn('[storage] 读不到 ' + key + '（本地存储不可用）：' + err.message);
      return clone(fallback);
    }
    if (raw === null) return clone(fallback);

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // 损坏的 JSON：只警告，不删除原值，返回安全默认值，保证不白屏
      console.warn('[storage] ' + key + ' 内容损坏，已按默认值渲染：' + err.message);
      return clone(fallback);
    }
    if (!isUsable(parsed, fallback)) {
      console.warn('[storage] ' + key + ' 结构不对，已按默认值渲染');
      return clone(fallback);
    }
    return parsed;
  }

  function set(module, value) {
    var key = KEYS[module];
    if (!key) {
      console.warn('[storage] 未知模块：' + module);
      return false;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[storage] 写不进 ' + key + '：' + err.message);
      return false;
    }
    document.dispatchEvent(new CustomEvent('workbench:data-changed', { detail: { module: module } }));
    return true;
  }

  function remove(module) {
    var key = KEYS[module];
    if (!key) return false;
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn('[storage] 删不掉 ' + key + '：' + err.message);
      return false;
    }
    document.dispatchEvent(new CustomEvent('workbench:data-changed', { detail: { module: module } }));
    return true;
  }

  // 只清理本项目约定的 workbench.* key；禁止使用 localStorage.clear()
  function clearAll() {
    var removed = 0;
    try {
      Object.keys(localStorage)
        .filter(function (k) { return k.indexOf('workbench.') === 0; })
        .forEach(function (k) {
          localStorage.removeItem(k);
          removed += 1;
        });
      // 清完留一条 meta（不含业务数据）：标记已初始化，避免预置网站下次打开时又长回来
      localStorage.setItem(KEYS.meta, JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        createdAt: Date.now(),
        linksInitialized: true
      }));
    } catch (err) {
      console.warn('[storage] 清空失败：' + err.message);
      return 0;
    }
    document.dispatchEvent(new CustomEvent('workbench:data-changed', { detail: { module: 'all' } }));
    return removed;
  }

  function newId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (err) {
      // 某些浏览器在非安全上下文下会抛错，走兜底
    }
    return String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // 金额：存整数分，展示除以 100 保留两位小数（见 PRD「通用约定 · 金额」）
  function formatMoney(cents) {
    var n = Number(cents);
    if (!isFinite(n)) n = 0;
    return (n / 100).toFixed(2);
  }

  function parseMoney(yuan) {
    var n = Number(yuan);
    if (!isFinite(n)) return 0;
    return Math.round(n * 100);
  }

  /* ---------- 导出 / 导入（备份与恢复） ---------- */

  var MODULES = ['todos', 'notes', 'links', 'snippets', 'ledger', 'habits', 'pomos'];

  function exportData() {
    var data = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString()
    };
    data.meta = get('meta');
    MODULES.forEach(function (m) { data[m] = get(m); });
    return data; // 只含纯数据，不含图片 / base64
  }

  // 校验：只看结构和版本，不写任何东西
  function validateImport(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, message: '文件内容不是一个 JSON 对象。' };
    }
    if (obj.schemaVersion !== SCHEMA_VERSION) {
      return {
        ok: false,
        message: '版本不匹配：文件是 v' + obj.schemaVersion + '，当前程序是 v' + SCHEMA_VERSION + '。'
      };
    }
    var missing = [];
    MODULES.forEach(function (m) {
      if (m === 'habits') {
        if (!obj.habits || !Array.isArray(obj.habits.records) || !Array.isArray(obj.habits.targets)) {
          missing.push(m);
        }
      } else if (!Array.isArray(obj[m])) {
        // pomos 是后来加的模块，旧版导出文件里没有，兼容为 0 条
        if (m === 'pomos' && obj[m] === undefined) return;
        missing.push(m);
      }
    });
    if (missing.length) {
      return { ok: false, message: '结构不对，缺少或格式错误的数据：' + missing.join('、') + '。' };
    }

    var counts = {};
    MODULES.forEach(function (m) {
      counts[m] = (m === 'habits') ? obj.habits.records.length
        : (Array.isArray(obj[m]) ? obj[m].length : 0);
    });
    return { ok: true, counts: counts, exportedAt: obj.exportedAt || '' };
  }

  // 覆盖式导入：调用前必须先让用户确认
  function importData(obj) {
    var failed = [];
    MODULES.forEach(function (m) {
      var value = (obj[m] === undefined) ? DEFAULTS[m] : obj[m];
      if (!set(m, value)) failed.push(m);
    });
    if (!set('meta', obj.meta || DEFAULTS.meta)) failed.push('meta');
    if (failed.length) {
      return { ok: false, message: '部分数据写入失败：' + failed.join('、') + '。原有数据未受影响的部分可能已改变，建议重新导出核对。' };
    }
    return { ok: true };
  }

  WB.storage = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    KEYS: KEYS,
    DEFAULTS: DEFAULTS,
    MODULES: MODULES,
    get: get,
    set: set,
    remove: remove,
    clearAll: clearAll,
    newId: newId,
    formatMoney: formatMoney,
    parseMoney: parseMoney,
    exportData: exportData,
    validateImport: validateImport,
    importData: importData
  };
})(window.WB);
