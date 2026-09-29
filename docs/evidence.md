# 实现依据与限制

## 源格式

- 直接读原格式 JSON，或 raw-deflate 压缩的 `.bytes`（浏览器 `DecompressionStream('deflate-raw')` 原生支持）。
- `Notes[].just` 与 `holds` 是绝对秒；`Flags` 为位域，`type = f & 15`、`r = (f>>>4) & 63`、`r2 = (f>>>10) & 63`、`l = (f>>>16) & 63`、`l2 = (f>>>22) & 63`。
- 轨道号 0…59；`l ≤ r`、`l2 ≤ r2` 由解析层拒绝。`Bpms[].Time / Bpm`、`Beats[].Numerator / Denominator / Time`、`Offset` 一并读出。
- 上限：16 MiB 文件、解压后 16 MiB、50,000 音符。

## 串链

链的判据与原版同律：按 `(l, r)` → `(l2, r2)` 匹配，`Uid` 严格递增，端点时刻差压回 float32 后小于 `0.0001`。

两侧都转 float32 再比是必要的。`holds` 末项与后继 `just` 的实际差值会落在 `1e-4` 两侧，例如 `101.8751` 与 `101.875` 在 double 域相差 `1.0000000033e-4` 判不中，float32 域相差 `9.9182e-5` 才判中。

允许一条链汇合到共享后继，`prev` 仅作「非根」标记，不拒绝共享。

## 同时押

按判定时刻分组，容差 4 ms。**只有链首与链尾参与**：链首取 `just`，链尾取末节点终点。链中节点的接缝不参与分组，这与原版 Prepare 的口径一致。

## 音符外观

四类音符使用原版贴图 `ui_sc2_ingame_notes_{tap,hold,flick,trace}.png`（128×68 / Trace 128×48），
九宫格边距 `border = (60,0,60,0)`、`ppu = 100`，与 `llll-preview-web/public/rg/` 同源。

尺寸照 `ISlopeResolver`：

```
GetNoteSize(width) = ((width − 6) × 0.2 + 1.15, 1.0)   // width = |l − r| + 1
```

再乘 prefab 里 `SpriteRenderer` 的 `scale.x = 0.75`。纵向厚度 `type === 3 ? 0.35 : 0.45`。
单格音符的视觉宽度 0.15 恰等于一格逻辑宽度（`laneWidth`）。

横向九宫格按 Unity `SpriteDrawMode.Sliced`：左右端头各取 `border / ppu × scale`
（**保持原生尺寸，圆角不变形**），两端头之和超过目标宽度时等比缩到恰好铺满、中段为 0。
端头宽约 0.45 世界单位，比单格音符本体（0.15）还宽 —— 单格与双格音符整条都由端头构成，
所以它们看起来是圆润的胶囊；宽音符则由「端头 + 拉伸中段 + 端头」拼成。

平面视图令一格 = `lanePx` 像素，于是 `pxPerWorld = lanePx / 0.15`，横纵共用同一比例，
贴图纵横比与原版一致。**九宫格边距与世界尺寸必须同一口径**：把像素宽当世界宽传进去，
端头会缩到不足 1px，圆角就没了。

### Flick 的附加元素

原版 `NoteFlickView` 除了本体 `Silhouette`，还挂三个装饰子节点，全部不染色（颜色来自贴图本身）：

| 子节点 | 贴图 | 尺寸来源 | 摆放 |
|---|---|---|---|
| `Arrow-Left` / `Arrow-Right` | `ui_sc2_ingame_notes_texture_arrow` 52×50 | 宽 `ISx×0.45`、高 `0.45×1.45`（`ISx` = `GetNoteSize(width).x`） | 两块各偏中心 ±宽/2，右侧水平翻转 |
| `Symbol` | `ui_sc2_ingame_notes_icon_flick` 120×90 | 原生尺寸 × 0.6 | 居中 |
| `Sign` | `ui_sc2_ingame_flick_sign` 323×250 | 原生尺寸 × 0.8 | 居中，并沿「上」抬 1 世界单位 |

箭头贴图靠 **UV repeat 平铺**（`spriteMeshType` 已改 FullRect），重复次数 = 目标宽 / 单块宽，
可为小数 —— 故最后一块按剩余宽度裁源图，不能取整。单块宽 = 贴图原生宽 × `scale.x`，
与音符宽度无关；音符变宽只会让重复次数变多。

尺寸一律按 `pxPerWorld` 换算，不随 `pxPerSec` 变化 —— 它们是世界空间里的固定尺寸装饰。
`Arrow` 贴图 alpha 上限仅 82（一层很淡的光晕），`Symbol` 与 `Sign` 则是实心绿色。

未实现的原版动态：`Sign` 的 0.9↔1.1 纵向余弦浮动（`FlickSignView`，周期 1s、全场同相、
无相位种子）。它只是让 Sign 在基准位上下荡，静态读谱取中值即 prefab 的 `y = 1`。

## Hold 宽带

照 `HoldMeshView`：每节点三列顶点，左列与右列取 `SideColor`、中列取 `CenterColor`，
RGB 恒定、alpha 随是否按住变化（未按住 0.60 / 0.20）。三列的轨道坐标：

```
GetLeftMeshX(xl)  = lane0Left + laneWidth * (xl + 1)   ⇒ 轨道坐标 l + 1
GetRightMeshX(xr) = lane0Left + laneWidth * xr         ⇒ 轨道坐标 r
GetCenterMeshX(m) = lane0Left + laneWidth * (m + 0.5)  ⇒ 轨道坐标 (l+r)/2 + 0.5
```

⇒ **宽带比音符本体左右各内缩整一格**，带宽 `(Width − 2)` 格。`Width = 1` 时带宽为负、
绕序翻转，原版照画不补最小宽度；`Width = 2` 时恰为 0。

顶点色**沿带长恒定**（左列恒 Side、中列恒 Center、右列恒 Side），色场只随「垂直于带身的距离」变化。
所以横向渐变轴必须**垂直于带轴**：直接用两列中点连线会得到一条水平轴，斜置或弧形的带子
据此上色就会沿长度漂色（实测斜带每行剖面漂到 `243 190 …` 与 `129 103 79 56` 两套值）。
正确做法是把两列中点投影到过形心的带法线方向；修正后六行剖面逐值相同（`129 103 79 56 79 103 129`）。

头尾另贴 `ui_sc2_ingame_notes_hold`（原版 prefab 的 `Silhouette` / `Silhouette-End`）。

## 坐标系

原版轨道在世界空间是 `lanePitch × (lane − 29.5)` 的连续坐标（`laneWidthOpt = 100` 时 `lanePitch = 0.15`），
60 格铺开为 ±4.5。平面视图只关心相对关系，故取单位轨宽 = 1：

```
左缘 = lane − 29.5,  右缘 = (lane + 1) − 29.5
```

**不搬 3D 侧的 `worldWidthOf(width)`**：那条公式把 60 轨映射到世界宽度的观感口径，
平面视图直接用格宽更忠实。音符自身宽度走原版 `GetNoteSize`（见上）。

## 朝向

横轴 = 轨道，纵轴 = 时间，**时间向上递增**：0 秒在内容底端，总时长在顶端。

游戏是下落式的——未来的音符从上方落下。平面视图沿用同一朝向，读谱方向和游戏里一致；
`timeY` 因此以 `duration` 为锚（`padY + (duration − t) × pxPerSec − scrollPx`），
`Layout` 需带谱面时长。

**注意**：换轴会把谱面作者画的图形整体上下翻转（爱心、箭头等）。这是该朝向的固有代价，
不是渲染缺陷——同一组航点在游戏视图里也是这个朝向。

镜像即 `x → 左界 + 右界 − x`。

## 音符几何

- 瞬时音符（Single / Flick / Trace）：贴图以时刻为中心，横向覆盖 `[l, r]`。
- Hold：每个节点画两条宽带半边（左列→中列、中列→右列），头边在 `[l, r]`、尾边在 `[l2, r2]`，中间线性。
- 链：逐节点画，**顺序 = 源数组顺序**。同 tick 折返的航点靠顺序表达路径，任何按轨道号二次排序都会让图形走形。
- 零时长节点（`end ≤ time`）不画。

## 小节线

沿 BPM 段与拍号段的并集切段，每段按 `60 / BPM × 分子` 推进。段首为强拍。缺拍号时按 4/4。无 BPM 段时不出线。上限 20,000 条。

## 语料校验

`pnpm verify:corpus` 对本地谱面目录跑解析与几何有限性校验：逐音符检查时刻有限、横向范围为正；逐链检查四边形坐标有限；逐瞬时音符检查矩形合法；逐小节线检查时间有限。

契约校验 `scripts/cross-check.ts` 对同一批谱面比对本仓库与 `llll-preview-web` 的音符数、链首数、同时押组数。

## 非原版一致部分

原版没有这个视角，本工具是另一种读谱方式，不宣称与任何原版视图一致。

音符与 Hold 宽带的外观沿用原版贴图与顶点色口径；平面视图的**排版**（轨道格线、小节线、
同时押连线、判定线）均为本工具自有，不是原版渲染的还原。原版 Hold 有按帧推进的呼吸光
（`HoldMeshView.ProcessView` 的余弦脉动），本工具是静态读谱，不实现该动画。

JavaScript double 不模拟 float32 逐指令语义；只有串链判据按 float32 域比较。

## 素材来源

`public/rg/sprites/` 与 `public/rg/sprite_meta.json` 取自游戏客户端资源，与 `llll-preview-web/public/rg/` 同源，
权利归各原权利人所有，仅供非商业研究与互操作验证，不构成授权转载、再分发或商用许可。

## 参考

`llll-preview-web` 提供源格式解析、链语义与音符外观的口径；`llll-chart2sus` 提供同 tick 折返航点必须保序的结论。
Hold 宽带规格取自原包二进制核准的 `HOLD_MESH.md`。本仓库不复制其代码。
