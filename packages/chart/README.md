# @sukushow/chart

莲之空（Link! Like! ラブライブ！）原格式谱面的解析，以及曲目的 Fever 时段与曲终时刻。LLLL 舞台、PJSK 渲染、SVG 导出与统一前端都从这里取，源码不依赖 Node，浏览器与 Node 都能直接调用。

| 模块 | 内容 |
| --- | --- |
| `chart` | `decodeChart` / `parseChart`：解压与解析、Hold 串链、同时押分组；`getHolds`、`noteJudgementTimes`、`chartAllNoteSize`：判定航点与最大连击 |
| `fever` | `FeverWindow`、`isFeverAt`、`feverFromMusicScore`（由 CSV 与段号算时段）、`parseFeverWindow`（手动输入） |
| `songTiming` | 按曲目 Id 查 Fever、FeverChance 代理窗口与曲终：`feverForSong`、`feverChanceForSong`、`finishTimeForSong` |
| `masterdata` | `Musics.yaml` / `MusicScores.yaml` 的行解析、谱面文件名解析 |

```ts
import { decodeChart } from '@sukushow/chart/chart';
import { parseChartName } from '@sukushow/chart/masterdata';
import { feverForSong, finishTimeForSong } from '@sukushow/chart/songTiming';

const chart = decodeChart(bytes);
const songId = parseChartName('rhythmgame_chart_103119_04.bytes')?.musicId;
const fever = feverForSong(songId);           // { start, end } 或 null
const finish = finishTimeForSong(songId);     // 秒，或 null
const end = finish ?? chart.duration;         // 没有曲目元数据时用末音符 + 2 秒
```

口径与二进制依据见 [docs/evidence.md](docs/evidence.md)。

## 脚本

```bash
pnpm build             # 类型检查：src 按浏览器环境，脚本与测试按 Node 环境
pnpm test
pnpm verify:corpus     # 解析本地谱面目录，核对最大连击与主数据、曲终不早于末音符
pnpm metadata:timing <masterdata 目录> <cache/plain 目录>   # 重新生成 src/songTiming.json
```

`verify:corpus` 默认读 `apps/web/public/assets/chart`，也可以传入谱面目录。

## 许可

MIT。
