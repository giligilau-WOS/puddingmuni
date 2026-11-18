# CLAUDE.md — 學習面板（puddingmuni）

給小朋友在 iPad 上用的「學習面板」：任務／星星、蕃茄鐘、課表、零用錢記帳、徽章收藏。
以「加入主畫面」的 Web App（`apple-mobile-web-app-capable`）形式執行，資料同步到 Google Apps Script 後端。

## 專案結構

| 路徑 | 說明 |
| :--- | :--- |
| `index.html` | 正式版。**整個 App 都在這一個檔案**（約 6,000 行，CSS + 單一 `<script>` IIFE，含大量 base64 圖片）。 |
| `kid-demo.html` | 模擬版：與 `index.html` 幾乎相同，只差 `FORCE_DEMO = true`、`APP_VERSION` 與部分徽章資料。不連線、資料存 `demo_` 前綴、時間加快 60 倍。 |
| `test.html` | 「一鍵連線測試」頁，用來在 iPad 上檢查 Apps Script 連線。 |
| `profiles/*.mobileconfig`、根目錄 `*.mobileconfig` | iOS 主畫面圖示描述檔（從面板內點「安裝」會開 Safari 下載）。 |
| `fonts/`、根目錄 `*.woff` | 手寫風字型（附 OFL 授權檔）。 |
| `icons/`、`posters/`、`kid/` | 圖示、海報、主題素材。 |

Apps Script 後端程式**不在此 repo**；前端以 `action`（`load`、`loadState`、`push`、`saveState`、`saveSpecial`、`setShop`、`toggleTask`）呼叫它。

## 必須遵守的程式慣例

1. **只寫 ES5**：目標是舊版 iPad Safari。禁止 `let`/`const`/箭頭函式/樣板字串/`class`/`async`/`await`/`fetch`/`Promise`/`Array.prototype.includes` 等。沿用現有的 `var`、`function`、callback 寫法。
2. **網路只走既有通道**：`call()` → `viaJsonp` / `viaFrame` / `viaPost`。不要另外引入 XHR／fetch 或第三方函式庫。
3. **每次改 `index.html` 都要更新 `APP_VERSION`**（格式 `MMDD-vNN`，例如 `1118-v50` → `1118-v51`），用來確認 iPad 載入的是新版。
4. **`index.html` 與 `kid-demo.html` 要同步**：功能修改要同時套到兩個檔案，但 `kid-demo.html` 必須保留 `FORCE_DEMO = true`。改完用 `diff index.html kid-demo.html` 確認兩邊只差在預期的地方。
5. **金額與星星一律走事件佇列**：用 `starEvent()` / `ledgerEvent()` / `addEvent()`。每個事件都有 `id`（`uid()`），後端靠它去重。不要直接改 `C`（雲端快取）或繞過 `OUT` 佇列。
6. **localStorage 一律透過 `lsGet`/`lsSet` 與 `K()`**，以免模擬模式（`demo_` 前綴）的資料蓋掉真實資料。
7. **向下相容舊資料**：`S`（`pp_state`）、`C`（`pp_cache`）、`OUT`（`pp_outbox`）可能是舊版存下來的。新增欄位一定要給預設值（參考 `normAll()` 與「舊版…搬過來」的遷移寫法），不能假設欄位存在。
8. **不要動 `API_URL` / `API_KEY`**，除非使用者明確要求。也不要把它們印到 log 或 toast。
9. 介面文字使用繁體中文，語氣以小朋友看得懂為主。

## 驗證與測試強制規範

1. **禁止未驗證提交**：在 git commit 前，至少要通過下面的「低成本檢查」，並實際打開頁面走過受影響的流程。
2. **低成本檢查**（每次都跑）：

   語法檢查（三個 HTML 內的 `<script>`）：
   ```bash
   for f in index.html kid-demo.html test.html; do node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");let n=0;for(const m of s.matchAll(/<script>([\s\S]*?)<\/script>/g)){new Function(m[1]);n++}console.log(process.argv[1],"OK",n,"script(s)")' "$f"; done
   ```

   ES5 違規掃描（應該沒有任何輸出）：
   ```bash
   grep -nE '=>|\b(let|const|class|async|await)\s|`|fetch\(|Promise|\.includes\(' index.html kid-demo.html | grep -v base64
   ```

3. **實際運行變更（E2E 冒煙測試）**：
   - 用 `kid-demo.html`（或 `index.html?demo=1`）在本機開啟。模擬模式不會連到真實後端，也不會動到小朋友的真實資料。
   - 用 Playwright 以 iPad 尺寸（直放與橫放）走過受影響的流程，例如完成／取消任務、星星增減、記一筆收支、兌換商店、蕃茄鐘。
   - 檢查 console 沒有錯誤；畫面上的星星總數與零用錢餘額要符合預期。
   - 若改到同步或 Apps Script 相關邏輯，模擬模式測不到，要在報告中寫明「未在真實後端驗證」，並請使用者用 `test.html` 在 iPad 上確認。
4. **涉及金額、星星、狀態轉換或資料遷移的邏輯**，要為該函式寫屬性測試（隨機輸入跑數百次），至少驗證：
   - **不變量**：例如完成再取消任務後，星星回到原值。
   - **冪等性**：同一個事件 `id` 套用兩次，結果與套用一次相同。
   - **往返一致性**：`money()` 的格式化、JSON 存讀。

   測試腳本放在 scratchpad 或 `tests/`；不要把測試程式碼塞進 `index.html`。
5. **不穩定測試零容忍**：不得加 `.skip`、插入 `sleep`／`setTimeout` 硬等，也不得重跑到變綠為止。要找出根本原因。
6. **三輪上限**：同一個問題連續修 3 輪仍未通過時，就停手回報錯誤證據與嘗試過的方向。
7. **不可修改評判自身的規則**：功能變更不得順便放寬測試斷言，也不得修改本檔的驗證規範。
8. **驗證報告**：完成後附上 `verified: [syntax, es5, e2e-demo, property-test]` 這類印記，沒做到的項目要誠實標示。

## 審查重點（Diff 觸發檢查）

| Diff 觸發條件 | 必查項目 |
| :--- | :--- |
| 改了 `S` / `C` / `OUT` 的欄位或 `normAll()` | 載入缺少新欄位的舊資料會不會壞？ |
| 改了 `addEvent`、`sync`、`pushAll`、`call` | 離線時事件會不會遺失？重送時會不會重複記帳或重複加星？ |
| 改了按鈕、彈窗、快速連點處理 | 在 iPad 尺寸實際點過了嗎？直放／橫放都正常嗎？ |
| 改了 `toast`、錯誤訊息或 log | 會不會露出 `API_KEY`、家長 PIN 或其他私人資料？ |
| 只改了 `index.html` | `kid-demo.html` 同步了嗎？`APP_VERSION` 更新了嗎？ |
