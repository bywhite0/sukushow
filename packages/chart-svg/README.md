# chart-svg

把莲之空（Link! Like! ラブライブ！）的原格式谱面渲染成 **SVG 矢量图**。

- 横轴 = 60 格轨道，纵轴 = **时间向上递增**（和游戏一样是下落式朝向）
- 音符 / Hold / Flick 的外观与几何口径对齐原版客户端，贴图取自原包
- 输出是纯文本矢量图：可无损缩放、可用浏览器打开、可用 CSS 改配色、能塞进版本库做 diff

## 参考

本仓库的 SVG 结构参考 [pjsekai-scores-rs](https://github.com/Team-Haruki/pjsekai-scores-rs)
（Project SEKAI 谱面渲染器，核对版本 `986de2e`）：

- `defs` 内嵌一份 CSS 类 + 每张贴图只内嵌一次、正文用 `<use>` 引用
- 分层的元素组织（背景 / 轨道 / 小节线 / 拍线 / 带身 / 音符 / 装饰）
- 九宫格与平铺都靠嵌套 `<svg>` + `viewBox` 裁剪源图实现

差别：那边把长曲切成多段嵌套 `<svg>` 横向并排（输出 5520×2337 ≈ 2.36:1 横版）；
这边同此思路——整谱默认按**目标长宽比**反推列数（`--aspect`，默认 2.4），铺成横版。
想要一张长图用 `--single-column`，只看某一段用 `--from/--to`（局部图默认不切列）。

底部信息区（`--meta`）也照那边的版式：图片**底部**一条横带，左边方形封面、右边曲名与难度。

口径来源见 [`docs/evidence.md`](docs/evidence.md)。

![整谱分列渲染示例](docs/shots/columns.png)

*上例：抱きしめる花びら MASTER 整谱，铺成横版。*

![侧栏与 Fever 示例](docs/shots/side-fever.png)

*上例：`--side` 的左侧栏（小节号 / BPM / 拍号 / Fever）与 `--meta` 的底部信息区。*

![局部渲染示例](docs/shots/heart.png)

*上例：`--from 103.0 --to 104.7 --px-per-sec 900 --lane-px 14`，由四条 Hold 织出的图形。*

## 安装

```bash
pnpm install
```

需要 Node 20+（用了原生 `node:zlib` 解 raw-deflate）。贴图与元数据已在 `public/rg/`，开箱即用。

## 用法

```bash
pnpm render <谱面.bytes|.json> -o <输出.svg> [选项]
```

| 选项 | 说明 |
|---|---|
| `--lane-px <n>` | 每格轨道宽度（默认 16） |
| `--px-per-sec <n>` | 每秒纵向像素（默认 340，对齐参考仓库的等效密度） |
| `--pad <n>` | 上下左右留白（默认 16） |
| `--from <秒>` / `--to <秒>` | 只渲染这一段（长曲出局部图，文件小很多） |
| `--aspect <n>` | 目标长宽比（宽/高），按它定列数（默认 2.4） |
| `--max-column-height <px>` | 每列最大像素高，超过就切列并排（0 = 不切） |
| `--single-column` | 不切列，出一张长图 |
| `--column-gap <px>` | 列间距（默认 8） |
| `--no-col-labels` | 不标列号与时间范围 |
| `--side` | 左侧栏：小节号 / BPM / 拍号 / Fever |
| `--side-width <px>` | 侧栏宽度（默认 96） |
| `--no-side-bars` / `--no-side-bpm` / `--no-side-beats` / `--no-fever` | 侧栏关掉对应项 |
| `--meta` | 底部信息区：封面 + 曲名 + 难度 |
| `--meta-size <px>` | 封面边长（默认 192，同参考仓库的 `meta_size`） |
| `--masterdata <dir>` | `MusicScores.yaml` / `Musics.yaml` 所在目录 |
| `--jacket-dir <dir>` | 曲绘目录（`<曲目Id>.png`） |
| `--mirror` | 左右镜像 |
| `--no-grid` / `--no-measures` / `--no-beats` / `--no-simul` | 关掉对应层 |
| `--bar-numbers` | 标小节号 |
| `--transparent` | 透明背景 |
| `--link-assets` | 贴图用链接而非内嵌（SVG 更小，但需带上贴图目录） |
| `--css <file>` | 追加样式表 |

例：

```bash
# 整谱（默认铺成横版）
pnpm render chart.bytes -o chart.svg --px-per-sec 240

# 整谱一张长图
pnpm render chart.bytes -o chart.svg --px-per-sec 240 --single-column

# 更扁一些（宽高比 4:1）
pnpm render chart.bytes -o chart.svg --aspect 4

# 只看 103.0–104.7 秒（抱花的爱心段）
pnpm render chart.bytes -o heart.svg --from 103.0 --to 104.7 --px-per-sec 900 --lane-px 20
```

## 输出

一张自包含的 SVG。整谱默认铺成横版（按目标长宽比定列数，每列一个嵌套 `<svg>`，底边对齐）：

```
<svg width="8992" height="3659" viewBox="0 0 8992 3659">
  <defs><style>…CSS 类…</style>
        <image id="sp-ui_sc2_ingame_notes_tap" xlink:href="data:image/png;base64,…" …/>
        <linearGradient id="bg0" gradientUnits="userSpaceOnUse" …/></defs>
  <rect class="bg" …/>              ← 列号表头横带
  <text class="col-text">1 / 9</text>
  <svg class="col" x="0" …>         ← 第 1 列（viewBox 开窗到该段）
    <rect class="lane" …/>          ← 轨道栏
    <line class="lane-line" …/>     ← 格线（每 5 格一条加粗）
    <line class="bar-line" …/>      ← 小节线
    <line class="beat-line" …/>     ← 拍线
    <line class="simul" …/>         ← 同时押连线
    <path fill="url(#bg0)" …/>      ← Hold 宽带（三列顶点色）
    <svg viewBox="0 0 60 68" …>     ← 音符（九宫格三段）
  </svg>
  <svg class="col" x="1000" …>…</svg>  ← 第 2 列
  …
</svg>
```

配色由 `defs` 里的 CSS 类控制，用 `--css` 追加即可覆盖。类名：`.bg` `.lane` `.edge`
`.lane-line` `.lane-line-major` `.bar-line` `.beat-line` `.simul` `.bar-text` `.col-text` `.col-sub`。

## 已实现

- 四类音符：Single / Hold / Flick / Trace，原版贴图 + 横向九宫格拉伸（端头不变形）
- Hold 三列顶点色宽带：左右列 `SideColor(45,248,255)` α=0.60、中列 `CenterColor(46,198,255)` α=0.20
- Hold 链按源数组顺序逐节点绘制，同 tick 折返的航点不被重排；串链汇合点去重
- Flick 三层附加元素：平铺箭头（左右各一）、`Symbol`、`Sign`（沿「上」抬 1 世界单位）
- 小节线 / 拍线 / 轨道格线 / 同时押连线（判定时刻差 < 4 ms）
- 长曲铺成横版：按目标长宽比（`--aspect`，默认 2.4，对齐参考仓库的 2.36:1）反推列数，列号与时间范围标注
- 时间段渲染、镜像、透明背景、外挂样式表

## 范围

不做：3D 透视、判定、音频同步、节拍器动画。定位是「出静态谱面图」。

## 校验

```bash
pnpm build            # tsc --noEmit
pnpm test             # 单测（解析 / 布局 / 几何 / SVG 结构）
pnpm verify:corpus    # 617 张谱面全量渲染，检查统计自洽与标签配平
pnpm cross-check      # 与 2D 谱面实现 逐音符比对解析口径与几何量
```

`cross-check` 对 SVG 导出与 2D 视图使用同一批谱面校验音符、串链拓扑、贴图尺寸与时间轴映射。

## 许可

MIT。音符贴图来自游戏原包，仅用于研究与互操作验证。
