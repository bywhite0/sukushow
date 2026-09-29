import type { Chart, Note } from './chart';
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

import { isFeverAt, type FeverWindow } from './fever';
import { noteJudgementTimes } from './chart';
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

function place(
  node: HTMLElement,
  parentW: number, parentH: number,
  ax: number, ay: number, px: number, py: number,
  x: number, y: number, w: number, h: number,
): void {
  const pivotX = parentW * ax + x;
  const pivotY = parentH * ay + y;
  node.style.position = 'absolute';
  node.style.left = `${pivotX - px * w}px`;
  node.style.top = `${parentH - (pivotY + (1 - py) * h)}px`;
  node.style.width = `${w}px`;
  node.style.height = `${h}px`;
}

// Missing /rg sprites must not throw. Text fallback stays up until the image loads;
// a 404 removes the image and keeps the fallback (or a CSS disc for empty bases).
function mountSprite(host: HTMLElement, name: string, fallback: string): void {
  host.dataset.sprite = name;
  const text = document.createElement('span');
  text.className = 'hud-fb';
  text.textContent = fallback;
  text.hidden = fallback.length === 0;
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  img.hidden = true;
  const reveal = () => {
    img.hidden = false;
    // Drop the text fallback once the sprite is up — otherwise .hud-fb{display:flex}
    // can fight [hidden] and leave PERFECT/COMBO/digits stacked on the image.
    text.remove();
  };
  const fail = () => {
    img.remove();
    host.classList.add('is-missing');
    text.hidden = fallback.length === 0;
  };
  img.addEventListener('load', reveal);
  img.addEventListener('error', fail);
  host.append(img, text);
  img.src = spriteUrl(name);
  if (img.complete) {
    if (img.naturalWidth > 0) reveal();
    else fail();
  }
}

/** Swap sprite in place — used by live score digits to avoid clear+remount flicker. */
function setSprite(host: HTMLElement, name: string, fallback: string): void {
  if (host.dataset.sprite === name) return;
  const img = host.querySelector(':scope > img') as HTMLImageElement | null;
  if (!img) {
    while (host.firstChild) host.removeChild(host.firstChild);
    host.classList.remove('is-missing');
    mountSprite(host, name, fallback);
    return;
  }
  host.dataset.sprite = name;
  host.classList.remove('is-missing');
  const url = spriteUrl(name);
  // Keep the previous frame visible; cached same-origin sprites usually complete sync.
  const onLoad = () => {
    img.hidden = false;
    host.querySelector(':scope > .hud-fb')?.remove();
  };
  img.onload = onLoad;
  img.onerror = () => {
    img.remove();
    host.classList.add('is-missing');
    let text = host.querySelector(':scope > .hud-fb') as HTMLElement | null;
    if (!text) {
      text = document.createElement('span');
      text.className = 'hud-fb';
      host.append(text);
    }
    text.textContent = fallback;
    text.hidden = fallback.length === 0;
  };
  // 同步解码：换图的那一帧就画新数字。async 时浏览器会先保留旧帧，跳转时多位同时换图会看到慢一拍。
  img.decoding = 'sync';
  img.src = url;
  if (img.complete && img.naturalWidth > 0) onLoad();
}

/**
 * 实时数字贴图常驻：预取并解码后保留引用，跳转时换图不必再下载 / 解码。
 * 含 combo / 分数数字精灵，以及 AP 継続 描边与底光用作 CSS 蒙版 / 背景的贴图。
 */
const warmSpriteRefs: HTMLImageElement[] = [];
function warmImages(urls: string[]): void {
  for (const url of urls) {
    const img = new Image();
    img.src = url;
    void img.decode().catch(() => {});
    warmSpriteRefs.push(img);
  }
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


/** Face on top + outline clone underneath. Stroke on the underlayer only (2× outlinePx)
 *  so the face keeps Rodin weight while the visible ring matches TMP band width. */
function mountOutlinedText(host: HTMLElement, text: string, asHtml = false): void {
  const ol = document.createElement('span');
  ol.className = 'hud-ol';
  ol.setAttribute('aria-hidden', 'true');
  const face = document.createElement('span');
  face.className = 'hud-face';
  if (asHtml) {
    ol.innerHTML = text;
    face.innerHTML = text;
  } else {
    ol.textContent = text;
    face.textContent = text;
  }
  host.replaceChildren(ol, face);
}

/** 数字 1 的描边蒙版（着色器窄字形采样，见 comboEffectOutlineBox）；其余数字用 CSS 里的整张图。 */
const COMBO_EFFECT_DIGIT1_MASK = 'url(/rg/fx/tex/ui_sc2_ingame_num_combo_Effect_1.png)';
/** AP 継続 四层用到的全部贴图（与 style.css 中 .hud-combo-fx-* 一致），用于预解码。 */
const COMBO_FX_TEXTURES = [
  '/rg/fx/tex/ui_sc2_ingame_num_combo_Effect.png',
  '/rg/fx/tex/ui_sc2_ingame_num_combo_Effect_1.png',
  '/rg/fx/tex/sc2_effect_combo_glow_002.png',
  '/rg/fx/tex/sc2_effect_combo_glow_002_alpha_lower.png',
];

/** AP 継続特效的四层（见 LiveHud.comboFx）。 */
type ComboFxLayerKey = 'lowerOutline' | 'upperOutline' | 'lowerGlow' | 'upperGlow';
interface ComboFxLayer {
  el: HTMLElement;
  kind: 'outline' | 'glow';
  /** [0]=个位 … [3]=千位；parts = 同簇粒子副本；digit = 当前已铺的数字（-1 未铺）。 */
  slots: { el: HTMLElement; parts: HTMLElement[]; digit: number }[];
}

export class LiveHud {
  private readonly stage: HTMLElement;
  private readonly root: HTMLElement;
  private readonly logic: HTMLElement;
  private readonly comboRow: HTMLElement;
  private readonly comboDigits: HTMLElement[] = [];
  private readonly comboLabel: HTMLElement;
  private readonly apRateBadge: HTMLElement;
  private readonly apRateValue: HTMLElement;
  private apValueEl: HTMLElement | null = null;
  private voltageValueEl: HTMLElement | null = null;
  private apGageEl: HTMLElement | null = null;
  private voltageGageEl: HTMLElement | null = null;
  private readonly techRoot: HTMLElement;
  private readonly scoreDigits: HTMLElement[] = [];
  private readonly scoreCommas: HTMLElement[] = [];
  private gaugeFillEl: HTMLElement | null = null;
  private readonly scoreEngine = new ScoreEngine(DEFAULT_SCORE_CONFIG);
  private techDisplayMode: 0 | 1 | 2 = 0;
  private rankManual = false;
  private rankColorEl: HTMLElement | null = null;
  private rankNameEl: HTMLElement | null = null;
  private rankGrayEl: HTMLElement | null = null;
  private readonly judge: HTMLElement;
  private readonly observer: ResizeObserver;
  private chart: Chart | null = null;
  private previousTime = 0;
  private combo = 0;
  private apRate = 0;
  private judgeAt = -1;
  private conditionAt = -1;
  private conditionEl: HTMLElement | null = null;
  private enablePerfectPlus: boolean = RG_OPTION_DEFAULTS.enablePerfectPlus;
  private judgementYOpt = RG_OPTION_DEFAULTS.judgementY;
  private fastSlowYOpt = RG_OPTION_DEFAULTS.fastSlowY;
  private enableFeverDisplay: boolean = RG_OPTION_DEFAULTS.enableFeverDisplay;
  private enableApContinue: boolean = RG_OPTION_DEFAULTS.enableApContinue;
  private feverWindow: FeverWindow | null = null;
  private judgePop: HTMLElement | null = null;
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
  /**
   * AP 継続特效四层（每层 4 个数字槽，与数字行同矩形同布局）：
   * - lowerOutline：SpriteRoot/Sprite0~3/ComboEffectOutLine_02（循环，4 颗加法叠加）
   * - upperOutline：SpriteUpperRoot/Sprite0~3/ComboEffectOutLine_01（跨百单次，5 颗加法叠加）
   * - lowerGlow：OutLine_02 下的 ComboEffectBG_01（循环，Alpha 混合，sortingOrder 10 ⇒ 最上）
   * - upperGlow：OutLine_01 下的 ComboEffectBG_01（单次，加法，sortingOrder 1 ⇒ 在数字后面）
   */
  private comboFx: Record<ComboFxLayerKey, ComboFxLayer> | null = null;
  /** 下层（描边 + 底光）循环的时间基：开局 / Clear 起算，isRefreshLoop（combo 位数变化）时重启。 */
  private comboFxLowerAt = 0;
  /** 上层时间基 = DoEffectCombo（跨百）时刻；-1 = 未在播。 */
  private comboFxUpperAt = -1;
  /** DoEffectCombo 写入上层的未掩码 combo，以及当时的 isApContinue（决定渲染器开关）。 */
  private comboFxUpperCombo = 0;
  private comboFxUpperOn = false;
  /** ComboRectTween 当前缩放（下层粒子只随它展开槽位，尺寸不变）。 */
  private comboRectScale = 1;
  private comboRectTransform = '';
  private apRateFlashAt = -1;
  private prevComboForFlash = 0;
  private lastPaintedApRate = -1;
  private lastApDisplay = -1;
  private lastVoltageDisplay = -1;
  private apValuePopAt = -1;
  private voltageValuePopAt = -1;
  private apValueFlashAt = -1;
  private voltageValueFlashAt = -1;
  private apValueUpperEl: HTMLElement | null = null;
  private voltageValueUpperEl: HTMLElement | null = null;
  private apRateUpperEl: HTMLElement | null = null;
  private comboFlashEl: HTMLElement | null = null;
  private comboFlashDigits: HTMLElement | null = null;
  private apRateBurstEl: HTMLElement | null = null;
  /** APRateEffect #229 Particle / #228 ClossParticle 的粒子（出生时按原包参数取定）。 */
  private apRateBurstSparks: ApRateSpark[] = [];
  /** 两种火花贴图拆成的 R/G/B 单通道图（预乘），用于按顶点色逐通道加色。 */
  private readonly apRateTexChannels = new Map<string, { ch: HTMLCanvasElement[] }>();
  /** #41 Bg_core 的 `Default-Particle` 像素（非预乘 RGBA）。 */
  private apRateCoreTex: { w: number; h: number; px: Uint8ClampedArray } | null = null;
  /** 爆发是否已建好（区别于 `apRateFlashAt` 的动画时基）。 */
  private apRateBurstLive = false;
  private addScoreEl: HTMLElement | null = null;
  private addScoreAt = -1;


  constructor(stage: HTMLElement) {
    this.stage = stage;
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.setAttribute('aria-hidden', 'true');
    this.logic = document.createElement('div');
    this.logic.className = 'hud-logic';
    const safe = document.createElement('div');
    safe.className = 'hud-safe';
    this.logic.append(safe);
    this.root.append(this.logic);
    stage.append(this.root);

    this.buildScore(safe);
    this.judge = this.buildJudge(safe);
    const combo = this.buildCombo(safe);
    warmImages([
      ...[
        ...Array.from({ length: 10 }, (_, d) => `ui_sc2_ingame_num_combo_${d}`),
        ...Array.from({ length: 10 }, (_, d) => `ui_sc2_ingame_num_score_${d}`),
        SCORE_DIM_ZERO, SCORE_DIM_COMMA, SCORE_COMMA,
      ].map(spriteUrl),
      ...COMBO_FX_TEXTURES,
    ]);
    this.comboRow = combo.row;
    this.comboLabel = combo.label;
    this.apRateBadge = combo.apRate;
    this.apRateValue = combo.apRateValue;
    this.buildAp(safe);
    this.buildMental(safe);
    this.buildPause(safe);
    this.techRoot = this.buildTechnicalScore(safe);

    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(stage);
    this.layout();
    this.paintApRate();
    this.paintApVoltage();
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
    this.observer.disconnect();
    this.root.remove();
  }

  /**
   * TechnicalScoreDisplay: 0 off / 1 realtime / 2 estimate remaining as all Perfect+.
   * Preview has no scoring engine: mode 1 shows 0.0000%, mode 2 shows 101.0000% (all-PP ceiling).
   */
  setTechnicalScoreDisplay(mode: 0 | 1 | 2): void {
    this.techDisplayMode = mode;
    this.techRoot.hidden = mode === 0;
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
    this.paintScore();
    this.paintGauge();
    if (!this.rankManual) this.setRank(scoreRankDisplay(this.scoreEngine.rank, this.scoreEngine.score));
    this.paintTechnicalFromEngine();
  }

  private paintTechnicalFromEngine(): void {
    if (this.techDisplayMode === 0) {
      this.techRoot.hidden = true;
      return;
    }
    this.techRoot.hidden = false;
    const push = this.scoreEngine.technicalPush(this.techDisplayMode);
    this.paintTechnicalScore(technicalPercent(push));
  }

  private paintTechnicalScore(percent: number): void {
    const { whole, frac } = formatTechnicalScore(percent);
    const value = this.techRoot.querySelector('.hud-tech-value');
    if (!value) return;
    value.innerHTML = `<span class="is-big">${whole}</span><span class="is-small">${frac}</span>`;
  }

  /** 一批同刻判定（AutoPlay 恒为同一判定类型）：计分 + 触发判定字 / 闪光等特效。 */
  private applyHits(hits: number, time: number, jType: NoteJudgementType): void {
    const prevCombo = this.combo;
    // AP 継続：`isApContinue &= (type & 0xFE) == 4`（ScoreResolver.Add @0x49A1460）。
    this.isApContinue = apContinueAfterHit(this.isApContinue, jType);
    this.scoreEngine.addMany(jType, hits);
    this.combo = this.scoreEngine.combo;
    this.apRate = this.scoreEngine.apRate;
    this.paintCombo();
    this.paintApRate();
    this.paintScore();
    if (this.scoreEngine.lastAdd > 0) this.triggerAddScore(this.scoreEngine.lastAdd, time);
    this.paintApVoltage();
    this.paintGauge();
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
      this.paintCombo();
      this.paintApRate();
      this.paintScore();
      this.paintGauge();
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
    if (this.comboFlashEl) {
      this.comboFlashEl.classList.remove('is-on');
      this.comboFlashEl.style.opacity = '0';
    }
    if (this.addScoreEl) {
      this.addScoreEl.style.visibility = 'hidden';
      this.addScoreEl.style.opacity = '0';
      this.addScoreEl.style.transform = '';
    }
    this.comboRow.style.transform = '';
    this.rankManual = false;
    this.lastApDisplay = -1;
    this.lastVoltageDisplay = -1;
    this.apValuePopAt = -1;
    this.voltageValuePopAt = -1;
    this.apValueFlashAt = -1;
    this.voltageValueFlashAt = -1;
    if (this.apValueUpperEl) {
      this.apValueUpperEl.classList.remove('is-on');
      this.apValueUpperEl.style.opacity = '0';
      this.apValueUpperEl.style.transform = '';
    }
    if (this.voltageValueUpperEl) {
      this.voltageValueUpperEl.classList.remove('is-on');
      this.voltageValueUpperEl.style.opacity = '0';
      this.voltageValueUpperEl.style.transform = '';
    }
    if (this.apRateUpperEl) {
      this.apRateUpperEl.classList.remove('is-on');
      this.apRateUpperEl.style.opacity = '0';
      this.apRateUpperEl.style.transform = '';
    }
    this.clearApRateBurst();
    this.paintCombo();
    this.paintApRate();
    this.paintScore();
    this.paintGauge();
    this.paintApVoltage();
    this.setRank('none');
    this.paintTechnicalFromEngine();
    this.paintJudge(time);
  }

  private layout(): void {
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    if (w < 1 || h < 1) return;
    const scale = hudScale(w, h);
    // Logical canvas is stage pixels / scale. SafeArea is 1920 wide, centered,
    // and as tall as that logical canvas (stageHeight / scale).
    this.logic.style.width = `${w / scale}px`;
    this.logic.style.height = `${h / scale}px`;
    this.logic.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  private paintCombo(): void {
    // UpdateCombo(SpriteRenderer[], int) @0x49A426C — Unity keeps 4 fixed slots.
    // combo < 10 ⇒ treat as 0 (all inactive). [0]=units; inactive children do not layout.
    let n = this.combo < 10 ? 0 : this.combo;
    for (let i = 0; i < this.comboDigits.length; i++) {
      const slot = this.comboDigits[i];
      if (n > 0) {
        const d = n % 10;
        slot.hidden = false;
        setSprite(slot, `ui_sc2_ingame_num_combo_${d}`, String(d));
        n = Math.trunc(n * 0.1);
      } else {
        slot.hidden = true;
      }
    }
  }

  private paintApRate(): void {
    // UpdateApRate: apRate >= 1 ⇒ COMBO label on + badge text; else both hidden / alpha 0.
    // ApRateFlash (APRateUpper) restart is gated in onComboAdvanced (only when apRate changes).
    const on = this.apRate >= 1;
    this.comboLabel.hidden = !on;
    this.apRateBadge.hidden = !on;
    const label = on ? `AP増加 ×1.${this.apRate}` : '';
    this.apRateValue.textContent = label;
    if (this.apRateUpperEl) {
      const uv = this.apRateUpperEl.querySelector('.hud-aprate-value');
      if (uv) uv.textContent = label;
    }
    if (on) {
      this.apRateBadge.style.background = 'rgb(255,58,153)'; // (1, 0.2275, 0.6)
    }
  }

  private paintJudge(time: number): void {
    if (this.judgeAt < 0) {
      this.judge.style.visibility = 'hidden';
      this.judge.style.transform = '';
      return;
    }
    const age = time - this.judgeAt;
    if (age < 0 || age >= JUDGE_LIFE) {
      this.judge.style.visibility = 'hidden';
      this.judge.style.transform = '';
      this.judgeAt = -1;
      return;
    }
    this.judge.style.visibility = 'visible';
    // JudgementRectTween: u = min(age, 0.1)*10; scale = 0.5 + u - 0.5*u*u (0.5 → 1.0).
    const u = Math.min(age, JUDGE_TWEEN) * (1 / JUDGE_TWEEN);
    const scale = 0.5 + u - 0.5 * u * u;
    this.judge.style.transform = `scale(${scale})`;
  }


  private onComboAdvanced(prevCombo: number, time: number): void {
    if (shouldComboHundredFlash(prevCombo, this.combo)) {
      this.comboFlashAt = time;
      this.rebuildComboFlashDigits();
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
        this.spawnApRateBurst();
      } else {
        this.apRateFlashAt = -1;
        this.clearApRateBurst();
        if (this.apRateUpperEl) {
          this.apRateUpperEl.classList.remove('is-on');
          this.apRateUpperEl.style.opacity = '0';
          this.apRateUpperEl.style.transform = '';
        }
      }
      this.lastPaintedApRate = this.apRate;
    }
  }

  private rebuildComboFlashDigits(): void {
    if (!this.comboFlashDigits) return;
    // Mirror UpdateCombo slots: 4 fixed, [0]=units, row-reverse — same as paintCombo.
    let n = this.combo < 10 ? 0 : this.combo;
    this.comboFlashDigits.replaceChildren();
    for (let i = 0; i < COMBO_DIGIT_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'hud-cdigit';
      if (n > 0) {
        const d = n % 10;
        mountSprite(slot, `ui_sc2_ingame_num_combo_${d}`, String(d));
        n = Math.trunc(n * 0.1);
      } else {
        slot.hidden = true;
        mountSprite(slot, 'ui_sc2_ingame_num_combo_0', '0');
      }
      this.comboFlashDigits.append(slot);
    }
  }

  private paintComboEffect(time: number): void {
    const fx = this.comboFx;
    if (!fx) return;
    // 下层（SpriteRoot）：UpdateCombo 每次按掩码后的 combo（<10 视为 0）与 isApContinue 开关渲染器；
    //   粒子模拟不因渲染器关闭而停，只有 isRefreshLoop（位数变化）才 Stop+Play ⇒ 相位取 comboFxLowerAt。
    //   描边与底光同一次 withChildren 重启，共用相位。
    const lowerOn = this.enableApContinue && apContinueEffectVisible(this.combo, this.isApContinue);
    const lowerCombo = lowerOn ? this.combo : 0;
    const lowerAge = Math.max(0, time - this.comboFxLowerAt);
    // 粒子 scalingMode = Local：ComboRectTween 只把槽位展开，粒子本身不放大 ⇒ 子元素反向缩放。
    const invRect = 1 / this.comboRectScale;
    this.paintComboFxLayer(
      fx.lowerOutline, lowerCombo, this.comboRectTransform,
      comboEffectLowerAlpha(lowerAge) * COMBO_EFFECT_LOWER_START_A,
      () => invRect,
    );
    this.paintComboFxLayer(
      fx.lowerGlow, lowerCombo, this.comboRectTransform,
      comboGlowLowerCurve(lowerAge) * COMBO_GLOW_LOWER_ALPHA,
      () => invRect,
    );

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
    const rootT = upperCombo > 0 ? `scale(${rootS})` : '';
    this.paintComboFxLayer(
      fx.upperOutline, upperAge < COMBO_EFFECT_UPPER_LIFE ? upperCombo : 0, rootT,
      comboEffectUpperAlpha(upperAge) * COMBO_EFFECT_UPPER_START_A,
      (slot) => comboEffectUpperOutlineScale(slot, animAge) / rootS,
    );
    this.paintComboFxLayer(
      fx.upperGlow, upperCombo, rootT,
      comboGlowUpperCurve(upperAge) * COMBO_GLOW_UPPER_ALPHA,
      () => 1 / rootS,
    );
  }

  /**
   * 按 UpdateCombo 的槽位规则铺一层：[0]=个位，剩余值 m > 0 才打开该槽，m = trunc(m × 0.1)。
   * `opacity` 是**单颗**粒子的不透明度；同簇的加法副本各自带同一值，由 plus-lighter 叠加。
   */
  private paintComboFxLayer(
    layer: ComboFxLayer,
    combo: number,
    layerTransform: string,
    opacity: number,
    partScale: (slot: number) => number,
  ): void {
    const on = combo > 0;
    layer.el.hidden = !on;
    if (!on) return;
    layer.el.style.transform = layerTransform;
    const isGlow = layer.kind === 'glow';
    const op = String(opacity);
    let m = combo;
    for (let i = 0; i < layer.slots.length; i++) {
      const s = layer.slots[i];
      if (m <= 0) {
        s.el.hidden = true;
        continue;
      }
      const d = m % 10;
      s.el.hidden = false;
      if (!isGlow && s.digit !== d) {
        const b = comboEffectOutlineBox(d);
        const size = `${b.maskW}px ${b.maskH}px`;
        const pos = `${b.maskX}px 0px`;
        const img = b.image === 'digit1' ? COMBO_EFFECT_DIGIT1_MASK : '';
        for (const p of s.parts) {
          p.style.maskImage = img;
          p.style.webkitMaskImage = img;
          p.style.left = `${b.left}px`;
          p.style.top = `${b.top}px`;
          p.style.width = `${b.width}px`;
          p.style.height = `${b.height}px`;
          p.style.maskSize = size;
          p.style.webkitMaskSize = size;
          p.style.maskPosition = pos;
          p.style.webkitMaskPosition = pos;
        }
        s.digit = d;
      }
      const k = partScale(i);
      const tf = isGlow ? `translate(-50%,-50%) scale(${k})` : `scale(${k})`;
      for (const p of s.parts) {
        p.style.opacity = op;
        p.style.transform = tf;
      }
      m = Math.trunc(m * 0.1);
    }
  }

  private paintComboFlash(time: number): void {
    const el = this.comboFlashEl;
    if (!el) return;
    if (this.comboFlashAt < 0) {
      el.classList.remove('is-on');
      el.style.opacity = '0';
      return;
    }
    const age = time - this.comboFlashAt;
    if (age < 0 || age >= COMBO_FLASH_DURATION) {
      this.comboFlashAt = -1;
      el.classList.remove('is-on');
      el.style.opacity = '0';
      return;
    }
    const s = comboFlashScale(age);
    const a = comboFlashAlpha(age);
    el.classList.add('is-on');
    el.style.setProperty('--flash-s', String(s));
    el.style.setProperty('--flash-a', String(a));
    el.style.opacity = String(a);
    el.style.transform = `scale(${s})`;
  }

  private paintApRateFlash(time: number): void {
    const upper = this.apRateUpperEl;
    if (!upper) return;
    if (this.apRateFlashAt < 0) {
      upper.classList.remove('is-on');
      upper.style.opacity = '0';
      upper.style.transform = '';
      return;
    }
    const age = time - this.apRateFlashAt;
    if (age < 0 || age >= AP_RATE_FLASH_DURATION) {
      this.apRateFlashAt = -1;
      upper.classList.remove('is-on');
      upper.style.opacity = '0';
      upper.style.transform = '';
      return;
    }
    const s = apRateFlashScale(age);
    const a = apRateFlashAlpha(age);
    upper.classList.add('is-on');
    upper.style.opacity = String(a);
    upper.style.transform = `scale(${s})`;
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
        try { cb(ctx.getImageData(0, 0, c.width, c.height)); } catch { /* 无像素访问时跳过 */ }
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
    load('Default-Particle.png', (id) => {
      this.apRateCoreTex = { w: id.width, h: id.height, px: id.data };
    });
  }

  /**
   * APRateEffect — level56 `ComboRoot/APRateUpper/APRateEffect` #227 及三个子发射器。
   * 参数全部取原包序列化值（见 hudFxMath 的 AP_RATE_*）；1 世界单位 = 100 px。
   * 随机数用 `Math.random`，与 Unity 的 RNG 序列不同，只保证分布一致。
   */
  private spawnApRateBurst(): void {
    const host = this.apRateBurstEl;
    if (!host) return;
    host.replaceChildren();
    const mkCanvas = (cls: string, w: number, h: number, cssW: number, cssH: number) => {
      const c = document.createElement('canvas');
      c.className = cls;
      c.width = w;
      c.height = h;
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
      return c;
    };
    // sortingOrder −1：两层火花共用一张加色画布。
    const sparks = mkCanvas('burst-sparks',
      AP_RATE_SPARK_CANVAS.w * AP_RATE_SPARK_DPR, AP_RATE_SPARK_CANVAS.h * AP_RATE_SPARK_DPR,
      AP_RATE_SPARK_CANVAS.w, AP_RATE_SPARK_CANVAS.h);
    // sortingOrder +1：#227 Root（Additive）与 #41 Bg_core（Premultiply ⇒ 压暗层 + 加亮层）。
    const root = document.createElement('div');
    root.className = 'burst-root';
    root.style.width = `${AP_RATE_BURST_ROOT.w}px`;
    root.style.height = `${AP_RATE_BURST_ROOT.h}px`;
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = '/rg/fx/tex/APRate_OutlineEffect.png';
    root.append(img);
    const tw = this.apRateCoreTex?.w ?? 64, th = this.apRateCoreTex?.h ?? 64;
    const shade = mkCanvas('burst-core-shade', tw, th, AP_RATE_BURST_CORE.w, AP_RATE_BURST_CORE.h);
    const light = mkCanvas('burst-core-light', tw, th, AP_RATE_BURST_CORE.w, AP_RATE_BURST_CORE.h);
    host.append(sparks, root, shade, light);

    const list: ApRateSpark[] = [];
    for (const spec of [AP_RATE_PARTICLE, AP_RATE_CLOSS]) {
      // startDelay 是主模块属性：整个系统一次取值。
      const delay = lerpRange(spec.delay, Math.random());
      for (let i = 0; i < spec.count; i++) {
        const sp = apRateBurstSpawn(Math.random(), Math.random());
        const speed = lerpRange(spec.speed, Math.random()) * 100;
        list.push({
          tex: spec.tex,
          delay,
          x: sp.x * 100,
          y: sp.y * 100,
          vx: sp.dx * speed,
          vy: sp.dy * speed,
          life: lerpRange(spec.life, Math.random()),
          size: lerpRange(spec.size, Math.random()) * 100,
          spin: spec.spin ? lerpRange(spec.spin, Math.random()) : 0,
          colorRand: Math.random(),
          limit: lerpRange(spec.limit, Math.random()) * 100,
          dampen: spec.dampen,
        });
      }
    }
    this.apRateBurstSparks = list;
    this.apRateBurstLive = true;
  }

  /** 清空 APRateEffect 的节点（寿命结束、重播或换谱时调用）。 */
  private clearApRateBurst(): void {
    if (!this.apRateBurstLive && !this.apRateBurstSparks.length) return;
    this.apRateBurstLive = false;
    this.apRateBurstSparks = [];
    this.apRateBurstEl?.replaceChildren();
  }

  /** 逐帧驱动 APRateEffect；clip #94 在 t=1/60s 才 SetActive(true)。 */
  private paintApRateBurst(time: number): void {
    const host = this.apRateBurstEl;
    if (!host) return;
    if (this.apRateFlashAt < 0) {
      this.clearApRateBurst();
      return;
    }
    const age = time - this.apRateFlashAt - AP_RATE_BURST_ACTIVATE_DELAY;
    if (age < 0) return; // 延迟窗口内尚未激活
    if (age >= AP_RATE_BURST_DURATION) {
      this.clearApRateBurst();
      return;
    }
    // Root / Bg_core 共用尺寸曲线，从中心放大。
    const s = apRateBurstScale(age);
    const root = host.querySelector<HTMLElement>('.burst-root');
    if (root) {
      root.style.opacity = String(apRateBurstRootAlpha(age));
      root.style.transform = `translate(-50%,-50%) scale(${s})`;
    }
    const shade = host.querySelector<HTMLCanvasElement>('.burst-core-shade');
    const light = host.querySelector<HTMLCanvasElement>('.burst-core-light');
    if (shade && light) this.paintApRateCore(shade, light, age, s);
    const canvas = host.querySelector<HTMLCanvasElement>('.burst-sparks');
    if (canvas) this.paintApRateSparks(canvas, age);
  }

  /**
   * #41 Bg_core：`Legacy Shaders/Particles/Alpha Blended Premultiply`
   * （`Blend One OneMinusSrcAlpha`，片元 = `col × tex × col.a`）。
   * 帧缓冲结果 `P + dst·(1 − A)`，其中 `P = col.rgb·tex.rgb·col.a`、`A = col.a²·tex.a`；
   * 拆成压暗层 `(0,0,0,A)`（普通合成）与加亮层 `P`（plus-lighter）两张画布。
   */
  private paintApRateCore(shade: HTMLCanvasElement, light: HTMLCanvasElement, age: number, s: number): void {
    const tex = this.apRateCoreTex;
    const sctx = shade.getContext('2d');
    const lctx = light.getContext('2d');
    if (!tex || !sctx || !lctx) return;
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
    const tf = `translate(-50%,-50%) scale(${s})`;
    shade.style.transform = tf;
    light.style.transform = tf;
  }

  /**
   * #229 Particle / #228 ClossParticle：`Mobile/Particles/Additive`（`Blend SrcAlpha One`，
   * 片元 = `tex × col`）。每颗按 R/G/B 单通道图以 `col.c × col.a` 为 globalAlpha 叠加。
   */
  private paintApRateSparks(canvas: HTMLCanvasElement, age: number): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
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

  /**
   * ComboRectTween 的缩放：数字行直接缩放；AP 継続下层同步展开槽位，
   * 粒子尺寸不随之放大（scalingMode = Local），由 paintComboEffect 反向缩放子元素。
   */
  private applyComboScale(scale: number | null): void {
    const t = scale === null ? '' : `scale(${scale})`;
    this.comboRow.style.transform = t;
    this.comboRectTransform = t;
    this.comboRectScale = scale === null ? 1 : scale;
  }

  private paintComboBounce(time: number): void {
    if (this.comboBounceAt < 0) {
      this.applyComboScale(null);
      return;
    }
    const age = time - this.comboBounceAt;
    if (age < 0 || age >= COMBO_TWEEN) {
      this.applyComboScale(null);
      this.comboBounceAt = -1;
      return;
    }
    // ComboRectTween: scale = 0.8 + 0.4*u - 0.2*u*u (0.8 → 1.0).
    const u = Math.min(age, COMBO_TWEEN) * (1 / COMBO_TWEEN);
    const scale = 0.8 + 0.4 * u - 0.2 * u * u;
    // 描边层在原包里是数字槽的子节点，会跟着 ComboRectTween 一起缩放；
    // 这里是兄弟节点，必须显式同步，否则弹跳期间会与数字错开。
    this.applyComboScale(scale);
  }

  private buildScore(safe: HTMLElement): void {
    const root = document.createElement('div');
    root.className = 'hud-score';
    const label = document.createElement('div');
    label.className = 'hud-score-label';
    mountOutlinedText(label, 'SCORE');
    place(label, 512, 160, 0.5, 0.5, 0.5, 0.5, -80, 20, 120, 40);
    const strip = document.createElement('div');
    strip.className = 'hud-score-strip';
    place(strip, 512, 160, 0.5, 0.5, 0.5, 0.5, 45.8, -47, 300, 40);
    // Clear()/UpdateScore(0): all twelve digits = num_score_11, commas = num_score_12. No opacity dimming.
    const score = 0;
    this.scoreDigits.length = 0;
    this.scoreCommas.length = 0;
    for (let i = 0; i < SCORE_DIGIT_X.length; i++) {
      const slot = document.createElement('div');
      slot.className = 'hud-sdigit';
      place(slot, 300, 40, 0.5, 0.5, 0.5, 0.5, SCORE_DIGIT_X[i], 0, 32, 40);
      mountSprite(slot, scoreDigitSprite(score, i), '0');
      this.scoreDigits.push(slot);
      strip.append(slot);
    }
    for (let i = 0; i < SCORE_COMMA_X.length; i++) {
      const slot = document.createElement('div');
      slot.className = 'hud-scomma';
      place(slot, 300, 40, 0.5, 0.5, 0.5, 0.5, SCORE_COMMA_X[i], 0, 32, 40);
      mountSprite(slot, scoreCommaSprite(score, i), ',');
      this.scoreCommas.push(slot);
      strip.append(slot);
    }
    this.buildGauge(root);
    this.buildRankLabels(root);
    this.buildRankRoot(root);
    const addScore = document.createElement('div');
    addScore.className = 'hud-add-score';
    // level56 AddScore (305.8,−52) 200×40 pivot .5; TMP 24 left align charSpacing 4 IngameScorePink.
    place(addScore, 512, 160, 0.5, 0.5, 0.5, 0.5, 305.8, -52, 200, 40);
    mountOutlinedText(addScore, '+0');
    addScore.style.visibility = 'hidden';
    addScore.style.opacity = '0';
    this.addScoreEl = addScore;
    root.append(label, addScore, strip);
    safe.append(root);
  }

  private buildGauge(scoreRoot: HTMLElement): void {
    const gauge = document.createElement('div');
    gauge.className = 'hud-gauge';
    place(gauge, 512, 160, 0.5, 0.5, 0.5, 0.5, 34, -12, 400, 48);
    const slider = document.createElement('div');
    slider.className = 'hud-gauge-slider';
    place(slider, 400, 48, 0.5, 0.5, 0.5, 0.5, 15, 0, 330, 16);
    const fill = document.createElement('div');
    fill.className = 'hud-gauge-fill';
    // score 0 ⇒ fill 0 (Clear). Live width from scoreGaugeFill piecewise map.
    fill.style.width = '0%';
    this.gaugeFillEl = fill;
    slider.append(fill);
    gauge.append(slider);
    scoreRoot.append(gauge);
  }

  private buildRankLabels(scoreRoot: HTMLElement): void {
    // Dump RankLabels xs (level56); ~2px off pure fill-knot math — keep dump.
    const xs = [17, 76, 137, 183];
    const letters = ['C', 'B', 'A', 'S'];
    for (let i = 0; i < xs.length; i++) {
      const line = document.createElement('div');
      line.className = 'hud-rank-line';
      place(line, 512, 160, 0.5, 0.5, 0.5, 0.5, xs[i], -5, 4, 30);
      const letter = document.createElement('div');
      letter.className = 'hud-rank-letter';
      mountOutlinedText(letter, letters[i]);
      place(letter, 512, 160, 0.5, 0.5, 0.5, 0.5, xs[i], 16, 60, 40);
      scoreRoot.append(line, letter);
    }
  }

  private buildRankRoot(scoreRoot: HTMLElement): void {
    // RankRoot: rank_base 110x121 @ (-170,-13).
    // ScoreRankIcon 156x181 scale .55: rim button_rank RGB(155,145,174) a.8
    //   -> White(-6) -> Gray(-6) / RankColor(-6) -> Shine a.2, Deco01/02 a.8, RankName EB 80.
    // SetRankNotActive: RankColor off -> gray only (no letter). Preview via setRank().
    const root = document.createElement('div');
    root.className = 'hud-rank';
    place(root, 512, 160, 0.5, 0.5, 0.5, 0.5, -170, -13, 110, 121);
    mountSprite(root, 'ui_sc2_ingame_rank_base', '');

    const icon = document.createElement('div');
    icon.className = 'hud-rank-icon';
    place(icon, 110, 121, 0.5, 0.5, 0.5, 0.5, 0, 0, 156, 181);
    icon.style.transform = 'scale(0.55)';

    const rim = document.createElement('div');
    rim.className = 'hud-rank-rim';
    rim.style.cssText = 'position:absolute;inset:0';
    mountSprite(rim, 'ui_sc2_button_rank', '');

    // White sizeDelta -6 on 156x181 -> inset 3px -> 150x175.
    const white = document.createElement('div');
    white.className = 'hud-rank-white';
    white.style.cssText = 'position:absolute;inset:3px';
    mountSprite(white, 'ui_sc2_button_rank', '');

    // Gray / RankColor sizeDelta -6 on White -> inset 3px -> 144x169.
    const gray = document.createElement('div');
    gray.className = 'hud-rank-fill hud-rank-gray';
    gray.style.cssText = 'position:absolute;inset:3px';
    mountSprite(gray, 'ui_sc2_button_rank', '');
    this.rankGrayEl = gray;

    const color = document.createElement('div');
    color.className = 'hud-rank-fill hud-rank-color';
    color.style.cssText = 'position:absolute;inset:3px';
    color.hidden = true; // SetRankNotActive
    mountSprite(color, 'ui_sc2_button_rank', '');
    this.rankColorEl = color;

    const colorW = 144;
    const colorH = 169;

    const shine = document.createElement('div');
    shine.className = 'hud-rank-shine';
    place(shine, colorW, colorH, 1, 0, 1, 0, 1, 1, 145, 126);
    mountSprite(shine, 'ui_sc2_button_rank_shine', '');

    const deco1 = document.createElement('div');
    deco1.className = 'hud-rank-deco';
    place(deco1, colorW, colorH, 0.5, 0.5, 0.5, 0.5, -21.5, 51, 103, 69);
    mountSprite(deco1, 'ui_sc2_button_rank_deco_01', '');

    const deco2 = document.createElement('div');
    deco2.className = 'hud-rank-deco';
    place(deco2, colorW, colorH, 0.5, 0.5, 0.5, 0.5, 52, -36, 41, 57);
    mountSprite(deco2, 'ui_sc2_button_rank_deco_02', '');

    const name = document.createElement('div');
    name.className = 'hud-rank-name';
    place(name, colorW, colorH, 0.5, 0.5, 0.5, 0.5, 0, 2, 120, 120);
    name.textContent = '';
    this.rankNameEl = name;

    color.append(shine, deco1, deco2, name);
    white.append(gray, color);
    icon.append(rim, white);
    root.append(icon);
    scoreRoot.append(root);
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
    const color = this.rankColorEl;
    const name = this.rankNameEl;
    if (!color || !name) return;
    if (rank === 'none') {
      color.hidden = true;
      name.textContent = '';
      color.style.background = '';
      return;
    }
    color.hidden = false;
    name.textContent = rank;
    const tints: Record<string, string> = {
      D: 'rgb(133,150,208)',
      C: 'rgb(54,215,225)',
      B: 'rgb(30,196,167)',
      A: 'rgb(253,91,145)',
      S: 'linear-gradient(90deg,rgb(177,147,203),rgb(96,228,222))',
    };
    color.style.background = tints[rank] ?? '';
  }


  private buildPause(safe: HTMLElement): void {
    // SafeArea aMin/aMax (1,1), pivot (0.5,0.5), pos (−100,−90), 120×120.
    // Pattern sprites live under SelectUI: shine α.349, dot α.298 (ColorImage is Mask).
    const root = document.createElement('div');
    root.className = 'hud-pause';
    const bg = document.createElement('div');
    bg.className = 'hud-pause-bg';
    const face = document.createElement('div');
    face.className = 'hud-pause-face';
    const color = document.createElement('div');
    color.className = 'hud-pause-color';
    // ColorImage content size after sizeDelta −16 on 120 → 104×104.
    const shine = document.createElement('div');
    shine.className = 'hud-pause-pattern is-shine';
    place(shine, 104, 104, 0.5, 1, 0.5, 1, 2.6, 2.8865, 184.6514, 54.887);
    mountSprite(shine, 'ui_sc2_button_shine', '');
    const dot = document.createElement('div');
    dot.className = 'hud-pause-pattern is-dot';
    place(dot, 104, 104, 1, 0, 1, 0, 26.8076, -18.4075, 157.6151, 157.6151);
    mountSprite(dot, 'ui_sc2_button_dot', '');
    const icon = document.createElement('div');
    icon.className = 'hud-pause-icon';
    for (let i = 0; i < 2; i++) {
      const bar = document.createElement('div');
      bar.className = 'hud-pause-bar';
      const inner = document.createElement('div');
      inner.className = 'hud-pause-bar-inner';
      bar.append(inner);
      icon.append(bar);
    }
    color.append(shine, dot, icon);
    face.append(color);
    bg.append(face);
    root.append(bg);
    safe.append(root);
  }

  private buildTechnicalScore(safe: HTMLElement): HTMLElement {
    // SafeArea (1,1)/(1,1) pos (−56,−158) 394×80. Gated by setTechnicalScoreVisible (TechnicalScoreDisplay).
    const root = document.createElement('div');
    root.className = 'hud-tech';
    root.hidden = true;
    const label = document.createElement('div');
    label.className = 'hud-tech-label';
    mountOutlinedText(label, 'TECHNICAL<br>SCORE', true);
    const value = document.createElement('div');
    value.className = 'hud-tech-value';
    const formatted = formatTechnicalScore(0);
    value.innerHTML = `<span class="is-big">${formatted.whole}</span><span class="is-small">${formatted.frac}</span>`;
    root.append(label, value);
    safe.append(root);
    return root;
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
    this.repositionJudge();
    // Condition 与判定字同档时贴在判定字上方（OverlapOffsetY），故一并重排。
    this.repositionCondition();
  }

  setFastSlowY(opt: number): void {
    this.fastSlowYOpt = opt;
    this.repositionCondition();
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

  private repositionJudge(): void {
    const y = judgementLayoutY(this.judgementYOpt);
    if (this.judge) {
      const w = this.judge.style.width ? parseFloat(this.judge.style.width) : 340;
      place(this.judge, 400, 400, 0.5, 0.5, 0.5, 0.5, 0, y, Number.isFinite(w) ? w : 340, 80);
    }
    if (this.judgePop) {
      place(this.judgePop, 400, 400, 0.5, 0.5, 0.5, 0.5, 0, y, 340, 80);
    }
  }

  private repositionCondition(): void {
    if (!this.conditionEl) return;
    const y = fastSlowLayoutY(this.judgementYOpt, this.fastSlowYOpt);
    place(this.conditionEl, 400, 400, 0.5, 0.5, 0.5, 0.5, 0, y, 180, 64);
  }

  private applyConditionSprite(condition: NoteConditionType): void {
    if (!this.conditionEl) return;
    const spr = conditionSprite(condition);
    if (!spr) {
      this.conditionEl.style.visibility = 'hidden';
      return;
    }
    // 原地换图：每次判定都 mountSprite 会不断追加 <img>，多个 SLOW 纵向叠成一串。
    setSprite(this.conditionEl, spr.name, spr.fallback);
  }

  private paintCondition(time: number): void {
    if (!this.conditionEl) return;
    if (this.conditionAt < 0) {
      this.conditionEl.style.visibility = 'hidden';
      this.conditionEl.style.transform = '';
      return;
    }
    const age = time - this.conditionAt;
    if (age < 0 || age >= JUDGE_LIFE) {
      this.conditionEl.style.visibility = 'hidden';
      this.conditionEl.style.transform = '';
      this.conditionAt = -1;
      return;
    }
    this.conditionEl.style.visibility = 'visible';
    // Same JudgementRectTween as Judge (0.5 → 1.0 over 0.1 s).
    const u = Math.min(age, JUDGE_TWEEN) * (1 / JUDGE_TWEEN);
    const scale = 0.5 + u - 0.5 * u * u;
    this.conditionEl.style.transform = `scale(${scale})`;
  }



  getFastSlowThreshold(): FastSlowOption {
    return this.fastSlowThreshold;
  }

  private applyJudgeSprite(type: NoteJudgementType): void {
    this.lastJudgeType = type;
    const { name, fallback } = judgementSprite(type, this.enablePerfectPlus);
    while (this.judge.firstChild) this.judge.removeChild(this.judge.firstChild);
    const w = name.includes('perfect_plus') ? 386 : 340;
    this.judge.style.width = `${w}px`;
    place(this.judge, 400, 400, 0.5, 0.5, 0.5, 0.5, 0, judgementLayoutY(this.judgementYOpt), w, 80);
    mountSprite(this.judge, name, fallback);
  }


  private paintScore(): void {
    const score = this.scoreEngine.score;
    for (let i = 0; i < this.scoreDigits.length; i++) {
      setSprite(this.scoreDigits[i], scoreDigitSprite(score, i), '0');
    }
    for (let i = 0; i < this.scoreCommas.length; i++) {
      setSprite(this.scoreCommas[i], scoreCommaSprite(score, i), ',');
    }
  }

  /** ScoreResolver Add → scoreAddText "+"N + ScoreAddTween @0x486177C. */
  private triggerAddScore(delta: number, time: number): void {
    const el = this.addScoreEl;
    if (!el || delta <= 0) return;
    const text = `+${delta}`;
    const ol = el.querySelector('.hud-ol');
    const face = el.querySelector('.hud-face');
    if (ol) ol.textContent = text;
    if (face) face.textContent = text;
    this.addScoreAt = time;
    el.style.visibility = 'visible';
  }

  private paintAddScore(time: number): void {
    const el = this.addScoreEl;
    if (!el) return;
    if (this.addScoreAt < 0) {
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
      el.style.transform = '';
      return;
    }
    const age = time - this.addScoreAt;
    // Process: tween while active; hide when scoreAddHideTime < t (life 0.7).
    if (age < 0 || age >= SCORE_ADD_LIFE) {
      this.addScoreAt = -1;
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
      el.style.transform = '';
      return;
    }
    const x = scoreAddTweenX(age);
    const alpha = scoreAddTweenAlpha(age);
    el.style.visibility = 'visible';
    el.style.opacity = String(alpha);
    el.style.transform = `translate(${x - SCORE_ADD_REST_X}px, 0)`;
  }

  private paintGauge(): void {
    if (!this.gaugeFillEl) return;
    const fill = this.scoreEngine.gaugeFill();
    this.gaugeFillEl.style.width = `${Math.max(0, Math.min(1, fill)) * 100}%`;
  }

  private buildJudge(safe: HTMLElement): HTMLElement {
    const root = document.createElement('div');
    root.className = 'hud-judge';
    const pop = document.createElement('div');
    pop.className = 'hud-perfect';
    // level56 Judge prefab (0, -270) + JudgementY×70 (ScoreResolver.Inject) ⇒ default 5 → (0, +80).
    // Sprite size: perfect 340x80 / perfect_plus 386x80.
    this.judgePop = pop;
    place(pop, 400, 400, 0.5, 0.5, 0.5, 0.5, 0, judgementLayoutY(this.judgementYOpt), 340, 80);
    mountSprite(pop, 'ui_sc2_ingame_hantei_perfect', 'PERFECT');
    pop.style.visibility = 'hidden';
    // JudgeRoot/Condition prefab (0, -210) 180×64; +FastSlowY×70 (or judge+60 when same step) ⇒ default (0, +140).
    // Gated by FastSlowThreshold.
    const cond = document.createElement('div');
    cond.className = 'hud-condition';
    this.conditionEl = cond;
    place(cond, 400, 400, 0.5, 0.5, 0.5, 0.5, 0, fastSlowLayoutY(this.judgementYOpt, this.fastSlowYOpt), 180, 64);
    mountSprite(cond, 'ui_sc2_ingame_hantei_slow', 'SLOW');
    cond.style.visibility = 'hidden';
    root.append(pop, cond);
    safe.append(root);
    return pop;
  }

  private buildCombo(safe: HTMLElement): {
    row: HTMLElement;
    label: HTMLElement;
    apRate: HTMLElement;
    apRateValue: HTMLElement;
  } {
    const root = document.createElement('div');
    root.className = 'hud-combo';
    const row = document.createElement('div');
    row.className = 'hud-combo-digits';
    // SpriteRoot / SpriteUpperRoot 的 anchoredPosition.x = −44（Label/APRate 才是 −40）。
    place(row, 400, 320, 0.5, 0.5, 0.5, 0.5, -44, 54, 360, 120);
    this.comboDigits.length = 0;
    for (let i = 0; i < COMBO_DIGIT_SLOTS; i++) {
      const slot = document.createElement('div');
      // Prefab sizeDelta 90×120; HLG spacing −13. Slot [0]=units (row-reverse ⇒ rightmost).
      slot.className = 'hud-cdigit';
      slot.hidden = true;
      mountSprite(slot, 'ui_sc2_ingame_num_combo_0', '0');
      this.comboDigits.push(slot);
      row.append(slot);
    }
    const label = document.createElement('div');
    label.className = 'hud-combo-label';
    place(label, 400, 320, 0.5, 0.5, 0.5, 0.5, -40, -30, 244, 65);
    mountSprite(label, 'ui_sc2_ingame_combo', 'COMBO');
    label.hidden = true;
    const apRate = document.createElement('div');
    apRate.className = 'hud-aprate';
    place(apRate, 400, 320, 0.5, 0.5, 0.5, 0.5, -40, -84, 240, 40);
    apRate.hidden = true;
    const apRateValue = document.createElement('div');
    apRateValue.className = 'hud-aprate-value';
    apRate.append(apRateValue);
    // APRateUpper: flash copy (scale+fade); base badge stays opaque (PLAN §46).
    const apRateUpper = document.createElement('div');
    apRateUpper.className = 'hud-aprate-upper';
    place(apRateUpper, 400, 320, 0.5, 0.5, 0.5, 0.5, -40, -84, 240, 40);
    apRateUpper.style.opacity = '0';
    const apRateUpperValue = document.createElement('div');
    apRateUpperValue.className = 'hud-aprate-value';
    apRateUpper.append(apRateUpperValue);
    this.apRateUpperEl = apRateUpper;
    // Flash overlay sits on the same rect as SpriteRoot (not whole ComboRoot),
    // so ComboAnimation scale grows from the digit center — avoids left drift.
    const flash = document.createElement('div');
    flash.className = 'hud-combo-flash';
    flash.style.opacity = '0';
    place(flash, 400, 320, 0.5, 0.5, 0.5, 0.5, -44, 54, 360, 120);
    const flashDigits = document.createElement('div');
    flashDigits.className = 'hud-combo-flash-digits';
    flash.append(flashDigits);
    const burst = document.createElement('div');
    burst.className = 'hud-aprate-burst';
    place(burst, 400, 320, 0.5, 0.5, 0.5, 0.5, -40, -84, 280, 280);
    // AP 継続特效四层：与 SpriteRoot / SpriteUpperRoot 同矩形（360×120 @ -44,54），
    // 槽位与 .hud-combo-digits 一致（row-reverse + −13 间距）。每槽的子元素是同簇粒子副本。
    const mkFxLayer = (cls: string, kind: 'outline' | 'glow', parts: number): ComboFxLayer => {
      const el = document.createElement('div');
      el.className = `hud-combo-fx ${cls}`;
      el.hidden = true;
      place(el, 400, 320, 0.5, 0.5, 0.5, 0.5, -44, 54, 360, 120);
      const slots: ComboFxLayer['slots'] = [];
      for (let i = 0; i < COMBO_DIGIT_SLOTS; i++) {
        const slot = document.createElement('div');
        slot.className = 'hud-combo-fx-slot';
        slot.hidden = true;
        const ps: HTMLElement[] = [];
        for (let k = 0; k < parts; k++) {
          const p = document.createElement('div');
          p.className = kind === 'outline' ? 'hud-combo-fx-outline' : 'hud-combo-fx-glow';
          slot.append(p);
          ps.push(p);
        }
        el.append(slot);
        slots.push({ el: slot, parts: ps, digit: -1 });
      }
      return { el, kind, slots };
    };
    const fx: Record<ComboFxLayerKey, ComboFxLayer> = {
      // 描边：加法混合，4 / 5 颗同位粒子 ⇒ 4 / 5 个 plus-lighter 副本。
      lowerOutline: mkFxLayer('is-lower-outline', 'outline', COMBO_EFFECT_LOWER_BURST),
      upperOutline: mkFxLayer('is-upper-outline', 'outline', COMBO_EFFECT_UPPER_BURST),
      // 下层底光：Alpha 混合的 2 颗同位粒子 ⇒ 2 个普通合成的副本（逐像素 1 − (1 − a)²）。
      lowerGlow: mkFxLayer('is-lower-glow', 'glow', COMBO_GLOW_BURST),
      // 上层底光：加法混合 2 颗 ⇒ 2 个 plus-lighter 副本。
      upperGlow: mkFxLayer('is-upper-glow', 'glow', COMBO_GLOW_BURST),
    };
    root.append(
      fx.upperGlow.el, row, label, apRate, apRateUpper, flash,
      fx.lowerOutline.el, fx.upperOutline.el, fx.lowerGlow.el, burst,
    );
    this.comboFlashEl = flash;
    this.comboFlashDigits = flashDigits;
    this.comboFx = fx;
    this.apRateBurstEl = burst;
    this.loadApRateTextures();
    safe.append(root);
    return { row, label, apRate, apRateValue };
  }

  private buildAp(safe: HTMLElement): void {
    const root = document.createElement('div');
    root.className = 'hud-ap';
    // Gauges are children of the 138 bases (pos 0,0), not siblings of APVoltageRoot.
    // Value/upper nest inside the disc so TMP stays centered on the ring (level56 same anchor).
    const meter = (
      base: string,
      gage: string,
      x: number,
      valueClass: string,
      upperClass: string,
    ): { fill: HTMLElement; value: HTMLElement; upper: HTMLElement } => {
      const slot = document.createElement('div');
      slot.className = 'hud-disc';
      place(slot, 320, 160, 0.5, 0.5, 0.5, 0.5, x, -8, 138, 138);
      mountSprite(slot, base, '');
      const ring = document.createElement('div');
      ring.className = 'hud-base02';
      place(ring, 138, 138, 0.5, 0.5, 0.5, 0.5, 0, 0, 94, 94);
      mountSprite(ring, 'ui_sc2_ingame_gage_base_02', '');
      const fill = document.createElement('div');
      fill.className = 'hud-gage';
      place(fill, 138, 138, 0.5, 0.5, 0.5, 0.5, 0, 0, 90, 90);
      // level56: Filled Radial360, fillOrigin Top, fillClockwise=false; CSS conic from 0deg (=top).
      mountSprite(fill, gage, '');
      fill.style.setProperty('--fill', '0');
      const value = document.createElement('div');
      value.className = valueClass;
      mountOutlinedText(value, '0');
      // level56 APValue/VoltageValue (0,0) relative to EffectBase stretch; disc-local center.
      // Optical baseline nudge (+Y) so Rodin digits sit centered in the ring.
      place(value, 138, 138, 0.5, 0.5, 0.5, 0.5, 0, 2, 80, 40);
      const upper = document.createElement('div');
      upper.className = upperClass;
      mountOutlinedText(upper, '0');
      place(upper, 138, 138, 0.5, 0.5, 0.5, 0.5, 0, 2, 80, 40);
      upper.style.opacity = '0';
      slot.append(ring, fill, value, upper);
      root.append(slot);
      return { fill, value, upper };
    };
    const ap = meter(
      'ui_sc2_ingame_ap_base',
      'ui_sc2_ingame_gage_ap',
      -60,
      'hud-ap-value is-ap',
      'hud-ap-value-upper is-ap',
    );
    const vo = meter(
      'ui_sc2_ingame_voltage_base',
      'ui_sc2_ingame_gage_voltage',
      80,
      'hud-ap-value is-vo',
      'hud-ap-value-upper is-vo',
    );
    this.apGageEl = ap.fill;
    this.voltageGageEl = vo.fill;
    this.apValueEl = ap.value;
    this.voltageValueEl = vo.value;
    this.apValueUpperEl = ap.upper;
    this.voltageValueUpperEl = vo.upper;
    const label = (text: string, x: number, y: number, w: number, className: string) => {
      const node = document.createElement('div');
      node.className = className;
      mountOutlinedText(node, text);
      place(node, 320, 160, 0.5, 0.5, 0.5, 0.5, x, y, w, 40);
      root.append(node);
      return node;
    };
    label('AP', -60, 53, 80, 'hud-ap-label is-ap');
    label('VOLTAGE', 80, 53, 120, 'hud-ap-label is-vo');
    safe.append(root);
  }

  private paintApVoltage(): void {
    const setOutlined = (host: HTMLElement | null, text: string) => {
      if (!host) return;
      const ol = host.querySelector('.hud-ol');
      const face = host.querySelector('.hud-face');
      if (ol) ol.textContent = text;
      if (face) face.textContent = text;
      if (!ol && !face) host.textContent = text;
    };
    const apInt = this.scoreEngine.apDisplayValue;
    const voInt = this.scoreEngine.voltageLevel;
    setOutlined(this.apValueEl, String(apInt));
    setOutlined(this.voltageValueEl, String(voInt));
    // ParamViewResolver.UpdateAp/UpdateVoltage: value change → upper SetCharArray +
    // Animator.CrossFade + JudgementRectTween(baseRect, 0.1s). Not ComboRectTween.
    if (this.lastApDisplay >= 0 && apInt !== this.lastApDisplay) {
      setOutlined(this.apValueUpperEl, String(apInt));
      this.apValuePopAt = this.previousTime;
      this.apValueFlashAt = this.previousTime;
    }
    if (this.lastVoltageDisplay >= 0 && voInt !== this.lastVoltageDisplay) {
      setOutlined(this.voltageValueUpperEl, String(voInt));
      this.voltageValuePopAt = this.previousTime;
      this.voltageValueFlashAt = this.previousTime;
    }
    this.lastApDisplay = apInt;
    this.lastVoltageDisplay = voInt;
    const apFill = this.scoreEngine.apGauge;
    const voFill = this.scoreEngine.voltageGauge;
    if (this.apGageEl) {
      this.apGageEl.style.setProperty('--fill', String(apFill));
      this.apGageEl.classList.toggle('is-empty', apFill <= 0);
      this.apGageEl.dataset.fill = apFill <= 0 ? '0' : '1';
    }
    if (this.voltageGageEl) {
      this.voltageGageEl.style.setProperty('--fill', String(voFill));
      this.voltageGageEl.classList.toggle('is-empty', voFill <= 0);
      this.voltageGageEl.dataset.fill = voFill <= 0 ? '0' : '1';
    }
  }

  /**
   * ParamViewResolver.Process: JudgementRectTween on base AP/Voltage value rect (0.5→1 / 0.1s);
   * APEffectBase→ApGageIncreaseAnimation / VoltageEffectBase→VoltageIncreaseAnimation (0.6s).
   */
  private paintApVoltageFx(time: number): void {
    const popBase = (el: HTMLElement | null, at: number, clear: () => void) => {
      if (!el) return;
      if (at < 0) {
        el.style.transform = '';
        return;
      }
      const age = time - at;
      if (age < 0 || age >= JUDGE_TWEEN) {
        el.style.transform = '';
        clear();
        return;
      }
      // JudgementRectTween: u=min(age,0.1)*10; scale=0.5+u-0.5*u*u
      const u = Math.min(age, JUDGE_TWEEN) * (1 / JUDGE_TWEEN);
      const scale = 0.5 + u - 0.5 * u * u;
      el.style.transform = `scale(${0.92 * scale})`;
    };
    popBase(this.apValueEl, this.apValuePopAt, () => { this.apValuePopAt = -1; });
    popBase(this.voltageValueEl, this.voltageValuePopAt, () => { this.voltageValuePopAt = -1; });

    const flashUpper = (el: HTMLElement | null, at: number, clear: () => void) => {
      if (!el) return;
      if (at < 0) {
        el.classList.remove('is-on');
        el.style.opacity = '0';
        el.style.transform = '';
        return;
      }
      const age = time - at;
      if (age < 0 || age >= AP_GAGE_FLASH_DURATION) {
        clear();
        el.classList.remove('is-on');
        el.style.opacity = '0';
        el.style.transform = '';
        return;
      }
      // ApGageIncreaseAnimation / VoltageIncreaseAnimation @ sharedassets56.
      const s = apGageFlashScale(age);
      const a = apGageFlashAlpha(age);
      el.classList.add('is-on');
      el.style.opacity = String(a);
      el.style.transform = `scale(${0.92 * s})`;
    };
    flashUpper(this.apValueUpperEl, this.apValueFlashAt, () => { this.apValueFlashAt = -1; });
    flashUpper(this.voltageValueUpperEl, this.voltageValueFlashAt, () => { this.voltageValueFlashAt = -1; });
  }

  private buildMental(safe: HTMLElement): void {
    const root = document.createElement('div');
    root.className = 'hud-mental';
    const text = (content: string, className: string, x: number, w: number) => {
      const node = document.createElement('div');
      node.className = className;
      if (className.includes('hud-mental-label')) mountOutlinedText(node, content);
      else node.textContent = content;
      place(node, 400, 80, 0.5, 0.5, 0.5, 0.5, x, 16, w, 40);
      root.append(node);
    };
    // MentalResolver ctor: value = maxValue = TotalMental (full HP). Preview is forever-alive
    // (no Bad/Miss drain); preview default TotalMental 1000 as the chrome figure.
    const full = 1000;
    text('MENTAL', 'hud-mental-label', -108, 120);
    text(String(full), 'hud-mental-now', -16, 88);
    text('/', 'hud-mental-sep', 41, 32);
    text(String(full), 'hud-mental-max', 80, 80);
    const track = document.createElement('div');
    track.className = 'hud-mental-track';
    place(track, 400, 80, 0.5, 0.5, 0, 0.5, -160, -16, 280, 16);
    const fill = document.createElement('div');
    fill.className = 'hud-mental-fill';
    fill.style.width = '100%';
    track.append(fill);
    root.append(track);
    safe.append(root);
  }
}
