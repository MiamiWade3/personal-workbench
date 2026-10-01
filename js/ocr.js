/* ocr.js —— 账单截图识别（Tesseract.js，全部在浏览器本地跑）
 * 铁律（AGENTS）：识别结果必须弹确认卡，人工确认后才入账；不保存原图、不写 base64 到本地存储
 * 不用云端 OCR API、不用后端；图片只在当前浏览器里处理
 * 本文件只挂函数 + render，不自行 init（启动由 app.js 负责）
 */
(function (WB) {
  /* 锁定的版本与 CDN 地址（详见 README「OCR 版本与 CDN」） */
  var LIB_VERSION = '6.0.1';
  var CORE_VERSION = '6.1.2';
  var MAIN_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
  var WORKER_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js';
  var CORE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.1.2';
  var LANGS = 'chi_sim+eng';

  var ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
  var MAX_BYTES = 4 * 1024 * 1024; // 超过 4MB 提示压缩后重试

  var state = { busy: false, draft: null };
  var scriptPromise = null;

  /* ---------- 加载 Tesseract（只加载一次） ---------- */

  function loadScript() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = MAIN_URL;
      s.onload = function () { resolve(window.Tesseract); };
      s.onerror = function () { reject(new Error('识别模型加载失败，请检查网络后重试。')); };
      document.body.appendChild(s);
    });
    return scriptPromise;
  }

  /* ---------- 识别 ---------- */

  function recognize(file) {
    return loadScript().then(function (Tesseract) {
      return Tesseract.createWorker(LANGS, 1, {
        workerPath: WORKER_URL,
        corePath: CORE_URL
      }).then(function (worker) {
        return worker.recognize(file)
          .then(function (res) {
            var text = (res && res.data && res.data.text) || '';
            return worker.terminate().then(function () { return text; },
              function () { return text; });
          })
          .catch(function (err) {
            return worker.terminate().then(function () { throw err; },
              function () { throw err; });
          });
      });
    });
  }

  /* ---------- 从文本里抽金额 ---------- */

  var KEYWORDS = ['金额', '实付', '付款', '合计', '总计', '应付', '支付', '小计', '消费', '总额', '收款', '订单金额', '人民币'];

  function pickAmount(text) {
    var lines = String(text || '').split(/\r?\n/);
    var scored = [];

    lines.forEach(function (raw) {
      var line = String(raw).trim();
      if (!line) return;
      var score = 0;
      if (/[¥￥]/.test(line)) score += 5;
      if (/^[¥￥]\s*\d/.test(line.replace(/^\W+/, ''))) score += 3;
      KEYWORDS.forEach(function (k) { if (line.indexOf(k) >= 0) score += 3; });

      // 紧跟在 ¥ / ￥ 后面的数字，权重最高
      var after = line.match(/[¥￥]\s*(\d+(?:[.,]\d{1,2})?)/g) || [];
      after.forEach(function (m) {
        var v = Number(m.replace(/[¥￥\s]/g, '').replace(',', ''));
        if (isFinite(v) && v > 0) scored.push({ value: v, score: score + 8, line: line });
      });

      var nums = line.match(/\d+(?:[.,]\d{1,2})?/g) || [];
      nums.forEach(function (n) {
        var v = Number(String(n).replace(',', ''));
        if (!isFinite(v) || v <= 0 || v > 1000000) return;
        // 金额通常带小数；没有任何线索时，整数排后面一点
        var bonus = (String(n).indexOf('.') >= 0) ? 1 : -1;
        scored.push({ value: v, score: score + bonus, line: line });
      });
    });

    scored.sort(function (a, b) { return (b.score - a.score) || (b.value - a.value); });

    var seen = {};
    var candidates = [];
    scored.forEach(function (s) {
      if (seen[s.value]) return;
      seen[s.value] = true;
      candidates.push(s);
    });

    return {
      amount: candidates.length ? String(candidates[0].value) : '',
      candidates: candidates.slice(0, 3)
    };
  }

  function guessType(text) {
    return /退款|收入|工资|报销|入账/.test(String(text || '')) ? 'in' : 'out';
  }

  /* ---------- 界面 ---------- */

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function setStatus(message, kind) {
    var s = document.getElementById('ocrStatus');
    if (!s) return;
    s.textContent = message || '';
    s.className = 'ocr-status' + (kind ? ' is-' + kind : '');
  }

  function fillCategories(select, type, selected) {
    if (!select || !WB.ledger) return;
    select.textContent = '';
    WB.ledger.CATEGORIES[type === 'in' ? 'in' : 'out'].forEach(function (name) {
      var o = el('option', null, name);
      o.value = name;
      if (name === selected) o.selected = true;
      select.appendChild(o);
    });
  }

  function openConfirm(draft) {
    state.draft = draft;
    var card = document.getElementById('ocrCard');
    var hint = document.getElementById('ocrHint');
    var cand = document.getElementById('ocrCandidates');
    if (!card) return;

    document.getElementById('ocrType').value = draft.type;
    document.getElementById('ocrAmount').value = draft.amount || '';
    document.getElementById('ocrNote').value = draft.note || '';
    fillCategories(document.getElementById('ocrCategory'), draft.type, draft.category);

    if (!draft.amount) {
      hint.textContent = '没读到金额，请手填。';
      hint.className = 'detail-hint is-err';
    } else if (draft.candidates.length > 1) {
      hint.textContent = '识别到多个候选金额，以下是最可能的一个，请核对。';
      hint.className = 'detail-hint';
    } else {
      hint.textContent = '已填入识别结果，请核对后再入账。';
      hint.className = 'detail-hint';
    }

    cand.textContent = '';
    if (draft.candidates.length > 1) {
      draft.candidates.forEach(function (c) {
        cand.appendChild(el('span', 'ocr-candidate', String(c.value)));
      });
    }

    var raw = document.getElementById('ocrRaw');
    if (raw) raw.textContent = draft.text ? draft.text.slice(0, 200) : '（没有识别到文字）';

    card.hidden = false;
  }

  function closeConfirm() {
    var card = document.getElementById('ocrCard');
    if (card) card.hidden = true;
    state.draft = null;
  }

  function handleFile(file) {
    if (!file) return;
    if (ACCEPT.indexOf(file.type) < 0) {
      setStatus('只支持 jpg / png / webp 图片。', 'err');
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus('图片超过 4MB，请压缩后再试。', 'err');
      return;
    }
    if (state.busy) return;

    state.busy = true;
    setStatus('识别中…首次需要从 CDN 下载识别模型，可能要等一会儿。', '');

    var previewUrl = null; // 用完即释放
    try {
      previewUrl = URL.createObjectURL(file);
    } catch (err) {
      previewUrl = null;
    }

    recognize(file)
      .then(function (text) {
        var picked = pickAmount(text);
        openConfirm({
          type: guessType(text),
          amount: picked.amount,
          category: picked.amount ? guessCategory(text) : '',
          note: '',
          candidates: picked.candidates,
          text: text
        });
        setStatus(picked.amount ? '识别完成，请在确认卡里核对。' : '识别完成，但没读到金额，请手填。',
          picked.amount ? 'ok' : 'err');
      })
      .catch(function (err) {
        // 失败也开确认卡，让用户手填，不整页报错
        openConfirm({ type: 'out', amount: '', category: '', note: '', candidates: [], text: '' });
        setStatus('识别失败：' + (err && err.message ? err.message : '未知原因') + '，请手填。', 'err');
      })
      .then(function () {
        // 无论成败都释放临时 URL
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        state.busy = false;
      });
  }

  function guessCategory(text) {
    var map = [['餐饮', /餐饮|美食|外卖|餐厅|饭|咖啡|奶茶/], ['交通', /交通|地铁|打车|出行|加油|停车/], ['购物', /购物|超市|商城|便利店|淘宝|京东/], ['居住', /房租|水电|物业|燃气/], ['通讯', /话费|流量|宽带|通信/], ['医疗', /医院|药|门诊|体检/], ['学习', /图书|课程|学费|书店/], ['娱乐', /电影|游戏|演出|会员|视频/]];
    for (var i = 0; i < map.length; i += 1) {
      if (map[i][1].test(String(text || ''))) return map[i][0];
    }
    return '其他';
  }

  /* ---------- 事件绑定 ---------- */

  function bind() {
    var input = document.getElementById('ocrFile');
    if (input) {
      input.addEventListener('change', function () {
        handleFile(input.files && input.files[0]);
        input.value = '';
      });
    }

    // 先点一下记账页，再 Cmd/Ctrl+V 粘贴
    document.addEventListener('paste', function (e) {
      var view = document.getElementById('view-ledger');
      if (!view || !view.classList.contains('is-active')) return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i += 1) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          handleFile(items[i].getAsFile());
          e.preventDefault();
          return;
        }
      }
    });

    var typeSel = document.getElementById('ocrType');
    if (typeSel) {
      typeSel.addEventListener('change', function () {
        fillCategories(document.getElementById('ocrCategory'), typeSel.value, '');
      });
    }

    var confirmBtn = document.getElementById('ocrConfirmBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        var type = document.getElementById('ocrType').value;
        var amount = document.getElementById('ocrAmount').value;
        var category = document.getElementById('ocrCategory').value;
        var note = document.getElementById('ocrNote').value;
        if (!WB.ledger) return;
        var res = WB.ledger.add(type, amount, category, note, 'ocr');
        if (!res.ok) {
          setStatus(res.message, 'err');
          return;
        }
        closeConfirm();
        setStatus('已入账（来源：截图识别）。', 'ok');
      });
    }

    var cancelBtn = document.getElementById('ocrCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        closeConfirm();
        setStatus('已取消，没有入账。', '');
      });
    }
  }

  function renderWithBind() {
    if (!WB.__ocrBound) {
      bind();
      WB.__ocrBound = true;
    }
  }

  WB.ocr = {
    VERSION: LIB_VERSION,
    CORE_VERSION: CORE_VERSION,
    LANGS: LANGS,
    pickAmount: pickAmount,
    render: renderWithBind
  };
})(window.WB);
