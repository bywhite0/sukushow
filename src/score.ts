/** Score + rank (4.12.0 ScoreResolver / ScoreRankExtensions).
 *
 * halfwayScore = TotalAppeal * (1 + MusicMasteryLevel * 0.01) / AllNoteSize
 * CalcAdd(factor) = ceil(halfwayScore * factor * (1 + VoltageLevel * 0.1))
 * factorMap: Bad5 Good15 Great25 Perfect30 PP35
 * Rank: rankValues desc [S,A,B,C]; first i with rankValues[i] <= score → scoreRank = 4-i; else None(0)
 * Gauge fill: piecewise (0,0)/(C,.409)/(B,.587)/(A,.773)/(S,.912)/(1.5S,1)
 * Technical: weights Bad20..PP101; push = raw/N*10000 (mode 2 assumes remain=PP)
 *
 * Preview AllNoteSize = chart.notes.length (line-cross ticks = combo heads), so
 * full-combo score matches the same denominator as LiveHud countHeads.
 */

import type { Chart } from './chart';
import type { NoteJudgementType } from './rgOptions';

export type ScoreRankId = 0 | 1 | 2 | 3 | 4; // None C B A S
export type ScoreRankLetter = 'D' | 'C' | 'B' | 'A' | 'S';

export const FACTOR_MAP: readonly number[] = [
  0, // Miss — never scored via CalcAdd
  5, // Bad
  15, // Good
  25, // Great
  30, // Perfect
  35, // PerfectPlus
];

/** TechnicalScoreResolver PlayerRateWeights for Bad..PP */
export const TECH_WEIGHTS: readonly number[] = [20, 50, 90, 100, 101];

/** masterdata series 1/3 typical row: V4..V1 → [S,A,B,C] */
export const DEFAULT_SCORE_RANK_VALUES: readonly [number, number, number, number] = [
  10_000_000, 5_000_000, 1_500_000, 500_000,
];

/** Play-test style appeal so full-PP charts can leave D and climb ranks. */
export const DEFAULT_TOTAL_APPEAL = 350_000;
/** 曲目熟练度等级（マスタリー / MusicMasteryLevel）；公式里按 ×0.01 加成。 */
export const DEFAULT_MUSIC_MASTERY_LEVEL = 0;

export function chartAllNoteSize(chart: Chart): number {
  return Math.max(1, chart.notes.length);
}

export function halfwayScore(
  totalAppeal: number,
  musicMasteryLevel: number,
  allNoteSize: number,
): number {
  const n = Math.max(1, allNoteSize);
  return (totalAppeal * (1 + musicMasteryLevel * 0.01)) / n;
}

export function calcAdd(
  halfway: number,
  judgement: NoteJudgementType,
  voltageLevel = 0,
): number {
  if (judgement <= 0) return 0; // Miss
  const factor = FACTOR_MAP[judgement] ?? 0;
  if (factor <= 0) return 0;
  const x = halfway * factor * (1 + voltageLevel * 0.1);
  return Math.ceil(x);
}

/** rankValues descending [S,A,B,C]. Returns 0=None, 1=C, 2=B, 3=A, 4=S. */
export function getScoreRank(
  score: number,
  rankValues: readonly [number, number, number, number] = DEFAULT_SCORE_RANK_VALUES,
): ScoreRankId {
  for (let i = 0; i < 4; i++) {
    if (rankValues[i] <= score) return (4 - i) as ScoreRankId;
  }
  return 0;
}

export function scoreRankLetter(rank: ScoreRankId): ScoreRankLetter {
  // scoreRank 0 = None → letter table maps to D (active D material when scored).
  return (['D', 'C', 'B', 'A', 'S'] as const)[rank];
}

/** HUD letter: Clear (score 0) stays inactive; None-with-score shows D. */
export function scoreRankDisplay(
  rank: ScoreRankId,
  score: number,
): 'none' | 'D' | 'C' | 'B' | 'A' | 'S' {
  if (rank === 0) return score > 0 ? 'D' : 'none';
  return scoreRankLetter(rank);
}

/** Piecewise gauge fill 0..1 from score + rank thresholds [S,A,B,C]. */
/** Fill fractions at C/B/A/S on the 330px slider (RankLabels keep dump xs ≈2px off). */
export const GAUGE_FILL_AT_RANK: readonly [number, number, number, number] = [
  0.409, 0.587, 0.773, 0.912,
];

export function scoreGaugeFill(
  score: number,
  rankValues: readonly [number, number, number, number] = DEFAULT_SCORE_RANK_VALUES,
): number {
  const s = rankValues[0];
  const a = rankValues[1];
  const b = rankValues[2];
  const c = rankValues[3];
  const cap = Math.min(s * 1.5, 9_999_999_999);
  // Fill fractions align RankLabels on the 330px slider (review):
  // C.409 B.587 A.773 S.912; 1.5S caps at 1.
  const pts: { score: number; value: number }[] = [
    { score: 0, value: 0 },
    { score: c, value: 0.409 },
    { score: b, value: 0.587 },
    { score: a, value: 0.773 },
    { score: s, value: 0.912 },
    { score: cap, value: 1 },
  ];
  if (score <= 0) return 0;
  for (let i = 1; i < pts.length; i++) {
    const lo = pts[i - 1];
    const hi = pts[i];
    if (score <= hi.score) {
      const span = hi.score - lo.score;
      if (span <= 0) return hi.value;
      const t = (score - lo.score) / span;
      return lo.value + (hi.value - lo.value) * t;
    }
  }
  return 1;
}

export function technicalRaw(
  counts: readonly number[], // index by NoteJudgementType 0..5
): number {
  // Σ judgements[type] * weight for Bad..PP (type 1..5 → weights 0..4)
  let raw = 0;
  for (let type = 1; type <= 5; type++) {
    raw += (counts[type] ?? 0) * (TECH_WEIGHTS[type - 1] ?? 0);
  }
  return raw;
}

/** UI push value before /10000 percent formatting. */
export function technicalPushValue(
  counts: readonly number[],
  totalNoteCount: number,
  mode: 0 | 1 | 2,
  mentalAlive = true,
): number {
  if (!mentalAlive || mode === 0) return 0;
  const n = Math.max(1, totalNoteCount);
  const judged = counts.reduce((a, b) => a + b, 0);
  const next = counts.slice();
  if (mode === 2) {
    const remain = n - judged;
    if (remain > 0) next[5] = (next[5] ?? 0) + remain;
  }
  const raw = technicalRaw(next);
  return Math.trunc((raw / n) * 10000);
}

export function technicalPercent(push: number): number {
  return push / 10000;
}

export interface ScoreEngineConfig {
  totalAppeal: number;
  musicMasteryLevel: number;
  rankValues: readonly [number, number, number, number];
  voltageLevel: number;
}

export const DEFAULT_SCORE_CONFIG: ScoreEngineConfig = {
  totalAppeal: DEFAULT_TOTAL_APPEAL,
  musicMasteryLevel: DEFAULT_MUSIC_MASTERY_LEVEL,
  rankValues: DEFAULT_SCORE_RANK_VALUES,
  voltageLevel: 0,
};

export class ScoreEngine {
  score = 0;
  combo = 0;
  userCombo = 0;
  apRate = 0;
  rank: ScoreRankId = 0;
  readonly judgements = [0, 0, 0, 0, 0, 0];
  private halfway = 0;
  private noteCount = 1;
  private cfg: ScoreEngineConfig;

  constructor(cfg: ScoreEngineConfig = DEFAULT_SCORE_CONFIG) {
    this.cfg = { ...cfg, rankValues: [...cfg.rankValues] as [number, number, number, number] };
  }

  configure(cfg: Partial<ScoreEngineConfig>): void {
    this.cfg = {
      ...this.cfg,
      ...cfg,
      rankValues: (cfg.rankValues
        ? [...cfg.rankValues]
        : [...this.cfg.rankValues]) as [number, number, number, number],
    };
  }

  reset(chart: Chart | null): void {
    this.score = 0;
    this.combo = 0;
    this.userCombo = 0;
    this.apRate = 0;
    this.rank = 0;
    for (let i = 0; i < 6; i++) this.judgements[i] = 0;
    this.noteCount = chart ? chartAllNoteSize(chart) : 1;
    this.halfway = halfwayScore(
      this.cfg.totalAppeal,
      this.cfg.musicMasteryLevel,
      this.noteCount,
    );
  }

  get allNoteSize(): number {
    return this.noteCount;
  }

  get halfwayScore(): number {
    return this.halfway;
  }

  /** AutoPlay / live hit. Miss/Bad clear combo; preview AutoPlay uses Perfect/PP only. */
  add(type: NoteJudgementType, mentalAlive = true): void {
    this.judgements[type] = (this.judgements[type] ?? 0) + 1;
    if (type === 0) {
      this.combo = 0;
      this.apRate = 0;
      return;
    }
    if (type === 1) {
      this.combo = 0;
      this.apRate = 0;
      if (mentalAlive) this.score += calcAdd(this.halfway, type, this.cfg.voltageLevel);
      this.rank = getScoreRank(this.score, this.cfg.rankValues);
      return;
    }
    this.combo += 1;
    if (this.userCombo < this.combo) this.userCombo = this.combo;
    if (mentalAlive) this.score += calcAdd(this.halfway, type, this.cfg.voltageLevel);
    this.apRate = Math.min(Math.max(this.apRate, Math.trunc(this.combo * 0.1)), 5);
    this.rank = getScoreRank(this.score, this.cfg.rankValues);
  }

  /** Apply `hits` identical judgements (batch from countHeads). */
  addMany(type: NoteJudgementType, hits: number, mentalAlive = true): void {
    for (let i = 0; i < hits; i++) this.add(type, mentalAlive);
  }

  gaugeFill(): number {
    return scoreGaugeFill(this.score, this.cfg.rankValues);
  }

  technicalPush(mode: 0 | 1 | 2, mentalAlive = true): number {
    return technicalPushValue(this.judgements, this.noteCount, mode, mentalAlive);
  }
}
