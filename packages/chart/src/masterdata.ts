/**
 * 主数据解析——`masterdata/*.yaml` 里用得到的那几项。
 *
 * 只解析需要的那几个字段，不引 YAML 依赖：这两张表都是「`- Id: N` 起一条、下面一行一个
 * `Key: value`」的扁平结构，行解析足够可靠，也免得为一个字段拖进整棵依赖树。
 * 这里只处理文本，读文件由调用方负责。
 *
 * - `MusicScores.yaml`：每难度 `MaxCombo`（权威值）+ 等级
 * - `Musics.yaml`：`Title` / `FeverSectionNo` / `PlayTime`
 */

/** 难度序号（谱面文件名后缀）→ 主数据里的字段前缀。 */
export const DIFFICULTY_NAMES = ['Normal', 'Hard', 'Expert', 'Master'] as const;
export type Difficulty = (typeof DIFFICULTY_NAMES)[number];

/** 谱面文件名后缀 `01/02/03/04` → 难度。 */
export function difficultyFromSuffix(suffix: string): Difficulty | null {
  const i = Number(suffix) - 1;
  return DIFFICULTY_NAMES[i] ?? null;
}

export interface ScoreInfo {
  /** 难度等级。 */
  level?: number;
  /** 权威最大连击数。 */
  maxCombo?: number;
}

export interface MusicInfo {
  /** 曲名。 */
  title?: string;
  /** Fever 段号（1～5）。 */
  feverSectionNo?: number;
  /** 曲终时刻（毫秒）。节奏游戏的 FinishTime = PlayTime / 1000。 */
  playTime?: number;
}

/** 解析 `MusicScores.yaml`：`Id → 难度 → { level, maxCombo }`。 */
export function parseMusicScores(yaml: string): Map<number, Record<Difficulty, ScoreInfo>> {
  const out = new Map<number, Record<Difficulty, ScoreInfo>>();
  let id: number | null = null;
  let cur: Record<Difficulty, ScoreInfo> | null = null;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#') || !line) continue;
    const idMatch = /^-\s*Id:\s*(\d+)$/.exec(line);
    if (idMatch) {
      id = Number(idMatch[1]);
      cur = { Normal: {}, Hard: {}, Expert: {}, Master: {} };
      out.set(id, cur);
      continue;
    }
    if (id === null || !cur) continue;
    // 碰到下一条记录或缩进变化就停止（本文件里 `- Id:` 是顶层）。
    if (line.startsWith('- ')) { id = null; cur = null; continue; }
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    for (const d of DIFFICULTY_NAMES) {
      if (key === `${d}MaxCombo`) cur[d].maxCombo = Number(value);
      else if (key === `${d}Level`) cur[d].level = Number(value);
    }
  }
  return out;
}

/** 解析 `Musics.yaml`：`Id → { title, feverSectionNo, playTime }`。 */
export function parseMusics(yaml: string): Map<number, MusicInfo> {
  const out = new Map<number, MusicInfo>();
  let id: number | null = null;
  let cur: MusicInfo | null = null;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#') || !line) continue;
    const idMatch = /^-\s*Id:\s*(\d+)$/.exec(line);
    if (idMatch) {
      id = Number(idMatch[1]);
      cur = {};
      out.set(id, cur);
      continue;
    }
    if (id === null || !cur) continue;
    if (line.startsWith('- ')) { id = null; cur = null; continue; }
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === 'Title') cur.title = value.replace(/^["']|["']$/g, '');
    else if (key === 'FeverSectionNo') cur.feverSectionNo = Number(value);
    else if (key === 'PlayTime') cur.playTime = Number(value);
  }
  return out;
}

/** 从 `rhythmgame_chart_203117_04.bytes`（或 `.json`）这类文件名里取 (曲目 Id, 难度后缀)。 */
export function parseChartName(file: string): { musicId: number; suffix: string } | null {
  const m = /rhythmgame_chart_(\d+)_(\d+)\.(?:bytes|json)$/i.exec(file);
  return m ? { musicId: Number(m[1]), suffix: m[2] } : null;
}
