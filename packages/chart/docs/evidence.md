# 口径依据

二进制依据取自 LLLL 4.12.0 的 `libil2cpp.so` 与同版本 `dump.cs`，地址为 RVA。

## 源格式

- 游戏的谱面文件（`rhythmgame_chart_<Id>_<难度>.bytes`）都是 raw-deflate 压缩的 JSON，本地 617 张逐个核对无一例外；解压用 fflate 的同步实现。解析也接受未压缩的 JSON 文本，供前端打开本地 `.json`（解压后或手写的谱面）。
- 顶层字段：`Notes`、`Bpms`，可选 `Beats`、`Offset`。`Notes[].just` 与 `holds` 是绝对秒。
- `Flags` 为位域：

  ```
  type = f & 15          r = (f >>> 4) & 63     r2 = (f >>> 10) & 63
  l    = (f >>> 16) & 63 l2 = (f >>> 22) & 63
  ```

  轨道号 0…59；`l > r`、Hold 的 `l2 > r2`、倒序的 `holds` 由解析层拒绝。
- 上限：文件 16 MiB、解压后 16 MiB、50,000 音符。

## 串链

`ChartResolver.Prepare` @0x48694A4 的 Pass1：按数组顺序对每个 Hold 取首个满足 `IsCombine` 的后继，命中即 `prev.Next = x; x.Prev = prev`。后写覆盖，允许汇合，`Prev` 只作「非根」标记。

`IsCombine` @0x485CFFC：两者都是 Hold、`x.Uid > prev.Uid`、`prev.L2 == x.L1`、`prev.R2 == x.R1`，且 `LooseEquals(prev.Holds[^1], x.Just)`。`LooseEquals` @0x485CF1C 是单精度 `fabd(x, y) < 9.9999997e-5f`（字面量 @0x1AA0E84）。实现把两侧和差值都压回 float32 再比：例如 `101.8751` 与 `101.875` 在 double 域相差 `1.0000000033e-4`，判不中；在 float32 域相差 `9.9182e-5`，判中。

判据不看段长：零长段（`holds[^1] == just`，链中的横向瞬移点）照样串进链里。

## 同时押

按判定时刻分组，容差 4 ms。只有链首与链尾参与：链首取 `just`，链尾取末节点终点；链中节点的接缝不参与分组。

## 最大连击

`chartAllNoteSize` 是 Prepare 之后的 `AllNoteSize`：非 Hold 各算 1；Hold 只算链首，即链首本身 1 加判定航点数。单段 Hold 用 JSON 的 `holds`；多段链用 `getHolds(链首 just, 链尾终点)` 重算，链中节点不计。

`getHolds` 照 `RhythmGameConsts.GetHolds` @0x485D11C，全程 float32：

- 半拍步长 `(60f / Bpm) * 0.5f` 单精度累加；
- 循环内贴近终点用 `LooseEquals`；
- 收尾的 `(long)(|end − last| × 10000f) <= 1` 按截断取整；
- 取 BPM 用 `RhythmGameConsts.Get` @0x485D410，早于首段时回落到**最后一段**。

全量 616 张谱面与 `MusicScores.yaml` 的 `MaxCombo` 全部一致，`pnpm verify:corpus` 逐张核对。显示时仍优先用主数据的 `MaxCombo`，自算值用于兜底与自检。

## Fever 时段

节奏游戏的 `FeverResolver.Inject` @0x4990388：

1. 新建 `QuestLiveMusicScore`，调用 `LoadCsv(arguments.MusicsRecord)`（0x4990498）。节奏游戏与 QuestLive 共用这份 `musicscore_<Id>.csv`。
2. `n = MusicsRecord.FeverSectionNo`（+0x70）。
3. `startTime = n == 1 ? 0 : 分段表[n − 2].SongTime`；`endTime = (n − 1 >= 4) ? MusicEndTime : 分段表[n − 1].SongTime`（0x4990508–0x4990570）。

`QuestLiveMusicScore.LoadCsv(MusicsRecord)` @0x41A537C：

- CSV 每行 5 列，`SongTime = (float)song_time / 1000f`；
- 分段表 = `KeyType == 20` 的行按 `SongTime` 升序（谓词 0x41A5F88，排序 0x41A5B94）；
- `MusicEndTime` = `LastOrDefault(KeyType == 99)?.SongTime`（谓词 0x41A5FC0，调用 0x41A5C44），按 CSV 原始行序取最后一条。没有 99 行时不写入，保持 0。

于是第 n 段 = `[段表[n−1], 段表[n])`，段表 = `[0, 四个边界, MusicEnd]`；只有第五段的终点用到 MusicEnd。区间左闭右开。现有 236 首的 CSV 都恰好只有一条 99 行。

四个边界严格递增、第五段要求 MusicEnd 晚于末段起点，是预览器的校验，客户端不做。

## 曲终

节奏游戏的曲终 `FinishTime` 取主数据 `Musics.PlayTime`，与 CSV 无关：

- `RhythmGameMainSceneParam..ctor` @0x4AEB7F0：`FinishTime = (float)MusicsRecord.PlayTime / 1000f`（PlayTime 在 +0x6C，0x4AEC064–0x4AEC078）。
- `MainLogicResolver` 初始化时 `comboResult.Time = arguments.FinishTime`。
- `MainLogicResolver.Process` @0x49912F8：当前时刻 = `bgm.CurrentTime + MusicJudgementSec`，达到 `comboResult.Time` 时进入结算（0x4991DE8–0x4991ED0）。

236 首里有 7 首的 PlayTime 与 CSV 的 MusicEnd 不同，差值从 −1.218 到 +4.140 秒。其中第五段 Fever 的只有 203302：Fever 在 117.073 秒结束，曲终是 117.240 秒。全量 616 张谱面里，曲终减末音符终点最小为 −0.3 毫秒（主数据是整毫秒），最大 5.758 秒。

`Chart.duration`（末音符 + 2 秒）只用于没有曲目元数据的谱面。

## FeverChance

llll 没有 FeverChance 的概念（CSV 的 `key_type` 只有 1 / 10 / 20 / 99）。时间索引里的 `chanceStart` / `chanceEnd` 取 Fever 前一段，是给视觉近似用的代理值；Fever 在第一段时为 null。

## 时间索引

`src/songTiming.json` 由 `pnpm metadata:timing <masterdata 目录> <cache/plain 目录>` 从 `Musics.yaml` 与 `musicscore_<Id>.csv` 生成，每首记 Fever、chance 与曲终（秒）。`apps/web` 的测试核对曲目列表的 `playTime` 与索引的曲终逐首一致。
