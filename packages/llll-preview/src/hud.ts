import type { Chart, Note } from '@sukushow/chart/chart';
import {
  AP_RATE_FLASH_DURATION,
  COMBO_FLASH_DURATION,
  apRateFlashAlpha,
  apRateFlashScale,
  comboFlashAlpha,
  comboFlashScale,
  shouldComboHundredFlash,
  apGageFlashScale,
  apGageFlashAlpha,
  AP_GAGE_FLASH_DURATION,
  apRateBurstScale,
  apRateBurstRootAlpha,
  apRateBurstCoreColor,
  apRateBurstParticleScale,
  apRateBurstParticleColor,
  apRateBurstSpawn,
  apRateBurstTravel,
  lerpRange,
  AP_RATE_BURST_DURATION,
  AP_RATE_BURST_ACTIVATE_DELAY,
  AP_RATE_BURST_ROOT,
  AP_RATE_BURST_CORE,
  AP_RATE_PARTICLE,
  AP_RATE_CLOSS,
  apContinueAfterHit,
  apContinueEffectVisible,
  comboEffectUpperAlpha,
  comboEffectLowerAlpha,
  comboEffectOutlineBox,
  comboEffectUpperOutlineScale,
  comboEffectRefreshLoop,
  COMBO_EFFECT_LOWER_START_A,
  COMBO_EFFECT_UPPER_START_A,
  COMBO_EFFECT_LOWER_BURST,
  COMBO_EFFECT_UPPER_BURST,
  COMBO_EFFECT_UPPER_LIFE,
  COMBO_EFFECT_UPPER_ACTIVATE_DELAY,
  COMBO_GLOW_BURST,
  COMBO_GLOW_LIFE,
  comboGlowUpperCurve,
  comboGlowLowerCurve,
  COMBO_GLOW_UPPER_ALPHA,
  COMBO_GLOW_LOWER_ALPHA,
  scoreAddTweenX,
  scoreAddTweenAlpha,
  SCORE_ADD_LIFE,
  SCORE_ADD_REST_X,
} from './hudFxMath';

import {
  type Ctx,
  type Rect,
  deviceScale,
  drawContain,
  drawGroup,
  drawOutlinedText,
  drawSprite,
  drawText,
  fillRoundRect,
  fontExtents,
  image,
  insetRing,
  outerBlurShadow,
  outerRing,
  placeRect,
  preloadImages,
  scaleAbout,
  setTextStyle,
  tintedMask,
} from './canvasKit';
import { lcg, mixSeed } from './rng';
import { isFeverAt, type FeverWindow } from '@sukushow/chart/fever';
import { noteJudgementTimes } from '@sukushow/chart/chart';
import {
  DEFAULT_SCORE_CONFIG,
  ScoreEngine,
  scoreRankDisplay,
  technicalPercent,
  type ScoreEngineConfig,
} from './score';
import {
  RG_OPTION_DEFAULTS,
  autoPlayConditionType,
  autoPlayJudgementType,
  conditionSprite,
  fastSlowLayoutY,
  judgementLayoutY,
  judgementSprite,
  shouldShowFastSlow,
  shouldShowJudgement,
  type FastSlowOption,
  type JudgementOutputOption,
  type NoteConditionType,
  type NoteJudgementType,
} from './rgOptions';

import {
  buildLineHashTables,
  collectAutoPlaySeHits,
  countActiveHolds,
  dispatchAutoPlaySe,
  SeResolver,
} from './se';

const DESIGN_W = 1920;
const DESIGN_H = 1080;

// A jump of at least this many seconds is a forward seek: notes inside the
// gap are not awarded. Continuous playback (including 2×) stays under it.
// Only a small delta that actually crosses a note increments combo.
const SEEK_GAP = 0.5;
/** 跳转重建时，距目标时刻这么多秒内的判定按完整路径重放（覆盖判定字 / 闪光 / 爆发等特效寿命）。 */
const REBUILD_FX_WINDOW = 3;

// ScoreResolver.Add / Process: judgementHideTime = t + 0.7 (f32 @0x1AA10B8). Hard cut, no fade.
const JUDGE_LIFE = 0.7;
const JUDGE_TWEEN = 0.1;
const COMBO_TWEEN = 0.1;
/** level56 SpriteRoot: Sprite0..Sprite3; [0]=units (rightmost). */
const COMBO_DIGIT_SLOTS = 4;

// Sprite0 is the units place, right to left. Commas sit between groups of three.
const SCORE_DIGIT_X = [139, 115.5, 92, 57, 33.5, 10, -26, -49.5, -73, -108, -131.5, -155];
const SCORE_COMMA_X = [75, -8, -90];

// scoreSprites = num_score_0..9 + num_score_11 (dim 0). commaSprites = num_score_10 + num_score_12 (dim comma).
const SCORE_DIM_ZERO = 'ui_sc2_ingame_num_score_11';
const SCORE_DIM_COMMA = 'ui_sc2_ingame_num_score_12';
const SCORE_COMMA = 'ui_sc2_ingame_num_score_10';

export function hudScale(stageWidth: number, stageHeight: number): number {
  return Math.min(stageWidth / DESIGN_W, stageHeight / DESIGN_H);
}

/** Pure layout numbers for the HTML overlay (no DOM). SafeArea is always 1920 wide and centered in logic space. */
export function hudLayout(stageWidth: number, stageHeight: number) {
  const scale = hudScale(stageWidth, stageHeight);
  const logicW = stageWidth / scale;
  const logicH = stageHeight / scale;
  return {
    scale,
    logicW,
    logicH,
    safeW: DESIGN_W,
    safeOffsetX: (logicW - DESIGN_W) / 2,
  };
}

function spriteUrl(name: string): string {
  return `/rg/sprites/${name}.png`;
}

/** APRateEffect 火花画布（CSS px，以徽章中心为原点；足够容纳 Closs 的最远行程）。 */
const AP_RATE_SPARK_CANVAS = { w: 720, h: 360 } as const;
const AP_RATE_SPARK_DPR = 2;

interface ApRateSpark {
  tex: string;
  /** 所属系统的 startDelay（同系统共用）。 */
  delay: number;
  /** 出生点（px，y 向上）。 */
  x: number; y: number;
  /** 初速度（px/s，y 向上）。 */
  vx: number; vy: number;
  life: number;
  /** startSize（px）。 */
  size: number;
  /** RotationModule 角速度（rad/s）。 */
  spin: number;
  /** TwoGradients 的逐粒子插值随机数。 */
  colorRand: number;
  /** 限速上限（px/s）与阻尼。 */
  limit: number; dampen: number;
}

/** 所有 AutoPlay 判定时刻 ≤ time（升序），与 countHeads 同口径。 */
function judgementTimesUpTo(chart: Chart, time: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < chart.notes.length; i++) {
    for (const t of noteJudgementTimes(chart.notes[i], chart.bpms)) if (t <= time) out.push(t);
  }
  return out.sort((x, y) => x - y);
}

function countHeads(chart: Chart, previousTime: number, time: number): number {
  // Prepare Pass2: root Just + Holds samples (GetHolds on multi-segment heads). Not notes.length.
  let hits = 0;
  for (let i = 0; i < chart.notes.length; i++) {
    const times = noteJudgementTimes(chart.notes[i], chart.bpms);
    for (let j = 0; j < times.length; j++) {
      const t = times[j];
      if (previousTime < t && time >= t) hits++;
    }
  }
  return hits;
}

/** UpdateScore @0x49A1E3C — dim leading zeros use scoreSprites[10] / commaSprites[1], not opacity. */
export function scoreDigitSprite(score: number, index: number): string {
  let n = score;
  for (let i = 0; i < index; i++) n = Math.trunc(n * 0.1);
  if (n === 0) return SCORE_DIM_ZERO;
  return `ui_sc2_ingame_num_score_${n % 10}`;
}

export function scoreCommaSprite(score: number, commaIndex: number): string {
  // After digits 0..(3*commaIndex+2) have been peeled, remaining score==0 ⇒ dim comma.
  let n = score;
  for (let i = 0; i < 3 * commaIndex + 3; i++) n = Math.trunc(n * 0.1);
  return n === 0 ? SCORE_DIM_COMMA : SCORE_COMMA;
}


/** In-game TechnicalScore text: percent = pushedValue/10000; TMP template size 36 + ".0000 %". */
export function formatTechnicalScore(percent: number): { whole: string; frac: string } {
  const n = Number.isFinite(percent) ? Math.max(0, percent) : 0;
  const whole = String(Math.trunc(n));
  const frac = (n % 1).toFixed(4).slice(1); // ".xxxx"
  return { whole, frac: `${frac} %` };
}


/** 数字 1 的描边蒙版（着色器窄字形采样，见 comboEffectOutlineBox）；其余数字用整张图。 */
const COMBO_EFFECT_SHEET_TEX = '/rg/fx/tex/ui_sc2_ingame_num_combo_Effect.png';
const COMBO_EFFECT_DIGIT1_TEX = '/rg/fx/tex/ui_sc2_ingame_num_combo_Effect_1.png';
const COMBO_GLOW_UPPER_TEX = '/rg/fx/tex/sc2_effect_combo_glow_002.png';
const COMBO_GLOW_LOWER_TEX = '/rg/fx/tex/sc2_effect_combo_glow_002_alpha_lower.png';
/** 描边颜色 = ColorModule rgb (0.04245, 0.58693, 1)。 */
const COMBO_EFFECT_COLOR = 'rgb(11,150,255)';
/** 上层底光颜色 (0.4575, 0.7675, 1)。 */
const COMBO_GLOW_UPPER_COLOR = 'rgb(117,196,255)';
const AP_RATE_ROOT_TEX = '/rg/fx/tex/APRate_OutlineEffect.png';
const AP_RATE_CORE_NAME = 'Default-Particle.png';
const AP_RATE_CORE_TEX = `/rg/fx/tex/${AP_RATE_CORE_NAME}`;

const PINK = 'rgb(255,58,153)';
const TEAL = 'rgb(0,189,182)';

/** HUD 画到的视口：舞台 CSS 尺寸与设备像素比。 */
export type HudView = { cssW: number; cssH: number; dpr: number };

/** AP 継続特效一层的逐帧状态（combo = 0 表示整层隐藏）。 */
interface ComboFxLayerState {
  combo: number;
  /** 整层绕 360×120 框中心的缩放（ComboRectTween / SpriteUpperRoot）。 */
  layerScale: number;
  /** 单颗粒子不透明度。 */
  opacity: number;
  /** 每槽粒子自身缩放（抵消 / 叠加层缩放）。 */
  partScale: number[];
}

const EMPTY_FX: ComboFxLayerState = { combo: 0, layerScale: 1, opacity: 0, partScale: [1, 1, 1, 1] };

/** 第 i 个数字槽（[0]=个位，row-reverse、槽 90 宽、间距 −13）在 360 宽框内的左缘。 */
export function comboSlotLeft(visible: number, i: number): number {
  const total = visible * 90 - Math.max(0, visible - 1) * 13;
  return (360 + total) / 2 - 90 - i * 77;
}

/** combo 数字（<10 视为 0）拆成槽位数字，[0]=个位；空槽不计。 */
function comboSlotDigits(combo: number): number[] {
  const out: number[] = [];
  let n = combo < 10 ? 0 : combo;
  while (n > 0 && out.length < COMBO_DIGIT_SLOTS) {
    out.push(n % 10);
    n = Math.trunc(n * 0.1);
  }
  return out;
}

/** 与 paintComboFxLayer 同一槽规则（剩余值 m > 0 才开槽），不做 <10 掩码。 */
function fxSlotDigits(combo: number): number[] {
  const out: number[] = [];
  let m = combo;
  while (m > 0 && out.length < COMBO_DIGIT_SLOTS) {
    out.push(m % 10);
    m = Math.trunc(m * 0.1);
  }
  return out;
}

export class LiveHud {
  private readonly scoreEngine = new ScoreEngine(DEFAULT_SCORE_CONFIG);
  private techDisplayMode: 0 | 1 | 2 = 0;
  private rankManual = false;
  private rank: 'none' | 'D' | 'C' | 'B' | 'A' | 'S' = 'none';
  private chart: Chart | null = null;
  private previousTime = 0;
  private combo = 0;
  private apRate = 0;
  private judgeAt = -1;
  private conditionAt = -1;
  private enablePerfectPlus: boolean = RG_OPTION_DEFAULTS.enablePerfectPlus;
  private judgementYOpt = RG_OPTION_DEFAULTS.judgementY;
  private fastSlowYOpt = RG_OPTION_DEFAULTS.fastSlowY;
  private enableFeverDisplay: boolean = RG_OPTION_DEFAULTS.enableFeverDisplay;
  private enableApContinue: boolean = RG_OPTION_DEFAULTS.enableApContinue;
  private feverWindow: FeverWindow | null = null;
  private judgementOutput: JudgementOutputOption = RG_OPTION_DEFAULTS.judgementOutput;
  private fastSlowThreshold: FastSlowOption = RG_OPTION_DEFAULTS.fastSlowThreshold;
  private lastJudgeType: NoteJudgementType = 4;
  private se: SeResolver | null = null;
  private seHashes: { first: Map<number, number>; second: Map<number, number> } = {
    first: new Map(),
    second: new Map(),
  };
  private comboBounceAt = -1;
  private comboFlashAt = -1;
  /**
   * AP 継続（`ScoreResolver.isApContinue` @0x158）：本局至今是否全程 Perfect 以上。
   * `add` 每次判定 `&= (type & 0xFE) == 4`；`Clear` / 重开重置为 true。
   */
  private isApContinue = true;
  /** 下层（描边 + 底光）循环的时间基：开局 / Clear 起算，isRefreshLoop（combo 位数变化）时重启。 */
  private comboFxLowerAt = 0;
  /** 上层时间基 = DoEffectCombo（跨百）时刻；-1 = 未在播。 */
  private comboFxUpperAt = -1;
  /** DoEffectCombo 写入上层的未掩码 combo，以及当时的 isApContinue（决定渲染器开关）。 */
  private comboFxUpperCombo = 0;
  private comboFxUpperOn = false;
  private apRateFlashAt = -1;
  private prevComboForFlash = 0;
  private lastPaintedApRate = -1;
  private lastApDisplay = -1;
  private lastVoltageDisplay = -1;
  private apValuePopAt = -1;
  private voltageValuePopAt = -1;
  private apValueFlashAt = -1;
  private voltageValueFlashAt = -1;
  /** APRateEffect #229 Particle / #228 ClossParticle 的粒子（出生时按原包参数取定）。 */
  private apRateBurstSparks: ApRateSpark[] = [];
  /** 两种火花贴图拆成的 R/G/B 单通道图（预乘），用于按顶点色逐通道加色。 */
  private readonly apRateTexChannels = new Map<string, { ch: HTMLCanvasElement[] }>();
  private apRateTextureRevision = 0;
  get textureRevision(): number { return this.apRateTextureRevision; }
  /** #41 Bg_core 的 `Default-Particle` 像素（非预乘 RGBA）。 */
  private apRateCoreTex: { w: number; h: number; px: Uint8ClampedArray } | null = null;
  /** 爆发是否已建好（区别于 `apRateFlashAt` 的动画时基）。 */
  private apRateBurstLive = false;
  private addScoreAt = -1;
  private addScoreText = '+0';

  // ── 逐帧绘制状态（sync 算出，draw 只读）─────────────────────────
  private judgeSprite = 'ui_sc2_ingame_hantei_perfect';
  private judgeW = 340;
  private judgeScale: number | null = null;
  private conditionSpriteName: string | null = 'ui_sc2_ingame_hantei_slow';
  private conditionScale: number | null = null;
  /** ComboRectTween 当前缩放（下层粒子只随它展开槽位，尺寸不变）。 */
  private comboRectScale = 1;
  private comboFlashDigits: number[] = [];
  private comboFlash: { s: number; a: number } | null = null;
  private fx: Record<'lowerOutline' | 'upperOutline' | 'lowerGlow' | 'upperGlow', ComboFxLayerState> = {
    lowerOutline: EMPTY_FX, upperOutline: EMPTY_FX, lowerGlow: EMPTY_FX, upperGlow: EMPTY_FX,
  };
  private apRateUpper: { s: number; a: number } | null = null;
  private burst: { age: number; s: number; rootAlpha: number } | null = null;
  private rankCache: { key: string; canvas: HTMLCanvasElement; x: number; y: number } | null = null;
  private addScore: { dx: number; a: number } | null = null;
  private apText = '0';
  private voltageText = '0';
  private apUpperText = '0';
  private voltageUpperText = '0';
  private apValueScale = 0.92;
  private voltageValueScale = 0.92;
  private apUpper: { s: number; a: number } | null = null;
  private voltageUpper: { s: number; a: number } | null = null;
  private apFill = 0;
  private voltageFill = 0;
  private techText = formatTechnicalScore(0);

  /** 火花层（sortingOrder −1）与 Bg_core 压暗 / 加亮层的离屏画布。 */
  private readonly sparksCanvas: HTMLCanvasElement | null;
  private readonly coreShade: HTMLCanvasElement | null;
  private readonly coreLight: HTMLCanvasElement | null;
  private lastView: HudView = { cssW: 1920, cssH: 1080, dpr: 1 };
  /** 爆发随机种子（按触发时刻与档位派生，保证拖动 / 导出同一时刻结果一致）。 */
  private burstSeed = 0;

  constructor() {
    const mk = () => (typeof document === 'undefined' ? null : document.createElement('canvas'));
    this.sparksCanvas = mk();
    if (this.sparksCanvas) {
      this.sparksCanvas.width = AP_RATE_SPARK_CANVAS.w * AP_RATE_SPARK_DPR;
      this.sparksCanvas.height = AP_RATE_SPARK_CANVAS.h * AP_RATE_SPARK_DPR;
    }
    this.coreShade = mk();
    this.coreLight = mk();
    void preloadImages(LiveHud.textureUrls());
    this.loadApRateTextures();
    this.paintApRate();
    this.paintApVoltage();
  }

  /** HUD 用到的全部贴图（预载；导出前等它们就绪）。 */
  static textureUrls(): string[] {
    return [
      ...Array.from({ length: 10 }, (_, d) => spriteUrl(`ui_sc2_ingame_num_combo_${d}`)),
      ...Array.from({ length: 10 }, (_, d) => spriteUrl(`ui_sc2_ingame_num_score_${d}`)),
      ...[SCORE_DIM_ZERO, SCORE_DIM_COMMA, SCORE_COMMA, 'ui_sc2_ingame_combo', 'ui_sc2_ingame_hantei_perfect',
        'ui_sc2_ingame_hantei_perfect_plus', 'ui_sc2_ingame_hantei_slow', 'ui_sc2_ingame_hantei_fast',
        'ui_sc2_ingame_rank_base', 'ui_sc2_button_rank', 'ui_sc2_button_rank_shine', 'ui_sc2_button_rank_deco_01',
        'ui_sc2_button_rank_deco_02', 'ui_sc2_button_shine', 'ui_sc2_button_dot', 'ui_sc2_ingame_ap_base',
        'ui_sc2_ingame_voltage_base', 'ui_sc2_ingame_gage_base_02', 'ui_sc2_ingame_gage_ap', 'ui_sc2_ingame_gage_voltage',
      ].map(spriteUrl),
      COMBO_EFFECT_SHEET_TEX, COMBO_EFFECT_DIGIT1_TEX, COMBO_GLOW_UPPER_TEX, COMBO_GLOW_LOWER_TEX, AP_RATE_ROOT_TEX,
      '/rg/fx/tex/sc2_Particle_light02.png', '/rg/fx/tex/sc2_outgameLvUp_glitter_lyric_01.png', AP_RATE_CORE_TEX,
    ];
  }

  setSe(se: SeResolver | null): void {
    this.se = se;
  }

  /**
   * playing=false（暂停）时任何时间变化都按跳转处理：不派发 SE、不触发新判定，
   * 直接按目标时刻重建 HUD 状态。播放中小步前进（< SEEK_GAP）才逐帧累计判定。
   */
  sync(chart: Chart, time: number, playing = true): void {
    if (!Number.isFinite(time)) return;
    if (chart !== this.chart) {
      this.chart = chart;
      this.seHashes = buildLineHashTables(chart);
      this.se?.clear();
      this.rebuildTo(chart, time);
    } else {
      const previousTime = this.previousTime;
      const continuous = playing && time >= previousTime && time - previousTime < SEEK_GAP;
      if (!continuous) {
        if (time !== previousTime) {
          this.se?.clear();
          this.rebuildTo(chart, time);
        }
      } else if (time > previousTime) {
        this.previousTime = time;
        this.scoreEngine.setFever(isFeverAt(time, this.feverWindow));
        this.se?.process();
        const hits = countHeads(chart, previousTime, time);
        const jType = autoPlayJudgementType(this.enablePerfectPlus);
        if (hits > 0) this.applyHits(hits, time, jType);
        if (this.se) {
          const seHits = collectAutoPlaySeHits(chart, previousTime, time, this.seHashes);
          dispatchAutoPlaySe(this.se, seHits, jType, countActiveHolds(chart, time));
          this.se.applyHold();
        }
      }
    }
    this.paintJudge(time);
    this.paintCondition(time);
    this.paintComboBounce(time);
    this.paintComboFlash(time);
    this.paintComboEffect(time);
    this.paintApRateFlash(time);
    this.paintApRateBurst(time);
    this.paintAddScore(time);
    this.paintApVoltage();
    this.paintApVoltageFx(time);
  }

  dispose(): void {
    this.apRateBurstSparks = [];
  }

  /**
   * TechnicalScoreDisplay: 0 off / 1 realtime / 2 estimate remaining as all Perfect+.
   */
  setTechnicalScoreDisplay(mode: 0 | 1 | 2): void {
    this.techDisplayMode = mode;
    this.paintTechnicalFromEngine();
  }

  /** TotalAppeal / mastery / rank thresholds for halfwayScore + GetScoreRank. */
  setScoreConfig(partial: Partial<ScoreEngineConfig>): void {
    this.scoreEngine.configure(partial);
    if (this.chart) {
      // 配置变更后按当前时刻重算，不清零。
      this.rebuildTo(this.chart, this.previousTime);
      return;
    }
    this.combo = this.scoreEngine.combo;
    this.apRate = this.scoreEngine.apRate;
    if (!this.rankManual) this.setRank(scoreRankDisplay(this.scoreEngine.rank, this.scoreEngine.score));
    this.paintTechnicalFromEngine();
  }

  private paintTechnicalFromEngine(): void {
    if (this.techDisplayMode === 0) return;
    const push = this.scoreEngine.technicalPush(this.techDisplayMode);
    this.techText = formatTechnicalScore(technicalPercent(push));
  }

  /** 一批同刻判定（AutoPlay 恒为同一判定类型）：计分 + 触发判定字 / 闪光等特效。 */
  private applyHits(hits: number, time: number, jType: NoteJudgementType): void {
    const prevCombo = this.combo;
    // AP 継続：`isApContinue &= (type & 0xFE) == 4`（ScoreResolver.Add @0x49A1460）。
    this.isApContinue = apContinueAfterHit(this.isApContinue, jType);
    this.scoreEngine.addMany(jType, hits);
    this.combo = this.scoreEngine.combo;
    this.apRate = this.scoreEngine.apRate;
    this.paintApRate();
    if (this.scoreEngine.lastAdd > 0) this.triggerAddScore(this.scoreEngine.lastAdd, time);
    this.paintApVoltage();
    this.paintTechnicalFromEngine();
    if (!this.rankManual) {
      this.setRank(scoreRankDisplay(this.scoreEngine.rank, this.scoreEngine.score));
    }
    if (shouldShowJudgement(jType, this.judgementOutput)) {
      this.applyJudgeSprite(jType);
      this.judgeAt = time;
    }
    // ToCondition(diff==0) ⇒ Slow; Score.Add zeros condition when FastSlow gate fails.
    if (shouldShowFastSlow(jType, this.fastSlowThreshold)) {
      this.applyConditionSprite(autoPlayConditionType());
      this.conditionAt = time;
    }
    if (this.combo >= 10) this.comboBounceAt = time;
    this.onComboAdvanced(prevCombo, time);
  }

  /**
   * 跳转：从开局按时间顺序重放 AutoPlay 判定到 time（含 time），得到与连续播放一致的
   * 分数 / combo / AP / 等级 / AP 継続。每个判定刻按当刻 Fever 计分。
   * 距 time 不足 REBUILD_FX_WINDOW 的判定走完整路径，让判定字、跨百闪光、AP増加 等
   * 按各自触发时刻显示到正确进度；更早的只累计数值。
   */
  private rebuildTo(chart: Chart, time: number): void {
    this.resetLive(time);
    this.comboFxLowerAt = Math.min(time, 0);
    const jType = autoPlayJudgementType(this.enablePerfectPlus);
    const times = judgementTimesUpTo(chart, time);
    const fxFrom = time - REBUILD_FX_WINDOW;
    let full = false;
    for (let i = 0; i < times.length; ) {
      const t = times[i]!;
      let n = 0;
      while (i < times.length && times[i] === t) { n++; i++; }
      this.scoreEngine.setFever(isFeverAt(t, this.feverWindow));
      this.previousTime = t;
      if (!full && t >= fxFrom) {
        full = true;
        this.paintApVoltage(); // 数值弹跳的基线
      }
      if (full) {
        this.applyHits(n, t, jType);
        continue;
      }
      const prevCombo = this.combo;
      this.isApContinue = apContinueAfterHit(this.isApContinue, jType);
      this.scoreEngine.addMany(jType, n);
      this.combo = this.scoreEngine.combo;
      this.apRate = this.scoreEngine.apRate;
      if (comboEffectRefreshLoop(prevCombo, this.combo)) this.comboFxLowerAt = t;
      this.prevComboForFlash = this.combo;
      this.lastPaintedApRate = this.apRate;
    }
    this.previousTime = time;
    this.scoreEngine.setFever(isFeverAt(time, this.feverWindow));
    if (!full && times.length) {
      this.paintApRate();
      this.paintApVoltage();
      this.paintTechnicalFromEngine();
      if (!this.rankManual) this.setRank(scoreRankDisplay(this.scoreEngine.rank, this.scoreEngine.score));
    }
  }

  private resetLive(time: number): void {
    this.previousTime = time;
    this.scoreEngine.reset(this.chart);
    this.combo = 0;
    this.apRate = 0;
    this.judgeAt = -1;
    this.conditionAt = -1;
    this.comboBounceAt = -1;
    this.comboFlashAt = -1;
    this.apRateFlashAt = -1;
    // Clear() 把 isApContinue 重置为 true（ScoreResolver @0x49A2634）。
    this.isApContinue = true;
    this.comboFxLowerAt = time;
    this.comboFxUpperAt = -1;
    this.addScoreAt = -1;
    this.prevComboForFlash = 0;
    this.lastPaintedApRate = -1;
    this.comboFlash = null;
    this.addScore = null;
    this.comboRectScale = 1;
    this.rankManual = false;
    this.lastApDisplay = -1;
    this.lastVoltageDisplay = -1;
    this.apValuePopAt = -1;
    this.voltageValuePopAt = -1;
    this.apValueFlashAt = -1;
    this.voltageValueFlashAt = -1;
    this.apUpper = null;
    this.voltageUpper = null;
    this.apRateUpper = null;
    this.clearApRateBurst();
    this.paintApRate();
    this.paintApVoltage();
    this.setRank('none');
    this.paintTechnicalFromEngine();
    this.paintJudge(time);
  }

  private paintApRate(): void {
    // UpdateApRate: apRate >= 1 ⇒ COMBO label on + badge text; else both hidden / alpha 0（draw 里按 apRate 判定）。
  }

  private paintJudge(time: number): void {
    if (this.judgeAt < 0) {
      this.judgeScale = null;
      return;
    }
    const age = time - this.judgeAt;
    if (age < 0 || age >= JUDGE_LIFE) {
      this.judgeScale = null;
      this.judgeAt = -1;
      return;
    }
    // JudgementRectTween: u = min(age, 0.1)*10; scale = 0.5 + u - 0.5*u*u (0.5 → 1.0).
    const u = Math.min(age, JUDGE_TWEEN) * (1 / JUDGE_TWEEN);
    this.judgeScale = 0.5 + u - 0.5 * u * u;
  }

  private onComboAdvanced(prevCombo: number, time: number): void {
    if (shouldComboHundredFlash(prevCombo, this.combo)) {
      this.comboFlashAt = time;
      this.comboFlashDigits = comboSlotDigits(this.combo);
      // DoEffectCombo：上层按未掩码 combo 设数字、isRefreshLoop=true；渲染器开关取此刻的 isApContinue。
      this.comboFxUpperAt = time;
      this.comboFxUpperCombo = this.combo;
      this.comboFxUpperOn = this.isApContinue;
    }
    // isRefreshLoop（Add @0x49A19A8）= 新旧 combo 位数不同 ⇒ 下层描边与底光一起 Stop(true, Clear)+Play()。
    if (comboEffectRefreshLoop(prevCombo, this.combo)) this.comboFxLowerAt = time;
    this.prevComboForFlash = this.combo;
    // ApRateFlash only when apRate value changes
    if (this.apRate !== this.lastPaintedApRate) {
      if (this.apRate >= 1) {
        this.apRateFlashAt = time;
        this.spawnApRateBurst(time);
      } else {
        this.apRateFlashAt = -1;
        this.clearApRateBurst();
        this.apRateUpper = null;
      }
      this.lastPaintedApRate = this.apRate;
    }
  }

  private paintComboEffect(time: number): void {
    // 下层（SpriteRoot）：UpdateCombo 每次按掩码后的 combo（<10 视为 0）与 isApContinue 开关渲染器；
    //   粒子模拟不因渲染器关闭而停，只有 isRefreshLoop（位数变化）才 Stop+Play ⇒ 相位取 comboFxLowerAt。
    //   描边与底光同一次 withChildren 重启，共用相位。
    const lowerOn = this.enableApContinue && apContinueEffectVisible(this.combo, this.isApContinue);
    const lowerCombo = lowerOn ? this.combo : 0;
    const lowerAge = Math.max(0, time - this.comboFxLowerAt);
    // 粒子 scalingMode = Local：ComboRectTween 只把槽位展开，粒子本身不放大 ⇒ 子元素反向缩放。
    const invRect = 1 / this.comboRectScale;
    const inv4 = [invRect, invRect, invRect, invRect];
    this.fx.lowerOutline = {
      combo: lowerCombo, layerScale: this.comboRectScale,
      opacity: comboEffectLowerAlpha(lowerAge) * COMBO_EFFECT_LOWER_START_A, partScale: inv4,
    };
    this.fx.lowerGlow = {
      combo: lowerCombo, layerScale: this.comboRectScale,
      opacity: comboGlowLowerCurve(lowerAge) * COMBO_GLOW_LOWER_ALPHA, partScale: inv4,
    };

    // 上层（SpriteUpperRoot）：DoEffectCombo 时写入未掩码 combo，0.1167s 激活后开播；
    //   描边寿命 0.25s、底光 0.8s。位置随 SpriteUpperRoot 缩放展开，
    //   描边尺寸只认自身缩放曲线，底光尺寸不变。
    let upperCombo = 0;
    let upperAge = -1;
    let animAge = 0;
    let rootS = 1;
    if (this.comboFxUpperAt >= 0) {
      animAge = time - this.comboFxUpperAt;
      upperAge = animAge - COMBO_EFFECT_UPPER_ACTIVATE_DELAY;
      if (animAge < 0 || upperAge >= COMBO_GLOW_LIFE) {
        this.comboFxUpperAt = -1;
        upperAge = -1;
      } else if (upperAge >= 0 && this.comboFxUpperOn && this.enableApContinue) {
        upperCombo = this.comboFxUpperCombo;
        rootS = comboFlashScale(animAge);
      }
    }
    const layerS = upperCombo > 0 ? rootS : 1;
    this.fx.upperOutline = {
      combo: upperAge < COMBO_EFFECT_UPPER_LIFE ? upperCombo : 0, layerScale: layerS,
      opacity: comboEffectUpperAlpha(upperAge) * COMBO_EFFECT_UPPER_START_A,
      partScale: [0, 1, 2, 3].map((slot) => comboEffectUpperOutlineScale(slot, animAge) / rootS),
    };
    this.fx.upperGlow = {
      combo: upperCombo, layerScale: layerS,
      opacity: comboGlowUpperCurve(upperAge) * COMBO_GLOW_UPPER_ALPHA,
      partScale: [1 / rootS, 1 / rootS, 1 / rootS, 1 / rootS],
    };
  }

  private paintComboFlash(time: number): void {
    if (this.comboFlashAt < 0) {
      this.comboFlash = null;
      return;
    }
    const age = time - this.comboFlashAt;
    if (age < 0 || age >= COMBO_FLASH_DURATION) {
      this.comboFlashAt = -1;
      this.comboFlash = null;
      return;
    }
    this.comboFlash = { s: comboFlashScale(age), a: comboFlashAlpha(age) };
  }

  private paintApRateFlash(time: number): void {
    if (this.apRateFlashAt < 0) {
      this.apRateUpper = null;
      return;
    }
    const age = time - this.apRateFlashAt;
    if (age < 0 || age >= AP_RATE_FLASH_DURATION) {
      this.apRateFlashAt = -1;
      this.apRateUpper = null;
      return;
    }
    this.apRateUpper = { s: apRateFlashScale(age), a: apRateFlashAlpha(age) };
  }

  /**
   * 载入 APRateEffect 贴图像素：火花贴图拆成 R/G/B 三张单通道预乘图，
   * 以便 `lighter` 合成时按顶点色逐通道缩放，得到与 `Mobile/Particles/Additive`
   * 一致的 `tex.rgb × tex.a × col.rgb × col.a` 加色。
   */
  private loadApRateTextures(): void {
    if (typeof document === 'undefined') return;
    const load = (name: string, cb: (id: ImageData) => void) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        try { cb(ctx.getImageData(0, 0, c.width, c.height)); this.apRateTextureRevision++; } catch { /* 无像素访问时跳过 */ }
      };
      img.src = `/rg/fx/tex/${name}`;
    };
    for (const spec of [AP_RATE_PARTICLE, AP_RATE_CLOSS]) {
      load(spec.tex, (id) => {
        const ch = [0, 1, 2].map((k) => {
          const c = document.createElement('canvas');
          c.width = id.width;
          c.height = id.height;
          const out = new ImageData(id.width, id.height);
          for (let i = 0; i < id.data.length; i += 4) {
            out.data[i + k] = 255;
            out.data[i + 3] = Math.round(id.data[i + k] * id.data[i + 3] / 255);
          }
          c.getContext('2d')?.putImageData(out, 0, 0);
          return c;
        });
        this.apRateTexChannels.set(spec.tex, { ch });
      });
    }
    load(AP_RATE_CORE_NAME, (id) => {
      this.apRateCoreTex = { w: id.width, h: id.height, px: id.data };
    });
  }

  /** APRateEffect 的像素贴图是否都已就绪（导出前等待）。 */
  get texturesReady(): boolean {
    return this.apRateCoreTex !== null && this.apRateTexChannels.size === 2;
  }

  /**
   * APRateEffect — level56 `ComboRoot/APRateUpper/APRateEffect` #227 及三个子发射器。
   * 参数全部取原包序列化值（见 hudFxMath 的 AP_RATE_*）；1 世界单位 = 100 px。
   * 随机数用按触发时刻派生种子的确定性序列（与 Unity 的 RNG 序列不同，只保证分布一致，
   * 且同一时刻的爆发在预览拖动与视频导出里完全相同）。
   */
  private spawnApRateBurst(time: number): void {
    this.burstSeed = mixSeed(Math.round(time * 1000), this.apRate, 0x41505241);
    const rnd = lcg(this.burstSeed);
    const list: ApRateSpark[] = [];
    for (const spec of [AP_RATE_PARTICLE, AP_RATE_CLOSS]) {
      // startDelay 是主模块属性：整个系统一次取值。
      const delay = lerpRange(spec.delay, rnd());
      for (let i = 0; i < spec.count; i++) {
        const sp = apRateBurstSpawn(rnd(), rnd());
        const speed = lerpRange(spec.speed, rnd()) * 100;
        list.push({
          tex: spec.tex,
          delay,
          x: sp.x * 100,
          y: sp.y * 100,
          vx: sp.dx * speed,
          vy: sp.dy * speed,
          life: lerpRange(spec.life, rnd()),
          size: lerpRange(spec.size, rnd()) * 100,
          spin: spec.spin ? lerpRange(spec.spin, rnd()) : 0,
          colorRand: rnd(),
          limit: lerpRange(spec.limit, rnd()) * 100,
          dampen: spec.dampen,
        });
      }
    }
    this.apRateBurstSparks = list;
    this.apRateBurstLive = true;
  }

  /** 清空 APRateEffect（寿命结束、重播或换谱时调用）。 */
  private clearApRateBurst(): void {
    this.burst = null;
    if (!this.apRateBurstLive && !this.apRateBurstSparks.length) return;
    this.apRateBurstLive = false;
    this.apRateBurstSparks = [];
  }

  /** 逐帧驱动 APRateEffect；clip #94 在 t=1/60s 才 SetActive(true)。 */
  private paintApRateBurst(time: number): void {
    if (this.apRateFlashAt < 0) {
      this.clearApRateBurst();
      return;
    }
    const age = time - this.apRateFlashAt - AP_RATE_BURST_ACTIVATE_DELAY;
    if (age < 0) { this.burst = null; return; } // 延迟窗口内尚未激活
    if (age >= AP_RATE_BURST_DURATION) {
      this.clearApRateBurst();
      return;
    }
    // Root / Bg_core 共用尺寸曲线，从中心放大。
    const s = apRateBurstScale(age);
    this.burst = { age, s, rootAlpha: apRateBurstRootAlpha(age) };
    this.paintApRateCore(age);
    this.paintApRateSparks(age);
  }

  /**
   * #41 Bg_core：`Legacy Shaders/Particles/Alpha Blended Premultiply`
   * （`Blend One OneMinusSrcAlpha`，片元 = `col × tex × col.a`）。
   * 帧缓冲结果 `P + dst·(1 − A)`，其中 `P = col.rgb·tex.rgb·col.a`、`A = col.a²·tex.a`；
   * 拆成压暗层 `(0,0,0,A)`（普通合成）与加亮层 `P`（加色）两张画布。
   */
  private paintApRateCore(age: number): void {
    const tex = this.apRateCoreTex;
    const shade = this.coreShade, light = this.coreLight;
    if (!tex || !shade || !light) return;
    const sctx = shade.getContext('2d');
    const lctx = light.getContext('2d');
    if (!sctx || !lctx) return;
    if (shade.width !== tex.w || shade.height !== tex.h) {
      shade.width = light.width = tex.w;
      shade.height = light.height = tex.h;
    }
    const c = apRateBurstCoreColor(age);
    const sh = sctx.createImageData(tex.w, tex.h);
    const li = lctx.createImageData(tex.w, tex.h);
    const px = tex.px;
    const aa = c.a * c.a;
    for (let i = 0; i < px.length; i += 4) {
      sh.data[i + 3] = Math.round(aa * px[i + 3]);
      const pr = c.r * c.a * px[i], pg = c.g * c.a * px[i + 1], pb = c.b * c.a * px[i + 2];
      const m = Math.max(pr, pg, pb);
      if (m > 0) {
        // 以最大通道作 alpha 存储，使预乘后的 rgb 恰为 P。
        li.data[i] = Math.round(pr / m * 255);
        li.data[i + 1] = Math.round(pg / m * 255);
        li.data[i + 2] = Math.round(pb / m * 255);
        li.data[i + 3] = Math.round(m);
      }
    }
    sctx.putImageData(sh, 0, 0);
    lctx.putImageData(li, 0, 0);
  }

  /**
   * #229 Particle / #228 ClossParticle：`Mobile/Particles/Additive`（`Blend SrcAlpha One`，
   * 片元 = `tex × col`）。每颗按 R/G/B 单通道图以 `col.c × col.a` 为 globalAlpha 叠加。
   */
  private paintApRateSparks(age: number): void {
    const canvas = this.sparksCanvas;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const D = AP_RATE_SPARK_DPR;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';
    const cx = AP_RATE_SPARK_CANVAS.w / 2, cy = AP_RATE_SPARK_CANVAS.h / 2;
    for (const sp of this.apRateBurstSparks) {
      const a = age - sp.delay;
      if (a <= 0 || a >= sp.life) continue;
      const tex = this.apRateTexChannels.get(sp.tex);
      if (!tex) continue;
      const u = a / sp.life;
      const size = sp.size * apRateBurstParticleScale(u);
      if (size <= 0) continue;
      const col = apRateBurstParticleColor(u, sp.colorRand);
      if (col.a <= 0) continue;
      // LimitVelocityOverLifetime：位移是 v(t)=lim+(v0−lim)e^(−κt) 的积分。
      const [dx, dy] = apRateBurstTravel(sp.vx, sp.vy, a, sp.limit, sp.dampen);
      ctx.setTransform(D, 0, 0, D, (cx + sp.x + dx) * D, (cy - (sp.y + dy)) * D);
      if (sp.spin) ctx.rotate(sp.spin * a);
      const gains = [col.r * col.a, col.g * col.a, col.b * col.a];
      for (let k = 0; k < 3; k++) {
        if (gains[k] <= 0) continue;
        ctx.globalAlpha = Math.min(1, gains[k]);
        ctx.drawImage(tex.ch[k], -size / 2, -size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private paintComboBounce(time: number): void {
    if (this.comboBounceAt < 0) {
      this.comboRectScale = 1;
      return;
    }
    const age = time - this.comboBounceAt;
    if (age < 0 || age >= COMBO_TWEEN) {
      this.comboRectScale = 1;
      this.comboBounceAt = -1;
      return;
    }
    // ComboRectTween: scale = 0.8 + 0.4*u - 0.2*u*u (0.8 → 1.0).
    // 描边层在原包里是数字槽的子节点，会跟着 ComboRectTween 一起缩放。
    const u = Math.min(age, COMBO_TWEEN) * (1 / COMBO_TWEEN);
    this.comboRectScale = 0.8 + 0.4 * u - 0.2 * u * u;
  }

  /**
   * ScoreRankIcon preview: `none` = SetRankNotActive (gray only).
   * D/C/B/A/S shows RankColor + shine/deco + RankName (material solid/gradient tint).
   */
  /** Sidebar preview pins rank until chart seek/reset. */
  setRankManual(rank: 'none' | 'D' | 'C' | 'B' | 'A' | 'S'): void {
    this.rankManual = true;
    this.setRank(rank);
  }

  setRank(rank: 'none' | 'D' | 'C' | 'B' | 'A' | 'S'): void {
    this.rank = rank;
  }

  setEnablePerfectPlus(on: boolean): void {
    this.enablePerfectPlus = on;
    this.applyJudgeSprite(autoPlayJudgementType(on));
  }

  /** `IConfigResolver.EnableApContinue`（默认 true）：关掉后不显示 AP 継続描边。 */
  setEnableApContinue(on: boolean): void {
    this.enableApContinue = on;
  }

  setJudgementOutput(opt: JudgementOutputOption): void {
    this.judgementOutput = opt;
  }

  /** ConfigResolver.FastSlowThreshold — gates Condition FAST/SLOW. */
  setFastSlowThreshold(opt: FastSlowOption): void {
    this.fastSlowThreshold = opt;
  }

  setJudgementY(opt: number): void {
    this.judgementYOpt = opt;
  }

  setFastSlowY(opt: number): void {
    this.fastSlowYOpt = opt;
  }

  setEnableFeverDisplay(on: boolean): void {
    this.enableFeverDisplay = on;
    this.paintApVoltage();
  }

  setFeverWindow(win: FeverWindow | null): void {
    this.feverWindow = win;
  }

  get feverActive(): boolean {
    return this.scoreEngine.feverActive;
  }

  get feverVisible(): boolean {
    return this.enableFeverDisplay && this.feverActive;
  }

  get feverWindowStart(): number {
    return this.feverWindow?.start ?? 0;
  }

  private applyConditionSprite(condition: NoteConditionType): void {
    const spr = conditionSprite(condition);
    this.conditionSpriteName = spr ? spr.name : null;
  }

  private paintCondition(time: number): void {
    if (this.conditionAt < 0) {
      this.conditionScale = null;
      return;
    }
    const age = time - this.conditionAt;
    if (age < 0 || age >= JUDGE_LIFE) {
      this.conditionScale = null;
      this.conditionAt = -1;
      return;
    }
    // Same JudgementRectTween as Judge (0.5 → 1.0 over 0.1 s).
    const u = Math.min(age, JUDGE_TWEEN) * (1 / JUDGE_TWEEN);
    this.conditionScale = 0.5 + u - 0.5 * u * u;
  }

  getFastSlowThreshold(): FastSlowOption {
    return this.fastSlowThreshold;
  }

  private applyJudgeSprite(type: NoteJudgementType): void {
    this.lastJudgeType = type;
    const { name } = judgementSprite(type, this.enablePerfectPlus);
    this.judgeSprite = name;
    this.judgeW = name.includes('perfect_plus') ? 386 : 340;
  }

  /** ScoreResolver Add → scoreAddText "+"N + ScoreAddTween @0x486177C. */
  private triggerAddScore(delta: number, time: number): void {
    if (delta <= 0) return;
    this.addScoreText = `+${delta}`;
    this.addScoreAt = time;
  }

  private paintAddScore(time: number): void {
    if (this.addScoreAt < 0) {
      this.addScore = null;
      return;
    }
    const age = time - this.addScoreAt;
    // Process: tween while active; hide when scoreAddHideTime < t (life 0.7).
    if (age < 0 || age >= SCORE_ADD_LIFE) {
      this.addScoreAt = -1;
      this.addScore = null;
      return;
    }
    this.addScore = { dx: scoreAddTweenX(age) - SCORE_ADD_REST_X, a: scoreAddTweenAlpha(age) };
  }

  private paintApVoltage(): void {
    const apInt = this.scoreEngine.apDisplayValue;
    const voInt = this.scoreEngine.voltageLevel;
    this.apText = String(apInt);
    this.voltageText = String(voInt);
    // ParamViewResolver.UpdateAp/UpdateVoltage: value change → upper SetCharArray +
    // Animator.CrossFade + JudgementRectTween(baseRect, 0.1s). Not ComboRectTween.
    if (this.lastApDisplay >= 0 && apInt !== this.lastApDisplay) {
      this.apUpperText = String(apInt);
      this.apValuePopAt = this.previousTime;
      this.apValueFlashAt = this.previousTime;
    }
    if (this.lastVoltageDisplay >= 0 && voInt !== this.lastVoltageDisplay) {
      this.voltageUpperText = String(voInt);
      this.voltageValuePopAt = this.previousTime;
      this.voltageValueFlashAt = this.previousTime;
    }
    this.lastApDisplay = apInt;
    this.lastVoltageDisplay = voInt;
    this.apFill = this.scoreEngine.apGauge;
    this.voltageFill = this.scoreEngine.voltageGauge;
  }

  /**
   * ParamViewResolver.Process: JudgementRectTween on base AP/Voltage value rect (0.5→1 / 0.1s);
   * APEffectBase→ApGageIncreaseAnimation / VoltageEffectBase→VoltageIncreaseAnimation (0.6s).
   */
  private paintApVoltageFx(time: number): void {
    // 基础数值的宿主常驻 scale(0.92)；弹跳时为 0.92 × JudgementRectTween。
    const pop = (at: number, clear: () => void): number => {
      if (at < 0) return 0.92;
      const age = time - at;
      if (age < 0 || age >= JUDGE_TWEEN) {
        clear();
        return 0.92;
      }
      const u = Math.min(age, JUDGE_TWEEN) * (1 / JUDGE_TWEEN);
      return 0.92 * (0.5 + u - 0.5 * u * u);
    };
    this.apValueScale = pop(this.apValuePopAt, () => { this.apValuePopAt = -1; });
    this.voltageValueScale = pop(this.voltageValuePopAt, () => { this.voltageValuePopAt = -1; });

    const flash = (at: number, clear: () => void): { s: number; a: number } | null => {
      if (at < 0) return null;
      const age = time - at;
      if (age < 0 || age >= AP_GAGE_FLASH_DURATION) {
        clear();
        return null;
      }
      // ApGageIncreaseAnimation / VoltageIncreaseAnimation @ sharedassets56.
      return { s: 0.92 * apGageFlashScale(age), a: apGageFlashAlpha(age) };
    };
    this.apUpper = flash(this.apValueFlashAt, () => { this.apValueFlashAt = -1; });
    this.voltageUpper = flash(this.voltageValueFlashAt, () => { this.voltageValueFlashAt = -1; });
  }

  // ── 绘制 ───────────────────────────────────────────────────────
  /**
   * 把 HUD 画到 ctx（整块 HUD 已是透明底的独立图层；调用方再以普通 alpha 合成到画面上，
   * 对应原 .hud 的层叠上下文——HUD 内的加色只与 HUD 自身内容相加）。
   * 坐标：逻辑画布 = 舞台 / hudScale，SafeArea 1920 宽居中（与原 DOM 布局同一公式）。
   */
  draw(ctx: Ctx, view: HudView): void {
    this.lastView = view;
    const L = hudLayout(view.cssW, view.cssH);
    if (!(L.scale > 0)) return;
    const k = L.scale * view.dpr;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const at = (x: number, y: number) => ctx.setTransform(k, 0, 0, k, (L.safeOffsetX + x) * k, y * k);
    const midY = L.logicH / 2;
    at(0, 0);
    this.drawScore(ctx);
    at(760, midY - 200);
    this.drawJudge(ctx);
    at(1520, midY - 320);
    this.drawCombo(ctx);
    at(0, midY - 386);
    this.drawAp(ctx);
    at(1420, 50);
    this.drawMental(ctx);
    at(1760, 30);
    this.drawPause(ctx);
    if (this.techDisplayMode !== 0) {
      at(1470, 158);
      this.drawTech(ctx);
    }
    ctx.restore();
  }

  private drawScore(ctx: Ctx): void {
    // z0：Gauge（圆角底 + 内描边）与 Slider（外描边 + 底 + 渐变填充）
    const g = placeRect(512, 160, 0.5, 0.5, 0.5, 0.5, 34, -12, 400, 48);
    fillRoundRect(ctx, g.x, g.y, g.w, g.h, 24, 'rgba(77,49,63,.702)');
    insetRing(ctx, g.x, g.y, g.w, g.h, 24, 2, PINK);
    const sl = placeRect(400, 48, 0.5, 0.5, 0.5, 0.5, 15, 0, 330, 16);
    const sx = g.x + sl.x, sy = g.y + sl.y;
    outerRing(ctx, sx, sy, 330, 16, 8, 2, '#4e444b');
    fillRoundRect(ctx, sx, sy, 330, 16, 8, '#191418');
    const fill = Math.max(0, Math.min(1, this.scoreEngine.gaugeFill())) * 330;
    if (fill > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(sx, sy, 330, 16, 8);
      ctx.clip();
      const grad = ctx.createLinearGradient(sx, 0, sx + fill, 0);
      grad.addColorStop(0, 'rgb(71,244,242)');
      grad.addColorStop(1, 'rgb(223,93,251)');
      ctx.fillStyle = grad;
      ctx.fillRect(sx, sy, fill, 16);
      ctx.restore();
    }
    // z1：RankLabels（竖线 + 字母，按 DOM 顺序交替）与 RankRoot
    const xs = [17, 76, 137, 183];
    const letters = ['C', 'B', 'A', 'S'];
    for (let i = 0; i < xs.length; i++) {
      const r = placeRect(512, 160, 0.5, 0.5, 0.5, 0.5, xs[i]!, -5, 4, 30);
      outerRing(ctx, r.x, r.y, r.w, r.h, 1, 1, PINK);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 1);
      ctx.clip();
      ctx.fillStyle = '#4e444b';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#fff';
      ctx.fillRect(r.x + 1, r.y, 2, r.h);
      ctx.restore();
      const t = placeRect(512, 160, 0.5, 0.5, 0.5, 0.5, xs[i]!, 16, 60, 40);
      ctx.save();
      scaleAbout(ctx, t.x + t.w / 2, t.y + t.h / 2, 0.92);
      drawOutlinedText(ctx, letters[i]!, { size: 28, weight: 700 }, { color: PINK, width: 2.8 }, '#fff', t.x, t.y, t.w, t.h);
      ctx.restore();
    }
    this.drawRank(ctx);
    // z2：AddScore 飘字
    if (this.addScore && this.addScore.a > 0) {
      const r = placeRect(512, 160, 0.5, 0.5, 0.5, 0.5, 305.8, -52, 200, 40);
      const dx = this.addScore.dx;
      drawGroup(ctx, { alpha: this.addScore.a, bounds: { x: r.x + dx - 20, y: r.y - 10, w: r.w + 200, h: r.h + 20 } }, (gc) => {
        drawOutlinedText(gc, this.addScoreText, { size: 24, weight: 700, align: 'left', letterSpacing: 0.96 },
          { color: PINK, width: 2.4 }, '#fff', r.x + dx, r.y, r.w, r.h);
      });
    }
    // z3：SCORE 标签与分数数字
    const lb = placeRect(512, 160, 0.5, 0.5, 0.5, 0.5, -80, 20, 120, 40);
    ctx.save();
    scaleAbout(ctx, lb.x + lb.w / 2, lb.y + lb.h / 2, 0.92);
    drawOutlinedText(ctx, 'SCORE', { size: 20, weight: 700 }, { color: PINK, width: 2 }, '#fff', lb.x, lb.y, lb.w, lb.h);
    ctx.restore();
    const strip = placeRect(512, 160, 0.5, 0.5, 0.5, 0.5, 45.8, -47, 300, 40);
    const score = this.scoreEngine.score;
    for (let i = 0; i < SCORE_DIGIT_X.length; i++) {
      const d = placeRect(300, 40, 0.5, 0.5, 0.5, 0.5, SCORE_DIGIT_X[i]!, 0, 32, 40);
      drawSprite(ctx, spriteUrl(scoreDigitSprite(score, i)), strip.x + d.x, strip.y + d.y, d.w, d.h);
    }
    for (let i = 0; i < SCORE_COMMA_X.length; i++) {
      const d = placeRect(300, 40, 0.5, 0.5, 0.5, 0.5, SCORE_COMMA_X[i]!, 0, 32, 40);
      drawSprite(ctx, spriteUrl(scoreCommaSprite(score, i)), strip.x + d.x, strip.y + d.y, d.w, d.h);
    }
  }

  /**
   * RankRoot: rank_base 110×121 @ (−170,−13)。
   * ScoreRankIcon 156×181 scale .55，整体以 button_rank 为遮罩：
   * rim（底色 RGB(155,145,174) × 贴图 multiply .8）→ White（inset 3，贴图自遮罩）→
   * Gray / RankColor（再 inset 3，底色 × 贴图 multiply）→ Shine .2 / Deco .8 / RankName。
   */
  private drawRank(ctx: Ctx): void {
    const r = placeRect(512, 160, 0.5, 0.5, 0.5, 0.5, -170, -13, 110, 121);
    drawSprite(ctx, spriteUrl('ui_sc2_ingame_rank_base'), r.x, r.y, r.w, r.h);
    const mask = image(spriteUrl('ui_sc2_button_rank'));
    if (!mask) return;
    const ix = r.x - 23, iy = r.y - 30; // 156×181 居中于 110×121
    ctx.save();
    scaleAbout(ctx, ix + 78, iy + 90.5, 0.55);
    // 图标只随段位 / 贴图就绪 / 变换变化：按设备像素缓存（嵌套遮罩逐帧重画很贵）。
    const m = ctx.getTransform();
    const loaded = ['ui_sc2_button_rank_shine', 'ui_sc2_button_rank_deco_01', 'ui_sc2_button_rank_deco_02']
      .map((n) => (image(spriteUrl(n)) ? 1 : 0)).join('');
    const key = [this.rank, loaded, m.a, m.b, m.c, m.d, m.e, m.f].join('|');
    if (this.rankCache?.key !== key) {
      const corners = [[ix, iy], [ix + 156, iy], [ix, iy + 181], [ix + 156, iy + 181]].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)));
      const bx = Math.floor(Math.min(...corners.map((p) => p.x))) - 2, by = Math.floor(Math.min(...corners.map((p) => p.y))) - 2;
      const bw = Math.ceil(Math.max(...corners.map((p) => p.x))) + 2 - bx, bh = Math.ceil(Math.max(...corners.map((p) => p.y))) + 2 - by;
      const canvas = this.rankCache?.canvas ?? document.createElement('canvas');
      canvas.width = Math.max(1, bw); canvas.height = Math.max(1, bh);
      const cc = canvas.getContext('2d')!;
      cc.setTransform(m.a, m.b, m.c, m.d, m.e - bx, m.f - by);
      cc.imageSmoothingEnabled = true;
      cc.imageSmoothingQuality = ctx.imageSmoothingQuality;
      this.paintRankIcon(cc, mask, ix, iy);
      this.rankCache = { key, canvas, x: bx, y: by };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.rankCache.canvas, this.rankCache.x, this.rankCache.y);
    ctx.restore();
  }

  private paintRankIcon(ctx: Ctx, mask: HTMLImageElement, ix: number, iy: number): void {
    const masked = (x: number, y: number, w: number, h: number, draw: (g: Ctx) => void) =>
      (g: Ctx) => drawGroup(g, { bounds: { x, y, w, h }, mask: (m) => m.drawImage(mask, x, y, w, h) }, draw);
    const fillBox = (x: number, y: number, w: number, h: number, bg: string | CanvasGradient) => (g: Ctx) => {
      g.fillStyle = bg;
      g.fillRect(x, y, w, h);
      g.globalCompositeOperation = 'multiply';
      g.drawImage(mask, x, y, w, h);
      g.globalCompositeOperation = 'source-over';
    };
    masked(ix, iy, 156, 181, (g) => {
      // rim：底色 + 贴图 multiply（img opacity .8）
      masked(ix, iy, 156, 181, (h) => {
        h.fillStyle = 'rgb(155,145,174)';
        h.fillRect(ix, iy, 156, 181);
        h.globalAlpha = 0.8;
        h.globalCompositeOperation = 'multiply';
        h.drawImage(mask, ix, iy, 156, 181);
        h.globalAlpha = 1;
        h.globalCompositeOperation = 'source-over';
      })(g);
      // White：inset 3（150×175），贴图自身作遮罩
      const wx = ix + 3, wy = iy + 3;
      masked(wx, wy, 150, 175, (h) => {
        h.drawImage(mask, wx, wy, 150, 175);
        const cx = wx + 3, cy = wy + 3;
        masked(cx, cy, 144, 169, fillBox(cx, cy, 144, 169, 'rgb(176,172,184)'))(h);
        if (this.rank !== 'none') {
          masked(cx, cy, 144, 169, (c) => {
            let bg: string | CanvasGradient;
            if (this.rank === 'S') {
              const grad = c.createLinearGradient(cx, 0, cx + 144, 0);
              grad.addColorStop(0, 'rgb(177,147,203)');
              grad.addColorStop(1, 'rgb(96,228,222)');
              bg = grad;
            } else {
              bg = ({ D: 'rgb(133,150,208)', C: 'rgb(54,215,225)', B: 'rgb(30,196,167)', A: 'rgb(253,91,145)' } as const)[this.rank as 'D'];
            }
            fillBox(cx, cy, 144, 169, bg)(c);
            const sh = placeRect(144, 169, 1, 0, 1, 0, 1, 1, 145, 126);
            const shine = image(spriteUrl('ui_sc2_button_rank_shine'));
            if (shine) { c.globalAlpha = 0.2; c.drawImage(shine, cx + sh.x, cy + sh.y, sh.w, sh.h); }
            c.globalAlpha = 0.8;
            const d1 = placeRect(144, 169, 0.5, 0.5, 0.5, 0.5, -21.5, 51, 103, 69);
            const d2 = placeRect(144, 169, 0.5, 0.5, 0.5, 0.5, 52, -36, 41, 57);
            drawSprite(c, spriteUrl('ui_sc2_button_rank_deco_01'), cx + d1.x, cy + d1.y, d1.w, d1.h, 'fill');
            drawSprite(c, spriteUrl('ui_sc2_button_rank_deco_02'), cx + d2.x, cy + d2.y, d2.w, d2.h, 'fill');
            c.globalAlpha = 1;
            const nm = placeRect(144, 169, 0.5, 0.5, 0.5, 0.5, 0, 2, 120, 120);
            drawText(c, this.rank, { size: 80, weight: 800, color: '#fff', shadow: { dy: 2, color: 'rgba(0,0,0,.302)' } },
              cx + nm.x, cy + nm.y, nm.w, nm.h);
          })(h);
        }
      })(g);
    })(ctx);
  }

  private drawJudge(ctx: Ctx): void {
    if (this.judgeScale !== null) {
      const r = placeRect(400, 400, 0.5, 0.5, 0.5, 0.5, 0, judgementLayoutY(this.judgementYOpt), this.judgeW, 80);
      ctx.save();
      scaleAbout(ctx, r.x + r.w / 2, r.y + r.h / 2, this.judgeScale);
      drawSprite(ctx, spriteUrl(this.judgeSprite), r.x, r.y, r.w, r.h);
      ctx.restore();
    }
    if (this.conditionScale !== null && this.conditionSpriteName) {
      const r = placeRect(400, 400, 0.5, 0.5, 0.5, 0.5, 0, fastSlowLayoutY(this.judgementYOpt, this.fastSlowYOpt), 180, 64);
      ctx.save();
      scaleAbout(ctx, r.x + r.w / 2, r.y + r.h / 2, this.conditionScale);
      drawSprite(ctx, spriteUrl(this.conditionSpriteName), r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  }

  /**
   * ComboRoot（400×320，自成层叠上下文，所以整块先画到隔离组再合成：组内的加色只与组内相加）。
   * 层序：上底光 → 数字行 → COMBO → AP増加徽章(3) → 爆发(4) → 徽章闪光 / 跨百闪光(5) → 下描边 / 上描边 / 下底光(6)。
   */
  private drawCombo(ctx: Ctx): void {
    drawGroup(ctx, { bounds: { x: -400, y: -300, w: 1200, h: 920 } }, (g) => {
      g.imageSmoothingQuality = 'high';
      const row = placeRect(400, 320, 0.5, 0.5, 0.5, 0.5, -44, 54, 360, 120);
      this.drawFxGlow(g, row, this.fx.upperGlow, 'upper');
      // 数字行
      const digits = comboSlotDigits(this.combo);
      g.save();
      scaleAbout(g, row.x + 180, row.y + 60, this.comboRectScale);
      digits.forEach((d, i) => {
        drawSprite(g, spriteUrl(`ui_sc2_ingame_num_combo_${d}`), row.x + comboSlotLeft(digits.length, i), row.y, 90, 120);
      });
      g.restore();
      const on = this.apRate >= 1;
      if (on) {
        const lb = placeRect(400, 320, 0.5, 0.5, 0.5, 0.5, -40, -30, 244, 65);
        drawSprite(g, spriteUrl('ui_sc2_ingame_combo'), lb.x, lb.y, lb.w, lb.h);
      }
      const badge = placeRect(400, 320, 0.5, 0.5, 0.5, 0.5, -40, -84, 240, 40);
      const label = on ? `AP増加 ×1.${this.apRate}` : '';
      if (on) this.drawApRateBadge(g, badge, label, 10, 'rgba(255,58,153,.55)');
      // 爆发（z4）
      if (this.burst) this.drawBurst(g, badge.x + 120, badge.y + 20);
      // 徽章闪光副本（z5）
      if (this.apRateUpper && this.apRateUpper.a > 0) {
        const u = this.apRateUpper;
        g.save();
        scaleAbout(g, badge.x + 120, badge.y + 20, u.s);
        drawGroup(g, { alpha: u.a, bounds: { x: badge.x - 30, y: badge.y - 30, w: 300, h: 100 } }, (h) => {
          this.drawApRateBadge(h, badge, label, 14, 'rgba(255,58,153,.7)');
        });
        g.restore();
      }
      // 跨百闪光（z5）：数字副本 + drop-shadow，整层淡出放大
      if (this.comboFlash && this.comboFlash.a > 0) {
        const f = this.comboFlash;
        const digitsF = this.comboFlashDigits;
        g.save();
        scaleAbout(g, row.x + 180, row.y + 60, f.s);
        const blur = 10 * deviceScale(g);
        drawGroup(g, { alpha: f.a, filter: `drop-shadow(0px 0px ${blur}px rgba(10,150,255,.55))`, bounds: { x: row.x - 40, y: row.y - 40, w: 440, h: 200 } }, (h) => {
          digitsF.forEach((d, i) => {
            drawSprite(h, spriteUrl(`ui_sc2_ingame_num_combo_${d}`), row.x + comboSlotLeft(digitsF.length, i), row.y, 90, 120);
          });
        });
        g.restore();
      }
      // z6：下描边、上描边（加色）、下底光（普通）
      this.drawFxOutline(g, row, this.fx.lowerOutline);
      this.drawFxOutline(g, row, this.fx.upperOutline);
      this.drawFxGlow(g, row, this.fx.lowerGlow, 'lower');
    });
  }

  private drawApRateBadge(g: Ctx, b: Rect, label: string, blur: number, shadow: string): void {
    outerBlurShadow(g, b.x, b.y, b.w, b.h, 20, blur, shadow);
    g.save();
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, 20);
    g.fillStyle = PINK;
    g.fill();
    g.clip();
    drawText(g, label, { size: 28, weight: 700, color: '#fff' }, b.x, b.y, b.w, b.h);
    g.restore();
  }

  /** APRateEffect：火花（加色）→ Root（加色）→ Bg_core 压暗（普通）/ 加亮（加色），以徽章中心为原点。 */
  private drawBurst(g: Ctx, cx: number, cy: number): void {
    const b = this.burst!;
    const sp = this.sparksCanvas;
    g.save();
    g.globalCompositeOperation = 'lighter';
    if (sp) g.drawImage(sp, cx - AP_RATE_SPARK_CANVAS.w / 2, cy - AP_RATE_SPARK_CANVAS.h / 2, AP_RATE_SPARK_CANVAS.w, AP_RATE_SPARK_CANVAS.h);
    const root = image(AP_RATE_ROOT_TEX);
    if (root && b.rootAlpha > 0) {
      const w = AP_RATE_BURST_ROOT.w * b.s, h = AP_RATE_BURST_ROOT.h * b.s;
      g.globalAlpha = Math.min(1, b.rootAlpha);
      g.drawImage(root, cx - w / 2, cy - h / 2, w, h);
      g.globalAlpha = 1;
    }
    if (this.apRateCoreTex && this.coreShade && this.coreLight) {
      const w = AP_RATE_BURST_CORE.w * b.s, h = AP_RATE_BURST_CORE.h * b.s;
      g.globalCompositeOperation = 'source-over';
      g.drawImage(this.coreShade, cx - w / 2, cy - h / 2, w, h);
      g.globalCompositeOperation = 'lighter';
      g.drawImage(this.coreLight, cx - w / 2, cy - h / 2, w, h);
    }
    g.restore();
  }

  /** AP 継続描边（加色）：每槽 4 / 5 颗同位粒子 = 同一面片以 lighter 叠 N 次。 */
  private drawFxOutline(g: Ctx, row: Rect, st: ComboFxLayerState): void {
    if (st.combo <= 0 || st.opacity <= 0) return;
    const count = st === this.fx.upperOutline ? COMBO_EFFECT_UPPER_BURST : COMBO_EFFECT_LOWER_BURST;
    const digits = fxSlotDigits(st.combo);
    g.save();
    scaleAbout(g, row.x + 180, row.y + 60, st.layerScale);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = Math.min(1, st.opacity);
    digits.forEach((d, i) => {
      const b = comboEffectOutlineBox(d);
      const tex = tintedMask(b.image === 'digit1' ? COMBO_EFFECT_DIGIT1_TEX : COMBO_EFFECT_SHEET_TEX, COMBO_EFFECT_COLOR);
      if (!tex) return;
      const px = row.x + comboSlotLeft(digits.length, i) + b.left, py = row.y + b.top;
      g.save();
      scaleAbout(g, px + b.width / 2, py + b.height / 2, st.partScale[i] ?? 1);
      g.beginPath();
      g.rect(px, py, b.width, b.height);
      g.clip();
      for (let n = 0; n < count; n++) g.drawImage(tex, px + b.maskX, py, b.maskW, b.maskH);
      g.restore();
    });
    g.restore();
  }

  /** AP 継続底光：上层加色（着色蒙版 200×250）、下层普通合成（预乘贴图 230×280），每槽 2 颗。 */
  private drawFxGlow(g: Ctx, row: Rect, st: ComboFxLayerState, kind: 'upper' | 'lower'): void {
    if (st.combo <= 0 || st.opacity <= 0) return;
    const tex = kind === 'upper' ? tintedMask(COMBO_GLOW_UPPER_TEX, COMBO_GLOW_UPPER_COLOR) : image(COMBO_GLOW_LOWER_TEX);
    if (!tex) return;
    const w = kind === 'upper' ? 200 : 230, h = kind === 'upper' ? 250 : 280;
    const digits = fxSlotDigits(st.combo);
    g.save();
    scaleAbout(g, row.x + 180, row.y + 60, st.layerScale);
    g.globalCompositeOperation = kind === 'upper' ? 'lighter' : 'source-over';
    g.globalAlpha = Math.min(1, st.opacity);
    digits.forEach((_, i) => {
      const cx = row.x + comboSlotLeft(digits.length, i) + 45, cy = row.y + 60;
      g.save();
      scaleAbout(g, cx, cy, st.partScale[i] ?? 1);
      for (let n = 0; n < COMBO_GLOW_BURST; n++) g.drawImage(tex, cx - w / 2, cy - h / 2, w, h);
      g.restore();
    });
    g.restore();
  }

  /** AP / VOLTAGE 圆盘（.hud-ap 自成层叠上下文）。层序：底盘 → 环(1) → 进度 / 数值 / 标签(2) → 闪光数值(3)。 */
  private drawAp(ctx: Ctx): void {
    const meters = [
      { x: -60, base: 'ui_sc2_ingame_ap_base', gage: 'ui_sc2_ingame_gage_ap', fill: this.apFill, text: this.apText,
        scale: this.apValueScale, upper: this.apUpper, upperText: this.apUpperText, color: '#0084ff' },
      { x: 80, base: 'ui_sc2_ingame_voltage_base', gage: 'ui_sc2_ingame_gage_voltage', fill: this.voltageFill, text: this.voltageText,
        scale: this.voltageValueScale, upper: this.voltageUpper, upperText: this.voltageUpperText, color: '#ff574c' },
    ].map((m) => ({ ...m, d: placeRect(320, 160, 0.5, 0.5, 0.5, 0.5, m.x, -8, 138, 138) }));
    for (const m of meters) drawSprite(ctx, spriteUrl(m.base), m.d.x, m.d.y, 138, 138);
    for (const m of meters) drawSprite(ctx, spriteUrl('ui_sc2_ingame_gage_base_02'), m.d.x + 22, m.d.y + 22, 94, 94);
    const valueRect = (d: Rect) => {
      const v = placeRect(138, 138, 0.5, 0.5, 0.5, 0.5, 0, 2, 80, 40);
      return { x: d.x + v.x, y: d.y + v.y, w: v.w, h: v.h };
    };
    const valueText = (g: Ctx, text: string, color: string, r: Rect) =>
      drawOutlinedText(g, text, { size: 32, weight: 700 }, { color: '#fff', width: 2.6 }, color, r.x, r.y, r.w, r.h);
    for (const m of meters) {
      // Image.Type.Filled / Radial360 / fillOrigin Top / fillClockwise=false：
      // 可见扇区 = 从正上方逆时针 fill×360°（原 CSS conic-gradient 遮罩）。
      const img = image(spriteUrl(m.gage));
      if (img && m.fill > 0) {
        const fx = m.d.x + 24, fy = m.d.y + 24;
        drawGroup(ctx, {
          bounds: { x: fx, y: fy, w: 90, h: 90 },
          mask: (g) => {
            const grad = g.createConicGradient(-Math.PI / 2, fx + 45, fy + 45);
            const cut = Math.max(0, Math.min(1, 1 - m.fill));
            grad.addColorStop(0, 'rgba(255,255,255,0)');
            grad.addColorStop(cut, 'rgba(255,255,255,0)');
            grad.addColorStop(cut, '#fff');
            grad.addColorStop(1, '#fff');
            g.fillStyle = grad;
            g.fillRect(fx, fy, 90, 90);
          },
        }, (g) => {
          g.beginPath();
          g.rect(fx, fy, 90, 90);
          g.clip();
          g.drawImage(img, fx, fy, 90, 90);
        });
      }
      const r = valueRect(m.d);
      ctx.save();
      scaleAbout(ctx, r.x + r.w / 2, r.y + r.h / 2, m.scale);
      valueText(ctx, m.text, m.color, r);
      ctx.restore();
    }
    const label = (text: string, x: number, w: number, color: string) => {
      const r = placeRect(320, 160, 0.5, 0.5, 0.5, 0.5, x, 53, w, 40);
      ctx.save();
      scaleAbout(ctx, r.x + r.w / 2, r.y + r.h / 2, 0.92);
      drawOutlinedText(ctx, text, { size: 20, weight: 700 }, { color, width: 2 }, '#fff', r.x, r.y, r.w, r.h);
      ctx.restore();
    };
    label('AP', -60, 80, 'rgb(0,132,255)');
    label('VOLTAGE', 80, 120, 'rgb(255,87,76)');
    for (const m of meters) {
      if (!m.upper || m.upper.a <= 0) continue;
      const r = valueRect(m.d);
      const up = m.upper;
      ctx.save();
      scaleAbout(ctx, r.x + r.w / 2, r.y + r.h / 2, up.s);
      drawGroup(ctx, { alpha: up.a, bounds: { x: r.x - 20, y: r.y - 10, w: r.w + 40, h: r.h + 20 } }, (g) => valueText(g, m.upperText, m.color, r));
      ctx.restore();
    }
  }

  /** MENTAL 框：满血常驻（预览不扣血）。 */
  private drawMental(ctx: Ctx): void {
    fillRoundRect(ctx, 0, 0, 400, 80, 40, 'rgba(0,0,0,.302)');
    insetRing(ctx, 0, 0, 400, 80, 40, 2, '#1debc7');
    const box = (x: number, w: number) => placeRect(400, 80, 0.5, 0.5, 0.5, 0.5, x, 16, w, 40);
    const lb = box(-108, 120);
    ctx.save();
    scaleAbout(ctx, lb.x + lb.w / 2, lb.y + lb.h / 2, 0.92);
    drawOutlinedText(ctx, 'MENTAL', { size: 24, weight: 700 }, { color: TEAL, width: 2.4 }, '#fff', lb.x, lb.y, lb.w, lb.h);
    ctx.restore();
    const full = '1000';
    const now = box(-16, 88), sep = box(41, 32), max = box(80, 80);
    drawText(ctx, full, { size: 24, weight: 700, color: '#fff', align: 'right' }, now.x, now.y, now.w, now.h);
    drawText(ctx, '/', { size: 24, weight: 700, color: '#fff' }, sep.x, sep.y, sep.w, sep.h);
    drawText(ctx, full, { size: 24, weight: 700, color: '#fff', align: 'right' }, max.x, max.y, max.w, max.h);
    const tr = placeRect(400, 80, 0.5, 0.5, 0, 0.5, -160, -16, 280, 16);
    outerRing(ctx, tr.x, tr.y, tr.w, tr.h, 8, 2, 'rgb(78,68,75)');
    fillRoundRect(ctx, tr.x, tr.y, tr.w, tr.h, 8, 'rgb(25,20,24)');
    // GradientColor level56 #1546 × white Fill（满血）
    const grad = ctx.createLinearGradient(tr.x, 0, tr.x + tr.w, 0);
    grad.addColorStop(0, 'rgb(29,235,199)');
    grad.addColorStop(1, 'rgb(118,240,224)');
    fillRoundRect(ctx, tr.x, tr.y, tr.w, tr.h, 8, grad);
  }

  /** 暂停按钮（SafeArea 右上，120×120）。 */
  private drawPause(ctx: Ctx): void {
    fillRoundRect(ctx, 0, 0, 120, 120, 60, 'rgb(105,99,101)');
    fillRoundRect(ctx, 8, 8, 104, 104, 52, 'rgb(248,244,241)');
    const cx = 16, cy = 16;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cx, cy, 88, 88, 44);
    ctx.fillStyle = 'rgb(231,217,206)';
    ctx.fill();
    ctx.clip();
    // ColorImage 内的花纹（按原 104×104 父框算位置）
    const shine = image(spriteUrl('ui_sc2_button_shine'));
    if (shine) {
      ctx.globalAlpha = 0.349;
      drawContain(ctx, shine, cx - 37.7257, cy - 2.8865, 184.6514, 54.887);
    }
    const dot = image(spriteUrl('ui_sc2_button_dot'));
    if (dot) {
      ctx.globalAlpha = 0.298;
      drawContain(ctx, dot, cx - 26.8075, cy - 35.2076, 157.6151, 157.6151);
    }
    ctx.globalAlpha = 1;
    // 图标：两根横条（46×16 白 / 40×10 灰），整体转 90°
    const ix = cx + 25, iy = cy + 21;
    ctx.translate(ix + 19, iy + 23);
    ctx.rotate(Math.PI / 2);
    ctx.translate(-(ix + 19), -(iy + 23));
    for (let i = 0; i < 2; i++) {
      const bx = ix - 4, by = iy + 4 + i * 22;
      fillRoundRect(ctx, bx, by, 46, 16, 4, '#fff');
      fillRoundRect(ctx, bx + 3, by + 3, 40, 10, 3, 'rgb(105,99,101)');
    }
    ctx.restore();
  }

  /** TECHNICAL SCORE 框（TechnicalScoreDisplay ≠ 0 时显示）。 */
  private drawTech(ctx: Ctx): void {
    fillRoundRect(ctx, 0, 0, 394, 80, 40, 'rgba(0,0,0,.302)');
    insetRing(ctx, 0, 0, 394, 80, 40, 2, '#1debc7');
    // 标签：两行，line-height .85，左对齐，垂直居中后 scale .92
    const lh = 24 * 0.85;
    const top = 40 - lh;
    ctx.save();
    scaleAbout(ctx, 40.9 + 73, 40, 0.92);
    ['TECHNICAL', 'SCORE'].forEach((line, i) => {
      drawOutlinedText(ctx, line, { size: 24, weight: 700, align: 'left' }, { color: TEAL, width: 2.4 }, '#fff', 40.9, top + i * lh, 146, lh);
    });
    ctx.restore();
    // 数值：大字 36 EB + 小字 24 B 同基线，右缘 = 394 − 21
    const big = { size: 36, weight: 800, color: '#fff', align: 'left' as const };
    const small = { size: 24, weight: 700, color: '#fff', align: 'left' as const };
    setTextStyle(ctx, big);
    const e36 = fontExtents(ctx, ctx.font);
    const wBig = ctx.measureText(this.techText.whole).width;
    setTextStyle(ctx, small);
    const wSmall = ctx.measureText(this.techText.frac).width;
    const h = e36.asc + e36.desc;
    const baseline = (80 - h) / 2 + e36.asc;
    const x0 = 373 - (wBig + wSmall);
    setTextStyle(ctx, big);
    ctx.fillStyle = '#fff';
    ctx.fillText(this.techText.whole, x0, baseline);
    setTextStyle(ctx, small);
    ctx.fillText(this.techText.frac, x0 + wBig, baseline);
  }

  // ── 检查接口（自动化测试 / 调试用）────────────────────────────────
  /**
   * 按最近一次 draw 的视口，返回各元素在舞台 CSS 像素里的几何与状态。
   * 与绘制共用同一组布局函数，测试据此核对原 DOM 版本的布局契约。
   */
  inspect() {
    const v = this.lastView;
    const L = hudLayout(v.cssW, v.cssH);
    const s = L.scale;
    const comboX = L.safeOffsetX + 1520, comboY = L.logicH / 2 - 320;
    const toStage = (x: number, y: number, w: number, h: number) => ({ x: (comboX + x) * s, y: (comboY + y) * s, w: w * s, h: h * s });
    const row = placeRect(400, 320, 0.5, 0.5, 0.5, 0.5, -44, 54, 360, 120);
    const badge = placeRect(400, 320, 0.5, 0.5, 0.5, 0.5, -40, -84, 240, 40);
    const digits = comboSlotDigits(this.combo);
    const slotCenter = (n: number, i: number, scale: number) => {
      const c = row.x + comboSlotLeft(n, i) + 45;
      const cx = row.x + 180;
      return (comboX + cx + (c - cx) * scale) * s;
    };
    const layer = (name: keyof LiveHud['fx']) => {
      const st = this.fx[name];
      const ds = fxSlotDigits(st.combo);
      const outline = name === 'lowerOutline' || name === 'upperOutline';
      return {
        visible: st.combo > 0,
        layerScale: st.layerScale,
        opacity: st.opacity,
        partsPerSlot: outline ? (name === 'upperOutline' ? COMBO_EFFECT_UPPER_BURST : COMBO_EFFECT_LOWER_BURST) : COMBO_GLOW_BURST,
        composite: name === 'lowerGlow' ? 'source-over' : 'lighter',
        slotCenters: ds.map((_, i) => slotCenter(ds.length, i, st.layerScale)),
        parts: outline ? ds.map((d) => {
          const b = comboEffectOutlineBox(d);
          return { w: b.width, h: b.height, l: b.left, t: b.top, mx: b.maskX, op: st.opacity, img: b.image === 'digit1' ? COMBO_EFFECT_DIGIT1_TEX : COMBO_EFFECT_SHEET_TEX };
        }) : [],
        glow: outline ? [] : ds.map((_, i) => ({ w: name === 'upperGlow' ? 200 : 230, op: st.opacity, scale: st.partScale[i] ?? 1 })),
      };
    };
    const b = this.burst;
    const rootImg = image(AP_RATE_ROOT_TEX);
    return {
      view: v,
      scale: s,
      combo: {
        value: this.combo,
        sprites: digits.map((d) => `ui_sc2_ingame_num_combo_${d}`),
        slotCenters: digits.map((_, i) => slotCenter(digits.length, i, this.comboRectScale)),
        rowScale: this.comboRectScale,
      },
      score: { value: this.scoreEngine.score, sprites: SCORE_DIGIT_X.map((_, i) => scoreDigitSprite(this.scoreEngine.score, i)) },
      judge: { visible: this.judgeScale !== null, sprite: this.judgeSprite, scale: this.judgeScale },
      condition: { visible: this.conditionScale !== null, sprite: this.conditionSpriteName },
      fx: {
        order: ['upperGlow', 'row', 'label', 'badge', 'burst', 'badgeFlash', 'comboFlash', 'lowerOutline', 'upperOutline', 'lowerGlow'],
        lowerOutline: layer('lowerOutline'), upperOutline: layer('upperOutline'),
        lowerGlow: layer('lowerGlow'), upperGlow: layer('upperGlow'),
      },
      apRate: { value: this.apRate, visible: this.apRate >= 1, badge: toStage(badge.x, badge.y, badge.w, badge.h), badgeCssW: badge.w },
      burst: {
        active: b !== null,
        scale: b?.s ?? 0,
        root: b ? toStage(badge.x + 120 - AP_RATE_BURST_ROOT.w * b.s / 2, badge.y + 20 - AP_RATE_BURST_ROOT.h * b.s / 2,
          AP_RATE_BURST_ROOT.w * b.s, AP_RATE_BURST_ROOT.h * b.s) : null,
        rootSrc: AP_RATE_ROOT_TEX,
        rootLoaded: rootImg !== null,
        hasCore: this.apRateCoreTex !== null && this.coreShade !== null && this.coreLight !== null,
        sparksCssW: AP_RATE_SPARK_CANVAS.w,
      },
      sparksCanvas: this.sparksCanvas,
      coreLightCanvas: this.coreLight,
      ap: { text: this.apText, voltage: this.voltageText, apFill: this.apFill, voltageFill: this.voltageFill },
      rank: this.rank,
      tech: this.techDisplayMode === 0 ? null : `${this.techText.whole}${this.techText.frac}`,
    };
  }
}
