// 正式版 index.html 斷網開啟：擋掉所有對外連線（不會碰到真實後端），確認不會壞掉。
// 執行：node tests/offline.js
const path = require('path');
const { chromium, devices } = require('playwright');

(async () => {
  const results = [];
  const ok = (name, cond, detail) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''));
  const b = await chromium.launch();
  for (const [name, vp] of [['直放', { width: 820, height: 1180 }], ['橫放', { width: 1180, height: 820 }]]) {
    const ctx = await b.newContext({ ...devices['iPad (gen 7)'], viewport: vp, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    const errs = [];
    let blocked = 0;
    p.on('pageerror', e => errs.push(e.message));
    await p.route(/^https?:/, r => { blocked++; r.abort(); });
    await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
    await p.waitForTimeout(3000);
    const info = await p.evaluate(() => ({
      tabs: !!document.querySelector('.ttabs'),
      money: !!document.querySelector('[data-act="spend"]'),
      demoBar: getComputedStyle(document.getElementById('demoBar')).display
    }));
    ok(name + '：斷網開啟沒有 JS 錯誤', errs.length === 0, JSON.stringify(errs));
    ok(name + '：有嘗試連線（之後被擋下）', blocked > 0, blocked + ' 個請求');
    ok(name + '：任務區與零用錢區有畫出來', info.tabs && info.money);
    ok(name + '：正式版不顯示模擬控制列', info.demoBar === 'none');
    await ctx.close();
  }
  await b.close();
  console.log(results.join('\n'));
  const fail = results.filter(r => r.startsWith('FAIL')).length;
  console.log('\n' + (results.length - fail) + ' / ' + results.length + ' 通過');
  process.exitCode = fail ? 1 : 0;
})();
