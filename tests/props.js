// 屬性測試：直接從 index.html 抽出原始函式（不複製、不改寫），用隨機輸入檢查不變量。
const fs = require('fs');
const SRC = fs.readFileSync(require('path').resolve(__dirname, '..', 'index.html'), 'utf8');

function extract(name) {
  const start = SRC.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('找不到函式 ' + name);
  let i = SRC.indexOf('{', start), depth = 0;
  for (; i < SRC.length; i++) { if (SRC[i] === '{') depth++; else if (SRC[i] === '}' && --depth === 0) break; }
  return SRC.slice(start + 1, i + 1);
}
const NAMES = ['pad', 'ymd', 'money', 'signed', 'applyLocal', 'applyFix', 'starTotal', 'balance', 'taskDone'];
function makeEnv() {
  const body = 'var C = {}, OUT = [], STORE = {};\n' +
    'function lsSet(k, v) { STORE[k] = JSON.stringify(v); }\nfunction K(k) { return "demo_" + k; }\n' +
    NAMES.map(extract).join('\n') +
    '\nreturn { set C(v) { C = v; }, get C() { return C; }, set OUT(v) { OUT = v; }, get OUT() { return OUT; }, STORE: STORE, ' +
    NAMES.map(n => n + ': ' + n).join(', ') + ' };';
  return new Function(body)();
}

// 可重現的亂數
let seed = Number(process.env.SEED || 20261118);
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = a => a[ri(0, a.length - 1)];

const results = [];
function prop(name, runs, fn) {
  let fail = null;
  for (let k = 0; k < runs && !fail; k++) { try { const r = fn(k); if (r !== true) fail = r; } catch (e) { fail = 'throw: ' + e.message; } }
  results.push((fail ? 'FAIL ' : 'PASS ') + name + ' (' + runs + ' runs)' + (fail ? '\n     反例：' + fail : ''));
}

const env = makeEnv();
const today = env.ymd(new Date());

// ---------- money() ----------
const edge = [0, -0, 1, -1, 999, 1000, -1000, 999999, 1000000, -1234567, 2147483647, -2147483648, 0.5, -0.5, 1.5, 999.5, 1e15];
prop('money：往返一致（去掉逗號 = Math.round(n)）', 2000, k => {
  const n = k < edge.length ? edge[k] : (rnd() < 0.5 ? ri(-1e9, 1e9) : (rnd() - 0.5) * Math.pow(10, ri(0, 12)));
  const s = env.money(n), back = Number(s.replace(/,/g, ''));
  return back === Math.round(n) || Object.is(back, -0) && Math.round(n) === 0 ? true : `money(${n}) = "${s}"，還原為 ${back}，應為 ${Math.round(n)}`;
});
prop('money：格式為每三位一個逗號', 2000, k => {
  const n = k < edge.length ? edge[k] : ri(-1e12, 1e12);
  const s = env.money(n);
  return /^-?\d{1,3}(,\d{3})*$/.test(s) ? true : `money(${n}) = "${s}"`;
});
prop('money：非數字輸入不會壞掉，顯示 0', 6, k => {
  const s = env.money([undefined, null, '', 'abc', NaN, {}][k]);
  return s === '0' ? true : `得到 "${s}"`;
});

// ---------- 記帳：applyLocal（模擬模式直接套用） ----------
function randLedger(i) { return { kind: 'ledger', id: 'L' + i, date: today, type: pick(['支出', '收入']), desc: pick(['零食', '文具', '紅包']), amt: ri(1, 5000) }; }
prop('記帳不變量：餘額 = 初始值 + Σ收入 − Σ支出，且等於明細加總', 500, () => {
  const init = ri(0, 10000);
  env.C = { ledgerBalance: init, ledger: [] }; env.OUT = [];
  let expect = init;
  const n = ri(0, 40);
  for (let i = 0; i < n; i++) { const e = randLedger(i); env.applyLocal(e); expect += e.type === '支出' ? -e.amt : e.amt; }
  const sumRows = env.C.ledger.reduce((s, r) => s + env.signed(r), 0);
  if (env.C.ledgerBalance !== expect) return `餘額 ${env.C.ledgerBalance}，應為 ${expect}`;
  if (env.C.ledgerBalance !== init + sumRows) return `餘額與明細不一致`;
  return true;
});

// ---------- 記帳：balance() 用待上傳佇列 OUT 計算 ----------
prop('待上傳佇列：balance() = 雲端餘額 + 佇列內收支', 500, () => {
  const init = ri(0, 10000);
  env.C = { ledgerBalance: init }; env.OUT = [];
  let expect = init;
  for (let i = 0, n = ri(0, 30); i < n; i++) {
    const e = rnd() < 0.7 ? randLedger(i) : { kind: 'star', id: 'S' + i, n: ri(-5, 5), type: 'task', ref: today + '|x' };
    env.OUT.push(e);
    if (e.kind === 'ledger') expect += e.type === '支出' ? -e.amt : e.amt;
  }
  return env.balance() === expect ? true : `balance()=${env.balance()}，應為 ${expect}`;
});

// ---------- 修正記帳：applyFix ----------
prop('修正記帳：改成同樣內容 → 餘額不變；改完再改回 → 回到原值', 500, () => {
  env.C = { ledgerBalance: ri(0, 5000), ledger: [] }; env.OUT = [];
  for (let i = 0, n = ri(1, 20); i < n; i++) env.applyLocal(randLedger(i));
  const before = env.C.ledgerBalance, row = pick(env.C.ledger), orig = { type: row.type, desc: row.desc, amt: row.amt };
  env.applyFix({ op: 'edit', target: row.id, type: orig.type, desc: orig.desc, amt: orig.amt });
  if (env.C.ledgerBalance !== before) return `原樣修改後餘額 ${before} → ${env.C.ledgerBalance}`;
  env.applyFix({ op: 'edit', target: row.id, type: pick(['支出', '收入']), desc: 'x', amt: ri(1, 9999) });
  env.applyFix({ op: 'edit', target: row.id, type: orig.type, desc: orig.desc, amt: orig.amt });
  return env.C.ledgerBalance === before ? true : `改來改去後餘額 ${before} → ${env.C.ledgerBalance}`;
});
prop('修正記帳：刪除 → 餘額 = 初始值 + 剩餘明細加總', 500, () => {
  const init = ri(0, 5000);
  env.C = { ledgerBalance: init, ledger: [] }; env.OUT = [];
  for (let i = 0, n = ri(1, 20); i < n; i++) env.applyLocal(randLedger(i));
  for (let d = 0, m = ri(1, env.C.ledger.length); d < m; d++) env.applyFix({ op: 'delete', target: pick(env.C.ledger).id });
  const rest = env.C.ledger.reduce((s, r) => s + env.signed(r), 0);
  return env.C.ledgerBalance === init + rest ? true : `餘額 ${env.C.ledgerBalance}，應為 ${init + rest}`;
});
prop('修正記帳：找不到的 id → 什麼都不改', 200, () => {
  env.C = { ledgerBalance: 100, ledger: [] };
  for (let i = 0; i < 5; i++) env.applyLocal(randLedger(i));
  const snap = JSON.stringify(env.C);
  env.applyFix({ op: pick(['edit', 'delete']), target: 'nope', type: '收入', desc: 'x', amt: 50 });
  return JSON.stringify(env.C) === snap ? true : '資料被改了';
});

// ---------- 星星與任務 ----------
prop('任務：完成後取消 → 星星回到原值、任務變回未完成（模擬模式 applyLocal）', 500, () => {
  const init = ri(0, 500), name = pick(['寫功課', '喝水', '閱讀 20 分鐘']), n = ri(1, 5);
  env.C = { starTotal: init, date: today, taskNet: {} }; env.OUT = [];
  const ref = today + '|' + name;
  env.applyLocal({ kind: 'star', id: 'a', n: n, type: 'task', ref: ref });
  if (!env.taskDone(name)) return '完成後 taskDone 應為 true';
  env.applyLocal({ kind: 'star', id: 'b', n: -n, type: 'untask', ref: ref });
  if (env.taskDone(name)) return '取消後 taskDone 應為 false';
  return env.C.starTotal === init ? true : `星星 ${init} → ${env.C.starTotal}`;
});
prop('任務：隨機完成／取消序列 → starTotal() 與 taskDone() 跟佇列一致（正式模式 OUT）', 500, () => {
  const init = ri(0, 500), names = ['A', 'B', 'C'];
  env.C = { starTotal: init, date: today, taskNet: {} }; env.OUT = [];
  const done = {}; let expect = init;
  for (let i = 0, m = ri(0, 40); i < m; i++) {
    const nm = pick(names), ref = today + '|' + nm, n = ri(1, 4);
    if (done[nm]) { env.OUT.push({ kind: 'star', id: 'u' + i, n: -done[nm], type: 'untask', ref: ref }); expect -= done[nm]; delete done[nm]; }
    else { env.OUT.push({ kind: 'star', id: 't' + i, n: n, type: 'task', ref: ref }); expect += n; done[nm] = n; }
  }
  if (env.starTotal() !== expect) return `starTotal()=${env.starTotal()}，應為 ${expect}`;
  for (const nm of names) if (env.taskDone(nm) !== !!done[nm]) return `任務 ${nm} 狀態錯誤`;
  return true;
});
prop('任務：昨天的雲端完成紀錄不會算成今天完成', 100, () => {
  env.C = { starTotal: 10, date: '2000-01-01', taskNet: { A: 1 } }; env.OUT = [];
  return env.taskDone('A') === false ? true : '舊日期的 taskNet 被當成今天';
});

// ---------- 冪等性（已知行為，不算失敗） ----------
// 前端 applyLocal 不依事件 id 去重：同一筆套用兩次會重複記帳。
// 目前沒有任何操作會把同一個 id 送進 addEvent 兩次，所以不是現存 bug；
// 正式模式重送時的去重由 Apps Script 依 id 負責（後端不在 repo，無法在此驗證）。
// 若哪天前端加上去重，這裡會印出提醒，屆時把它改成一般的 prop()。
{
  env.C = { ledgerBalance: 100, ledger: [] };
  const e = randLedger(1);
  env.applyLocal(e); const once = env.C.ledgerBalance;
  env.applyLocal(e);
  results.push(env.C.ledgerBalance === once
    ? 'INFO 已知行為改變了：applyLocal 現在會依 id 去重，請把這段改成一般的冪等性測試'
    : `INFO 已知：applyLocal 不依 id 去重（套用兩次 ${once} → ${env.C.ledgerBalance}），重送去重靠後端`);
}

console.log(results.join('\n'));
const counted = results.filter(r => !r.startsWith('INFO')), failed = counted.filter(r => r.startsWith('FAIL')).length;
console.log('\n' + (counted.length - failed) + ' / ' + counted.length + ' 通過（SEED=' + (process.env.SEED || 20261118) + '）');
process.exitCode = failed ? 1 : 0;
