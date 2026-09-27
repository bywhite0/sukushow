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
  apRateBurstCoreAlpha,
  apRateBurstParticleScale,
  apRateBurstParticleAlpha,
  apRateBurstTravel,
  AP_RATE_BURST_DURATION,
  AP_RATE_BURST_ACTIVATE_DELAY,
  AP_RATE_BURST_ROOT,
  AP_RATE_BURST_CORE,
  AP_RATE_BURST_RING,
  AP_RATE_BURST_RING_INNER,
  AP_RATE_BURST_ROOT_GAIN,
  AP_RATE_BURST_CORE_ALPHA_GAIN,
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
  SCORE_ADD_X_NUDGE,
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
  img.src = url;
  if (img.complete && img.naturalWidth > 0) onLoad();
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
  /** APRateEffect 的贴图火花（贴图近似，非 GPU 粒子）。 */
  private apRateBurstSparks: {
    el: HTMLElement; ax: number; ay: number; vx: number; vy: number;
    life: number; delay: number; spin: number;
    /** 限速上限（px/s）与阻尼：原包 LimitVelocityOverLifetime 的 magnitude / dampen。 */
    limit: number; dampen: number;
  }[] = [];
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

  sync(chart: Chart, time: number): void {
    if (!Number.isFinite(time)) return;
    if (chart !== this.chart) {
      this.chart = chart;
      this.seHashes = buildLineHashTables(chart);
      this.se?.clear();
      this.resetLive(time);
      this.scoreEngine.setFever(isFeverAt(time, this.feverWindow));
      return;
    }
    const previousTime = this.previousTime;
    this.previousTime = time;
    this.scoreEngine.setFever(isFeverAt(time, this.feverWindow));
    if (time < previousTime) {
      this.resetLive(time);
      this.se?.clear();
      return;
    }
    if (time - previousTime < SEEK_GAP) {
      this.se?.process();
      const hits = countHeads(chart, previousTime, time);
      const jType = autoPlayJudgementType(this.enablePerfectPlus);
      if (hits > 0) {
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
      if (this.se) {
        const seHits = collectAutoPlaySeHits(chart, previousTime, time, this.seHashes);
        dispatchAutoPlaySe(this.se, seHits, jType, countActiveHolds(chart, time));
        this.se.applyHold();
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
    if (this.chart) this.scoreEngine.reset(this.chart);
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
   * PLAN §47 APRateEffect — level56 `ComboRoot/APRateUpper/APRateEffect` #227。
   * 主体是粉色四角星粒子从徽章周围爆发，两层大面积贴图只是垫在后面的底光。
   * 尺寸/速度/限速均取原包序列化值；1 世界单位 = 100 px（CanvasScaler
   * `m_ReferencePixelsPerUnit=100` + 参考分辨率 1920×1080）。
   */
  private spawnApRateBurst(): void {
    const host = this.apRateBurstEl;
    if (!host) return;
    host.replaceChildren();
    const mk = (cls: string, src: string, w: number, h: number) => {
      const d = document.createElement('div');
      d.className = cls;
      d.style.width = `${w}px`;
      d.style.height = `${h}px`;
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.src = `/rg/fx/tex/${src}`;
      d.append(img);
      return d;
    };
    // 背景层：#563 Root（254×63 基准）/ #530 Bg_core（400×300 基准），sortingOrder +1。
    const root = mk('burst-root', 'APRate_OutlineEffect.png',
      AP_RATE_BURST_ROOT.w, AP_RATE_BURST_ROOT.h);
    const core = mk('burst-core', 'Default-Particle.png',
      AP_RATE_BURST_CORE.w, AP_RATE_BURST_CORE.h);
    host.append(root, core);
    // 主体层：#565 Particle（14 颗，慢）/ #564 Closs（15 颗，快）。
    const sparks: {
      el: HTMLElement; ax: number; ay: number; vx: number; vy: number;
      life: number; delay: number; spin: number; star: boolean;
      /** LimitVelocityOverLifetime 的 magnitude / dampen。 */
      limit: number; dampen: number;
    }[] = [];
    const addSparks = (
      cls: string, count: number, speedLo: number, speedHi: number,
      star: boolean, limit: number, dampen: number,
    ) => {
      for (let i = 0; i < count; i++) {
        const t = (i + Math.random()) / count * Math.PI * 2;
        const r = AP_RATE_BURST_RING_INNER + Math.random() * (1 - AP_RATE_BURST_RING_INNER);
        const ax = Math.cos(t) * AP_RATE_BURST_RING.rx * r;
        const ay = Math.sin(t) * AP_RATE_BURST_RING.ry * r;
        // 速度 6–7 / 1.0–1.6 世界单位/秒 ⇒ ×100 px/s。
        const sp = (speedLo + Math.random() * (speedHi - speedLo)) * 100;
        // startSize 0.3–0.6 世界单位 ⇒ 30–60 px。
        const size = star ? 30 + Math.random() * 30 : 20 + Math.random() * 20;
        const el = mk(cls, star ? 'sc2_outgameLvUp_glitter_lyric_01.png' : 'sc2_Particle_light02.png', size, size);
        host.append(el);
        sparks.push({
          el, ax, ay,
          vx: Math.cos(t) * sp, vy: Math.sin(t) * sp,
          life: 0.4 + Math.random() * 0.3,
          delay: Math.random() * 0.15,
          spin: star ? 0 : (Math.random() * 2 - 1) * Math.PI * 0.5,
          star, limit, dampen,
        });
      }
    };
    // #565 Particle：初速 100–160，magnitude TwoConstants 0.7–1.0 ⇒ 限速 70–100，dampen 0.2。
    addSparks('burst-particles', 14, 1.0, 1.6, false, 70 + Math.random() * 30, 0.2);
    // #564 Closs：初速 600–700，magnitude 常量 1.0 ⇒ 限速 100，dampen 0.3。
    addSparks('burst-glitter', 15, 6.0, 7.0, true, 100, 0.3);
    this.apRateBurstSparks = sparks;
    this.apRateBurstLive = true;
  }

  /** 清空 APRateEffect 的贴图节点（寿命结束、重播或换谱时调用）。 */
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
    const root = host.querySelector<HTMLElement>('.burst-root');
    const core = host.querySelector<HTMLElement>('.burst-core');
    // Root / Bg_core 共用尺寸曲线，两层都从中心放大。
    const s = apRateBurstScale(age);
    if (root) {
      root.style.opacity = String(apRateBurstRootAlpha(age) * AP_RATE_BURST_ROOT_GAIN);
      root.style.transform = `translate(-50%,-50%) scale(${s})`;
    }
    if (core) {
      // Bg_core 的基准不透明度是原包 startColor.a = 0.537。此处内联设置，
      // 不能写在 CSS —— 内联样式会覆盖它。
      core.style.opacity = String(apRateBurstCoreAlpha(age) * AP_RATE_BURST_CORE_ALPHA_GAIN);
      core.style.transform = `translate(-50%,-50%) scale(${s})`;
    }
    for (const sp of this.apRateBurstSparks) {
      const a = age - sp.delay;
      if (a <= 0 || a >= sp.life) {
        sp.el.style.opacity = '0';
        continue;
      }
      const u = a / sp.life;
      // LimitVelocityOverLifetime：位移是 v(t)=lim+(v0−lim)e^(−κt) 的积分。
      const [x, y] = apRateBurstTravel(sp.vx, sp.vy, a, sp.limit, sp.dampen);
      sp.el.style.opacity = String(apRateBurstParticleAlpha(u));
      sp.el.style.transform = `translate(-50%,-50%) translate(${sp.ax + x}px,${-(sp.ay + y)}px) `
        + `rotate(${sp.spin * a}rad) scale(${apRateBurstParticleScale(u)})`;
    }
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
    const y = judgementLayoutY(this.judgementYOpt, -270);
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
    const y = judgementLayoutY(this.fastSlowYOpt, -210);
    place(this.conditionEl, 400, 400, 0.5, 0.5, 0.5, 0.5, 0, y, 180, 64);
  }

  private applyConditionSprite(condition: NoteConditionType): void {
    if (!this.conditionEl) return;
    const spr = conditionSprite(condition);
    if (!spr) {
      this.conditionEl.style.visibility = 'hidden';
      return;
    }
    mountSprite(this.conditionEl, spr.name, spr.fallback);
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
    place(this.judge, 400, 400, 0.5, 0.5, 0.5, 0.5, 0, judgementLayoutY(this.judgementYOpt, -270), w, 80);
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
    const x = scoreAddTweenX(age) + SCORE_ADD_X_NUDGE;
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
    // Anchored at dump (0, -270). Sprite size: perfect 340x80 / perfect_plus 386x80.
    this.judgePop = pop;
    place(pop, 400, 400, 0.5, 0.5, 0.5, 0.5, 0, judgementLayoutY(this.judgementYOpt, -270), 340, 80);
    mountSprite(pop, 'ui_sc2_ingame_hantei_perfect', 'PERFECT');
    pop.style.visibility = 'hidden';
    // JudgeRoot/Condition (0, -210) 180×64; FastSlowY moves it; gated by FastSlowThreshold.
    const cond = document.createElement('div');
    cond.className = 'hud-condition';
    this.conditionEl = cond;
    place(cond, 400, 400, 0.5, 0.5, 0.5, 0.5, 0, judgementLayoutY(this.fastSlowYOpt, -210), 180, 64);
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
