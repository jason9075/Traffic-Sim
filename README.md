# Traffic Sim — 交通模擬遊戲

> **⚠️ 專案已放棄維護。**
> 自製微觀交通模擬(車道/號誌/路網拓樸/行人)重造輪子的成本遠超預期,
> 且功能與真實度都比不上成熟的開源方案。已改用
> [Eclipse SUMO](https://eclipse.dev/sumo/)(Simulation of Urban MObility),
> 有完整的路網匯入(含 OSM)、多車道變換、路口號誌邏輯、行人模擬與大量文件/社群支援。
> 本 repo 保留作紀錄,不再繼續開發。

純前端的交通模擬遊戲:在衛星地圖上用 Bézier 曲線畫馬路、人行道、斑馬線、紅綠燈,
然後跑微觀交通模擬,觀察塞車延滯、行人平均等待時間與人流狀況。
可直接部署在 GitHub Pages,無後端、無 API key。

**交通規則鎖定台灣**:靠右行駛,速限預設市區 50 km/h。

## 操作

| 快捷鍵 | 工具 |
|---|---|
| `1` | ✋ 移動(平移/縮放地圖) |
| `2` | ▢ 選取 / 編輯(拖曳錨點與 handle,Alt 拆開對稱 handle) |
| `3` | 🛣 馬路(點擊放錨點、按住拖曳拉弧度,雙擊或 Enter 結束,Esc 取消) |
| `4` | 🚶 人行道 |
| `5` | 🦓 斑馬線(點兩端) |
| `6` | 🚦 紅綠燈(放在路口) |
| `7` | 🚗 出入口(放在道路端點附近;設定車流/人流量) |

流程:搜尋地點 → 畫路網 → 放紅綠燈與出入口 → `▶ 模擬`。
場景自動存在 localStorage,可匯出/匯入 JSON。

## 開發

```bash
nix develop        # 進入 dev shell(bun、node、just)
just install       # bun install
just dev           # vite dev server
just test          # bun test(geometry 與模擬引擎)
just build         # tsc + vite build
```

> 注意:若專案位於 `noexec` 掛載的檔案系統,請先把 `node_modules`
> symlink 到可執行的位置(見 `ln -s ~/.local/share/traffic-sim/node_modules node_modules`)。

## 架構

- **地圖**:MapLibre GL JS + Esri World Imagery(僅需 attribution)
- **編輯器**:Canvas 2D overlay,Bézier control points 存地理座標
- **Graph build**(`src/geometry/`,純函式):Bézier 弧長取樣 → 交點偵測/snap →
  directed graph(靠右行駛的車道中心線)
- **模擬引擎**(`src/sim/`,純函式、跑在 Web Worker):
  - 跟車:IDM(Intelligent Driver Model),timestep 0.1s
  - 號誌:fixed-time 兩時相(依進入方位自動分群)
  - 路徑:Dijkstra;進車:Poisson(seeded,可重現)
  - 行人:人行道圖 + 斑馬線通行權(被跨車道全紅才放行)
- **視覺化**:流量 heatmap、停止線號誌、車輛/行人、即時統計與 sparkline

## MVP 範圍外(見 PLAN.md)

多車道與變換車道、機車流、感應式號誌、車輛讓行行人(無號誌斑馬線)、OSM 路網匯入。
