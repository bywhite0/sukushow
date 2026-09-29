# 口径依据

每条几何与颜色口径的出处。参考仓库 `pjsekai-scores-rs`（核对版本 `986de2e`）只借结构，
数值一律以原版客户端与已核准的规格文档为准。

## 坐标系

原版轨道在世界空间是 `lanePitch × (lane − 29.5)` 的连续坐标（`laneWidthOpt = 100` 时
`lanePitch = 0.15`），60 格铺开为 ±4.5。平面图只关心相对关系，故取单位轨宽 = 1：

```
左缘 = lane − 29.5,  右缘 = (lane + 1) − 29.5
```

一格轨宽 = `LANE_WORLD = 0.15` 世界单位。本仓库令一格 = `lanePx` 像素，于是
`pxPerWorld = lanePx / 0.15`，**横纵共用同一比例**，贴图纵横比与原版一致。

### 时间向上

游戏是下落式的——未来的音符从上方落下。0 秒在内容**底部**、总时长在顶部：

```
timeY(t) = padY + (duration − t) × pxPerSec
```

`yTime` 是它的反函数。参考仓库 `pjsekai-scores-rs` 的 SVG 也是这个朝向
（`y = time_height × Δt(bar, barStop)`，以末小节为基准向上量），两者独立得出同一结论。

**换轴会把谱面作者画的图形整体上下翻转**（爱心、箭头等）。这是该朝向的固有代价，不是渲染缺陷。

## 音符外观

四类音符用原版贴图 `ui_sc2_ingame_notes_{tap,hold,flick,trace}.png`
（128×68 / Trace 128×48），九宫格边距 `border = (60,0,60,0)`、`ppu = 100`。

尺寸照 `ISlopeResolver`：

```
GetNoteSize(width) = ((width − 6) × 0.2 + 1.15, 1.0)   // width = |l − r| + 1
```

再乘 prefab 里 `SpriteRenderer` 的 `scale.x = 0.75`。纵向厚度 `type === 3 ? 0.35 : 0.45`。
单格音符的视觉宽度 0.15 恰等于一格逻辑宽度。

横向九宫格按 Unity `SpriteDrawMode.Sliced`：左右端头各取 `border / ppu × scale`
（**保持原生尺寸，圆角不变形**），两端头之和超过目标宽度时等比缩到恰好铺满、中段为 0。
端头宽约 0.45 世界单位，比单格音符本体（0.15）还宽 —— 单格与双格音符整条都由端头构成，
所以它们看起来是圆润的胶囊；宽音符则由「端头 + 拉伸中段 + 端头」拼成。

**九宫格边距与世界尺寸必须同一口径**：把像素宽当世界宽传进去，端头会缩到不足 1px，圆角就没了。

SVG 里用嵌套 `<svg>` + `viewBox` 圈出源图切片、`preserveAspectRatio="none"` 按目标尺寸铺开。

### Flick 的附加元素

原版 `NoteFlickView` 除了本体 `Silhouette`，还挂三个装饰子节点，全部不染色（颜色来自贴图本身）：

| 子节点 | 贴图 | 尺寸来源 | 摆放 |
|---|---|---|---|
| `Arrow-Left` / `Arrow-Right` | `ui_sc2_ingame_notes_texture_arrow` 52×50 | 宽 `ISx×0.45`、高 `0.45×1.45` | 两块各偏中心 ±宽/2，右侧水平翻转 |
| `Symbol` | `ui_sc2_ingame_notes_icon_flick` 120×90 | 原生尺寸 × 0.6 | 居中 |
| `Sign` | `ui_sc2_ingame_flick_sign` 323×250 | 原生尺寸 × 0.8 | 居中，并沿「上」抬 1 世界单位 |

箭头贴图靠 **UV repeat 平铺**，重复次数 = 目标宽 / 单块宽，可为小数 —— 故最后一块按剩余宽度
裁源图，不能取整。单块宽 = 贴图原生宽 × `scale.x`，与音符宽度无关。

`Sign` 的 `localPosition.y = 1`（prefab 授权 `pos(0,1,0)`）沿音符平面的「上」抬。
时间轴向上，故画布 y 减小。原版 `FlickSignView` 另有 0.9↔1.1 的纵向余弦浮动（周期 1s、全场同相），
静态读谱取中值即 prefab 的 `y = 1`，不做浮动。

尺寸一律按 `pxPerWorld` 换算，不随 `pxPerSec` 变化 —— 它们是世界空间里的固定尺寸装饰。
`Arrow` 贴图 alpha 上限仅 82（一层很淡的光晕），`Symbol` 与 `Sign` 则是实心绿色。

## Hold 宽带

照 `HoldMeshView`：每节点三列顶点，左列与右列取 `SideColor`、中列取 `CenterColor`：

```
SideColor   = (45, 248, 255)  α = 0.60
CenterColor = (46, 198, 255)  α = 0.20
```

三列的轨道坐标：

```
GetLeftMeshX(xl)  = lane0Left + laneWidth × (xl + 1)    ⇒ l + 1
GetRightMeshX(xr) = lane0Left + laneWidth × xr          ⇒ r
GetCenterMeshX(m) = lane0Left + laneWidth × (m + 0.5)   ⇒ (l+r)/2 + 0.5
```

即宽带比音符本体左右各内缩整一格：带宽 = `(Width − 2)` 格。

### 顶点色沿带长恒定

左列恒 Side、中列恒 Center、右列恒 Side，色场只随「垂直于带身的距离」变化。所以渐变轴
**必须垂直于带轴**：直接取两列中点连线会得到水平轴，斜置带子据此上色就会沿长度漂色。
做法是把两列中点投影到过形心的带法线方向。

SVG 用 `linearGradient` + `gradientUnits="userSpaceOnUse"`，端点即这对投影点，
每个半边一条独立渐变。

### 其他

- 带宽退化（`Width ≤ 2`）时该半边没有面积，跳过。
- 头尾端头贴图原版为**亮白高光**，用同款九宫格画。
- 余弦脉动呼吸光不实现。
- 串链**允许汇合**（两个节点可指向同一后继），故顺链遍历按 Uid 去重，否则汇合点会画两遍。

## 谱面数据格式

deflate-raw 压缩的 JSON，含 `Notes`、`Bpms`、可选 `Beats`：

```
type = f & 15          r = (f >>> 4) & 63     r2 = (f >>> 10) & 63
l    = (f >>> 16) & 63 l2 = (f >>> 22) & 63
```

- 同时押判定：时刻差 < 4 ms
- 真实谱面 `l ≤ r`
- 链首判定：`type === 1 && !prev`
- 链节点通过 `n.next` 相连；串链判据同律原版，两侧压回 **float32** 再比（用 double 容差会漏连）

## 长曲的分列

整谱按 `pxPerSec` 出图会得到一张极高的图（抱花 137 秒 × 220 px/s ≈ 3 万像素），既不便传阅
也不好读。故默认切成**多列并排**，每列一个嵌套 `<svg>`，**底边对齐**——底边即时间起点，
各列都是从同一条「0 秒基线」往上长。参考仓库 `pjsekai-scores-rs` 也是多段并排，同此思路。

切列的两条规矩：

- **按时间等分，不按小节边界等分。** 小节长度本身不均匀（BPM 段多时尤甚），硬在边界上凑
  等分会切出高矮悬殊的列（实测出现过 7384 / 700 / 14842 这种极端分布）。时间等分保证各列
  高矮相近，刀口再**吸附**到最近的小节边界（限幅 20% 列长），吸附不到就宁可刀口不落边界。
- **吸附后逐列校验**，哪一列超过上限就把那一刀退回等分位置——等分必然不超限。上限指
  **最终图片高**，故算列数时先扣掉每列上下各一份 `padY`。

列号与时间范围标在一条**独立表头横带**里，不跟着各列顶部走：各列高矮不同，标签随列顶
会散落在不同高度，读起来乱。

跨列的长 Hold 会在列边界被裁成两截——这是切列的固有代价，读谱时靠表头的时间范围对齐。
音符统计按 `Uid` 去重，不因切列翻倍。

## 与 llll-flat-preview 的关系

两个仓库各自独立持有实现（不共享代码），口径必须一致：

| 项 | 说明 |
|---|---|
| 解析 | 同一套字段口径、同一条串链判据 |
| 布局 | 同为时间向上、以 `duration` 为锚、`noteSpan` 同式 |
| 贴图 | 同一批 `public/rg/` 贴图与 `sprite_meta.json` |
| 差异 | 本仓是**整谱定尺出图**（无滚动偏移，`pxPerSec` 决定成图高，长曲切列并排）；那边是**视口 + 滚动**交互预览 |

`pnpm cross-check` 逐音符比对两者，口径漂了就报差异。

## 参考

- `pjsekai-scores-rs`（Team-Haruki，核对版本 `986de2e`）：SVG 结构、`defs` 内嵌 CSS 类、
  嵌套 `<svg>` 裁剪、分层组织
- `HOLD_MESH.md`：Hold 三列顶点色与端头
- 原版客户端二进制：prefab 授权值（`localScale` / `localPosition`）、贴图九宫格边距
