# Traffic Sim — 純前端交通模擬遊戲規劃

一個可部署在 GitHub Pages 的靜態網頁:使用者在衛星地圖上用 Bézier 曲線畫馬路、人行道、放紅綠燈,然後跑微觀交通模擬,觀察塞車時間、行人平均等待時間、人流狀況。

**交通規則鎖定台灣**:靠右行駛、雙向道路右側車道順向;紅綠燈時相與速限預設值採台灣市區慣例(速限預設 50 km/h、巷道 30 km/h)。

---

## 1. 核心技術決策

### 1.1 衛星底圖
- **MapLibre GL JS** + **Esri World Imagery** raster tiles。
- 理由:Google Maps / Bing tiles 的授權不允許脫離官方 SDK 使用;Esri World Imagery 只要求 attribution,無 API key,適合純靜態站。
- 備案:MapTiler Satellite(需 API key,free tier 夠用,但 key 會曝露在前端 —— 能鎖 domain 所以可接受)。
- 底圖只是「參考圖」,模擬本身不依賴任何地圖資料(不用 OSM 路網),所有路網都是使用者自己畫的。

### 1.2 繪圖編輯器(Editor)
- 道路以 **cubic Bézier spline** 表示,control points 存**地理座標 (lng/lat)**,渲染時用 `map.project()` 投影到螢幕。
- 疊一層 **Canvas 2D overlay** 在 MapLibre 上做繪製與編輯(拖曳 control point、加減 segment)。編輯階段車流量低、圖形簡單,Canvas 2D 足夠;不需要 deck.gl 這種重型依賴。
- 元素類型:
  - `Road`:Bézier spline + 每方向車道數(MVP 先固定單向單車道、可雙向)+ 速限。
  - `Sidewalk`:同樣是 Bézier spline,獨立圖層。
  - `Crosswalk`(斑馬線):連接兩段 sidewalk、橫跨一條 road 的短線段。
  - `TrafficLight`:放在路口 node 上,含 phase 設定(綠/黃/紅秒數、行人專用時相)。
  - `SpawnPoint`:路網邊緣的進車口/出車口,設定流量(vehicles/hr)與行人流量(peds/hr)。

### 1.3 幾何 → 路網圖(Graph Build)
這是整個專案**最難也最關鍵**的一段,獨立成純函式模組:

1. Bézier 以 arc-length 均勻取樣成 polyline(每 ~2m 一點)。
2. 偵測 road 之間的交點與端點鄰近(snap tolerance ~5m)→ 合併成 intersection node。
3. 產出 directed graph:`Node`(路口/端點)+ `Edge`(車道 centerline polyline、長度、速限)。
4. Sidewalk 同樣建一張獨立的 pedestrian graph,crosswalk 是跨圖的特殊 edge,通行權綁定紅綠燈 phase。

MVP 簡化:路口不做車道級轉向幾何(不畫轉彎軌跡的平滑曲線),車輛在 node 直接切換 edge,視覺上用短直線過渡即可。

### 1.4 模擬引擎(Simulation Core)
微觀模擬(microscopic),**純函式 + immutable-ish state**,跑在 **Web Worker** 裡:

- **跟車模型:IDM(Intelligent Driver Model)** —— 公式簡單、行為真實、參數少,是學術與 SUMO 等工具的標準做法。
- **紅綠燈**:fixed-time phase cycle;紅燈視為該 edge 末端的虛擬停止車。
- **無號誌路口**:簡化的 gap-acceptance(支線讓幹線)。
- **路徑選擇**:spawn 時用 Dijkstra 決定 OD 路徑(路網小,不需要 A*/CH)。
- **行人**:在 pedestrian graph 上以 ~1.3 m/s 行走,遇 crosswalk 紅燈排隊等待 → 這就是「行人平均等待時間」的量測點。
- **時間步進**:fixed timestep 0.1s,與 render loop 解耦;支援 1x / 4x / 16x 加速。
- State 用 typed arrays(SoA)存車輛位置/速度,worker 每 frame 用 `postMessage` + transferable 丟渲染快照回主執行緒。幾百台車輕鬆處理。

### 1.5 統計指標(Metrics)
- 平均旅行時間 vs. 自由流時間 → **平均延滯(delay)**,即「塞車多久」。
- 每個路口進向的 **queue length**(排隊長度)時間序列。
- **行人平均等待時間**(per crosswalk 與全域)。
- **Throughput**(單位時間通過量)與道路 **speed heatmap**(直接把 edge 依平均速度染色畫在地圖上)。
- 圖表用 **uPlot**(~40KB,無依賴)或自繪 canvas,不引入 Chart.js/ECharts 級別的重量。

### 1.6 UI / 框架
- **Vite + TypeScript + vanilla DOM**(或最多 Preact,~4KB)。不用 React —— 這個 app 的 UI 是工具列 + 幾個面板,重心在 canvas,重框架是 bloat。
- 三個模式:`Edit`(畫路)→ `Configure`(調紅綠燈時相、流量)→ `Simulate`(跑模擬看數據)。
- 場景存檔:序列化成 JSON → `localStorage` 自動存 + 匯出/匯入檔案;進階做 URL hash 分享(JSON → gzip → base64)。

### 1.7 部署
- GitHub Actions → GitHub Pages,`vite build` 設 `base: '/traffic-sim/'`。
- 全站無後端、無 API key(用 Esri 方案時),clone 下來 `just dev` 就能跑。

---

## 2. 專案結構

```
traffic-sim/
├── flake.nix              # bun + node,dev shell
├── justfile               # dev / build / test / lint / deploy
├── vite.config.ts
├── index.html
├── src/
│   ├── main.ts            # 進入點、mode 切換
│   ├── map/               # MapLibre 初始化、投影工具
│   ├── editor/            # Canvas overlay、Bézier 編輯、工具列
│   ├── model/             # Road/Sidewalk/TrafficLight… 資料模型 + (de)serialize
│   ├── geometry/          # Bézier 取樣、arc-length、交點偵測、graph build(純函式)
│   ├── sim/               # IDM、signal、routing、pedestrian(純函式,可獨立測試)
│   ├── sim.worker.ts      # Worker 入口:tick loop + 快照回傳
│   ├── render/            # 模擬視覺化(車、行人、heatmap)
│   ├── metrics/           # 統計收集與聚合
│   └── ui/                # 面板、圖表(uPlot)
├── tests/                 # bun test:geometry 與 sim 核心
└── .github/workflows/deploy.yml
```

`geometry/` 與 `sim/` 完全不碰 DOM/MapLibre,全部純函式 —— 這兩塊是 bug 最多的地方,必須能用 `bun test` 驗證(例:一條 1km 直路、流量 600 veh/hr、一個紅綠燈,驗證 queue 增長與消散符合理論值)。

---

## 3. 開發階段

### Phase 0 — 骨架(半天)
flake.nix、justfile、Vite + TS、GitHub Actions 部署到 Pages。先讓 CI 綠燈。

### Phase 1 — 地圖 + 編輯器(核心互動,1–2 週)
- MapLibre 衛星底圖、搜尋/定位到目標區域(Nominatim geocoding,免費)。
- Canvas overlay:畫 road(點擊放 anchor、拖出 handle 的標準 pen tool 互動)、編輯 control points、刪除。
- Sidewalk、crosswalk、traffic light、spawn point 的放置。
- JSON 序列化 + localStorage。
- **里程碑:能在自家附近衛星圖上畫出完整路口並存檔。**

### Phase 2 — Graph Build(1 週)
- Bézier 取樣、交點偵測、snap、directed graph 產出。
- 圖形驗證 view(把 graph 疊圖顯示,肉眼檢查)+ bun test。
- **里程碑:畫十字路口 → 正確產出 4 node-degree 的 intersection。**

### Phase 3 — 車輛模擬(1–2 週)
- IDM 跟車、spawn、Dijkstra routing、紅綠燈 phase、Worker 化。
- 車輛渲染(沿 polyline 移動的小矩形,帶方向)。
- **里程碑:紅燈前排隊、綠燈起步波(start-up wave)看起來對。**

### Phase 4 — 行人(1 週)
- Pedestrian graph、行走、crosswalk 等待、行人時相。
- **里程碑:行人等待時間統計出現且合理。**

### Phase 5 — 統計面板(1 週)
- Delay / queue / throughput / 行人等待的即時圖表,speed heatmap,模擬加速控制,結束後總結報告。

### Phase 6 — 潤飾
- URL 分享、範例場景 preset、undo/redo、紅綠燈時相編輯器 UX、行動裝置基本可用。

---

## 4. 風險與注意事項

| 風險 | 對策 |
|---|---|
| 衛星圖資授權 | 用 Esri World Imagery + 顯示 attribution;絕不用 Google tiles |
| 路口幾何複雜度爆炸 | MVP 不做車道級轉向;多車道、待轉、圓環全部列為 post-MVP |
| 模擬「看起來不真實」 | IDM 參數用文獻預設值;先用單一路口對照直覺驗證,再加複雜度 |
| 經緯度做物理運算的失真 | graph build 時把座標投影到局部平面座標(以場景中心做 equirectangular 近似,公里級範圍誤差可忽略),模擬全程用公尺 |
| Editor UX 難做好 | Pen tool 互動參考 Figma/Illustrator 慣例;這是使用者黏著度關鍵,Phase 1 值得多花時間 |

## 5. 明確不做(MVP 範圍外)
- 多車道與變換車道、公車/大型車種、機車流(台灣特色,可當 v2 亮點)、
  感應式號誌、3D 視角、真實 OSM 路網匯入。
