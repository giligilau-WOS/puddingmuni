// E2E 冒煙測試：用 index.html?demo=1 的模擬模式（不連線、資料存 demo_ 前綴）走過主要流程。
// 執行：node tests/e2e-demo.js            （滑鼠點擊）
//       TOUCH=1 node tests/e2e-demo.js    （iPad 觸控，走 fastTap 路徑）
const path = require('path');
const { chromium, devices } = require('playwright');

const URL = 'file://' + (process.env.DEMO_FILE || path.resolve(__dirname, '..', 'index.html')) + '?demo=1';
const IPAD = devices['iPad (gen 7)'];   // 注意：Playwright 沒有 'iPad Air'，寫錯會變成一般桌面瀏覽器
const results = [];
function ok(name, cond, detail) { results.push((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); }

// 基德對話框、真相之門會隨時間自己跳出來（模擬模式時間快 60 倍），每次點擊前先關掉。
// 注意：#rpg 是 position: fixed，不能用 offsetParent 判斷是否顯示。
async function clearOverlays(p) {
  for (let i = 0; i < 15; i++) {
    const st = await p.evaluate(() => {
      const vis = id => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0 ? 1 : 0; };
      return { rpg: vis('rpg'), door: vis('door') };
    });
    if (!st.rpg && !st.door) return;
    if (st.door) { await p.click('#dstage', { force: true }); await p.waitForTimeout(400); continue; }
    const btns = await p.$$('#rpg [data-act]');
    if (btns.length) await btns[btns.length - 1].click({ force: true }); else await p.click('#rpg', { force: true });
    await p.waitForTimeout(400);
  }
}
async function tap(p, sel) {
  await clearOverlays(p);
  if (process.env.TOUCH) await p.tap(sel, { timeout: 4000 }); else await p.click(sel, { timeout: 4000 });
}
const stars = p => p.evaluate(() => parseInt(document.querySelector('.sbtn.shop b').textContent.replace(/\D/g, ''), 10));
const bal = p => p.evaluate(() => { const m = document.body.innerText.match(/目前存款\s*\$([\d,]+)/); return m ? parseInt(m[1].replace(/,/g, ''), 10) : NaN; });
const doneP = (p, n) => p.evaluate(n => { const e = document.querySelector('.task[data-arg="' + n + '"]'); return !!e && e.className.indexOf('done') >= 0; }, n);

// 畫面最下方 140px 內的按鈕，正中央那一點必須點得到按鈕本身（不能被 #demoBar 之類的浮動元件蓋住）
const blockedButtons = p => p.evaluate(() => {
  const H = window.innerHeight, out = [];
  document.querySelectorAll('.mbtn[data-act], .pbtn[data-act]').forEach(b => {
    const r = b.getBoundingClientRect();
    if (r.height === 0 || r.bottom < H - 140) return;
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    if (!hit || !(b === hit || b.contains(hit))) out.push(b.textContent.trim() + ' ← ' + (hit ? (hit.closest('[id]') || {}).id : 'null'));
  });
  return out;
});

async function newPage(b, vp) {
  const ctx = await b.newContext({ ...IPAD, viewport: vp, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
  p.on('request', r => { if (/^https?:/.test(r.url())) p.errs.push('模擬模式不應連線：' + r.url().slice(0, 60)); });
  await p.goto(URL); await p.waitForTimeout(1200);
  await clearOverlays(p);
  return p;
}

(async () => {
  const b = await chromium.launch();

  // ---------- 版面：直放與橫放，底部按鈕都點得到；模擬控制列可展開／收合 ----------
  for (const [name, vp] of [['直放', { width: 820, height: 1180 }], ['橫放', { width: 1180, height: 820 }]]) {
    const p = await newPage(b, vp);
    const blocked = await blockedButtons(p);
    ok(name + '：底部按鈕沒有被蓋住', blocked.length === 0, blocked.join('、'));
    await tap(p, '#demoBar [data-act="demoFold"]'); await p.waitForTimeout(200);
    const expanded = await p.evaluate(() => !!document.querySelector('#demoBar [data-act="demoReset"]').getBoundingClientRect().width);
    await tap(p, '#demoBar [data-act="demoFold"]'); await p.waitForTimeout(200);
    const folded = await p.evaluate(() => document.getElementById('demoBar').className === 'fold' && !document.querySelector('#demoBar [data-act="demoReset"]').getBoundingClientRect().width);
    ok(name + '：模擬控制列點一下展開、再點一下收合', expanded && folded);
    ok(name + '：沒有 JS 錯誤', p.errs.length === 0, JSON.stringify(p.errs));
    await p.context().close();
  }

  // ---------- 主要流程（直放） ----------
  const p = await newPage(b, { width: 820, height: 1180 });

  // 1. 完成任務 → 星星 +1，再點一次取消 → 回到原值
  const s0 = await stars(p);
  await tap(p, '.task[data-arg="練習鋼琴"]'); await p.waitForTimeout(500);
  const s1 = await stars(p);
  ok('完成「練習鋼琴」星星 +1', s1 === s0 + 1, `${s0} → ${s1}`);
  ok('任務顯示為已完成', await doneP(p, '練習鋼琴'));
  await tap(p, '.task[data-arg="練習鋼琴"]'); await p.waitForTimeout(500);
  const s2 = await stars(p);
  ok('取消任務後星星回到原值', s2 === s0, `${s1} → ${s2}`);
  ok('任務顯示為未完成', !(await doneP(p, '練習鋼琴')));

  // 2. 次數型任務：喝水點 6 次才完成（也驗證觸控連點不會漏掉或重複）
  const w0 = await stars(p);
  for (let i = 0; i < 5; i++) { await tap(p, '.task[data-arg="喝水"]'); await p.waitForTimeout(150); }
  ok('喝水點 5 次還沒完成', !(await doneP(p, '喝水')) && (await stars(p)) === w0);
  await tap(p, '.task[data-arg="喝水"]'); await p.waitForTimeout(400);
  const w1 = await stars(p);
  ok('喝水點第 6 次完成並 +1', (await doneP(p, '喝水')) && w1 === w0 + 1, `${w0} → ${w1}`);

  // 3. 記支出 $10 零食（不藏任何浮動元件，直接點）
  const b0 = await bal(p);
  await tap(p, '[data-act="spend"]'); await p.waitForTimeout(300);
  await tap(p, '[data-act="kp"][data-arg="1"]'); await tap(p, '[data-act="kp"][data-arg="0"]');
  await tap(p, '[data-act="cat"][data-arg="零食"]');
  await tap(p, '[data-act="kpok"]'); await p.waitForTimeout(400);
  const b1 = await bal(p);
  ok('記支出 $10 後餘額 -10', b1 === b0 - 10, `${b0} → ${b1}`);

  // 4. 支出超過餘額要擋下來
  await tap(p, '[data-act="spend"]'); await p.waitForTimeout(300);
  for (const d of '99999') await tap(p, `[data-act="kp"][data-arg="${d}"]`);
  await tap(p, '[data-act="cat"][data-arg="零食"]');
  await tap(p, '[data-act="kpok"]'); await p.waitForTimeout(300);
  const warned = await p.evaluate(() => document.body.innerText.indexOf('餘額不夠') >= 0);

  // 5. 重新整理後資料保留
  await p.goto(URL); await p.waitForTimeout(1200); await clearOverlays(p);
  const b2 = await bal(p);
  ok('超額支出被擋下、餘額不變', b2 === b1 && warned, `餘額 ${b2}，有提示=${warned}`);
  ok('重整後星星保留', (await stars(p)) === w1, `${w1} → ${await stars(p)}`);
  ok('重整後餘額保留', b2 === b1, `${b1} → ${b2}`);
  ok('重整後喝水仍為完成', await doneP(p, '喝水'));

  // 6. 模擬資料不會寫進真實 key
  const keys = await p.evaluate(() => Object.keys(localStorage));
  ok('模擬模式沒有寫入真實的 pp_ 資料', keys.filter(k => /^pp_/.test(k)).length === 0, JSON.stringify(keys));
  ok('整個流程沒有 JS 錯誤', p.errs.length === 0, JSON.stringify(p.errs));

  await b.close();
  report();
})().catch(e => { results.push('FAIL 測試中斷：' + e.message.split('\n')[0]); report(); });

function report() {
  console.log(results.join('\n'));
  const fail = results.filter(r => r.startsWith('FAIL')).length;
  console.log('\n' + (results.length - fail) + ' / ' + results.length + ' 通過（' + (process.env.TOUCH ? '觸控' : '滑鼠') + '）');
  process.exitCode = fail ? 1 : 0;
}
