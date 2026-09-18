/** Score + rank (4.12.0 ScoreResolver / ScoreRankExtensions).
 *
 * halfwayScore = TotalAppeal * (1 + MusicMasteryLevel * 0.01) / AllNoteSize
 * CalcAdd(factor) = ceil(halfwayScore * factor * (1 + VoltageLevel * 0.1))
 * factorMap: Bad5 Good15 Great25 Perfect30 PP35
 * Rank: rankValues desc [S,A,B,C]; first i with rankValues[i] <= score → scoreRank = 4-i; else None(0)
 * Gauge fill: piecewise (0,0)/(C,.409)/(B,.587)/(A,.773)/(S,.912)/(1.5S,1)
 * Technical: weights Bad20..PP101; push = raw/N*10000 (mode 2 assumes remain=PP)
 *
 * AllNoteSize = Σ_roots (Holds.length+1) after Pass2 GetHolds; same ticks as LiveHud countHeads.
 */

import type { Chart } from './chart';
import { chartAllNoteSize } from './chart';
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


/** ApResolver.Scaler */
export const AP_SCALER = 10_000;
/** ApResolver.StandardValue — basePlus = STANDARD / AllNoteSize */
export const AP_STANDARD_VALUE = 600_000;

/** eps-ceiling used by ApResolver.Add (@0x4AFF0B4). */
export function apCeilEps(g: number): number {
  const t = Math.trunc(g);
  return g - t >= 0.0001 ? Math.ceil(g) : t;
}

/**
 * ApResolver.Add(type, rate): Miss/Bad no recover; Good → halfPlus; Great/P/PP → basePlus.
 * g = b * (1 + rate * 0.1); ap += ceil_eps(g).
 */
export function apAddDelta(
  type: NoteJudgementType,
  apRate: number,
  basePlus: number,
  halfPlus: number,
): number {
  if (type <= 1) return 0;
  const b = type === 2 ? halfPlus : basePlus;
  return apCeilEps(b * (1 + apRate * 0.1));
}

/** Display: d = ap * 0.0001; integer = floor(d); gauge = fractional part. */
export function apDisplay(ap: number): { value: number; gauge: number } {
  const d = ap * 0.0001;
  const value = Math.floor(d);
  let gauge = d - value;
  if (gauge < 0) gauge = 0;
  if (gauge > 1) gauge = 1;
  return { value, gauge };
}

/**
 * VoltageResolver.CalcLevel(point).
 * p>=2100 → floor((p-2100)*0.005)+20; else triangular: t=floor(p*0.1); smallest n with T_n>t, level=n-2.
 */
export function voltageCalcLevel(point: number): number {
  const p = Math.max(0, point);
  if (p >= 2100) return Math.floor((p - 2100) * 0.005) + 20;
  const t = Math.floor(p * 0.1);
  let n = 0;
  // T_n = n(n+1)/2; find smallest n with T_n > t
  while ((n * (n + 1)) / 2 <= t) n += 1;
  return Math.max(0, n - 2);
}

/**
 * VoltageResolver.CalcGauge(point, level) → 0..1 ring fill.
 */
export function voltageCalcGauge(point: number, level: number): number {
  const p = Math.max(0, point);
  const L = Math.max(0, level);
  if (p >= 2100) {
    const g = (p - 200 * L + 1900) * 0.005;
    return Math.min(1, Math.max(0, g));
  }
  const denom = ((L + 2) * (L + 1) - (L + 1) * L) * 5;
  if (denom <= 0) return 0;
  const g = (p - (L + 1) * L * 5) / denom;
  return Math.min(1, Math.max(0, g));
}

/** get_VoltageLevel = level << (fever ? 1 : 0) */
export function voltageLevelDisplayed(level: number, isFever: boolean): number {
  const L = Math.max(0, Math.trunc(level));
  return isFever ? L << 1 : L;
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
  /** ApResolver raw accumulator (Scaler 10000). */
  apPoints = 0;
  /** VoltageResolver.point — preview has no skills ⇒ stays 0. */
  voltagePoints = 0;
  rank: ScoreRankId = 0;
  readonly judgements = [0, 0, 0, 0, 0, 0];
  private halfway = 0;
  private noteCount = 1;
  private basePlus = AP_STANDARD_VALUE;
  private halfPlus = AP_STANDARD_VALUE * 0.5;
  private isFever = false;
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
    this.apPoints = 0;
    this.voltagePoints = 0;
    this.rank = 0;
    for (let i = 0; i < 6; i++) this.judgements[i] = 0;
    this.noteCount = chart ? chartAllNoteSize(chart) : 1;
    this.basePlus = AP_STANDARD_VALUE / Math.max(1, this.noteCount);
    this.halfPlus = this.basePlus * 0.5;
    this.halfway = halfwayScore(
      this.cfg.totalAppeal,
      this.cfg.musicMasteryLevel,
      this.noteCount,
    );
  }

  setFever(on: boolean): void {
    this.isFever = on;
  }

  get feverActive(): boolean {
    return this.isFever;
  }

  /** VoltageResolver level before Fever doubling. */
  get voltageBaseLevel(): number {
    return voltageCalcLevel(this.voltagePoints);
  }

  /** Displayed VoltageLevel (Fever doubles). Also drives score CalcAdd when wired via cfg. */
  get voltageLevel(): number {
    return voltageLevelDisplayed(this.voltageBaseLevel, this.isFever);
  }

  get apDisplayValue(): number {
    return apDisplay(this.apPoints).value;
  }

  get apGauge(): number {
    return apDisplay(this.apPoints).gauge;
  }

  get voltageGauge(): number {
    return voltageCalcGauge(this.voltagePoints, this.voltageBaseLevel);
  }

  /** Skill-only in original; preview may call for tests. */
  addVoltagePoints(delta: number): void {
    this.voltagePoints = Math.max(0, this.voltagePoints + delta);
    this.cfg.voltageLevel = this.voltageLevel;
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
      if (mentalAlive) this.score += calcAdd(this.halfway, type, this.voltageLevel);
      this.rank = getScoreRank(this.score, this.cfg.rankValues);
      return;
    }
    this.combo += 1;
    if (this.userCombo < this.combo) this.userCombo = this.combo;
    if (mentalAlive) this.score += calcAdd(this.halfway, type, this.voltageLevel);
    this.apRate = Math.min(Math.max(this.apRate, Math.trunc(this.combo * 0.1)), 5);
    this.apPoints += apAddDelta(type, this.apRate, this.basePlus, this.halfPlus);
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
