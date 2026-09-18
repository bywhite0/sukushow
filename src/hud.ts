import type { Chart, Note } from './chart';
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
  autoPlayJudgementType,
  judgementLayoutY,
  judgementSprite,
  shouldShowJudgement,
  type FastSlowOption,
  type JudgementOutputOption,
  type NoteJudgementType,
} from './rgOptions';

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

export class LiveHud {
  private readonly stage: HTMLElement;
  private readonly root: HTMLElement;
  private readonly logic: HTMLElement;
  private readonly comboRow: HTMLElement;
  private readonly comboDigits: HTMLElement[] = [];
  private readonly comboLabel: HTMLElement;
  private readonly apRateBadge: HTMLElement;
  private readonly apRateValue: HTMLElement;
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
  private enablePerfectPlus: boolean = RG_OPTION_DEFAULTS.enablePerfectPlus;
  private judgementYOpt = RG_OPTION_DEFAULTS.judgementY;
  private fastSlowYOpt = RG_OPTION_DEFAULTS.fastSlowY;
  private enableFeverDisplay: boolean = RG_OPTION_DEFAULTS.enableFeverDisplay;
  private judgePop: HTMLElement | null = null;
  private judgementOutput: JudgementOutputOption = RG_OPTION_DEFAULTS.judgementOutput;
  private fastSlowThreshold: FastSlowOption = RG_OPTION_DEFAULTS.fastSlowThreshold;
  private lastJudgeType: NoteJudgementType = 4;
  private comboBounceAt = -1;

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
  }

  sync(chart: Chart, time: number): void {
    if (!Number.isFinite(time)) return;
    if (chart !== this.chart) {
      this.chart = chart;
      this.resetLive(time);
      return;
    }
    const previousTime = this.previousTime;
    this.previousTime = time;
    if (time < previousTime) {
      this.resetLive(time);
      return;
    }
    if (time - previousTime < SEEK_GAP) {
      const hits = countHeads(chart, previousTime, time);
      if (hits > 0) {
        const jType = autoPlayJudgementType(this.enablePerfectPlus);
        this.scoreEngine.addMany(jType, hits);
        this.combo = this.scoreEngine.combo;
        this.apRate = this.scoreEngine.apRate;
        this.paintCombo();
        this.paintApRate();
        this.paintScore();
        this.paintGauge();
        this.paintTechnicalFromEngine();
        if (!this.rankManual) {
          this.setRank(scoreRankDisplay(this.scoreEngine.rank, this.scoreEngine.score));
        }
        if (shouldShowJudgement(jType, this.judgementOutput)) {
          this.applyJudgeSprite(jType);
          this.judgeAt = time;
        }
        if (this.combo >= 10) this.comboBounceAt = time;
      }
    }
    this.paintJudge(time);
    this.paintComboBounce(time);
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
    this.comboBounceAt = -1;
    this.comboRow.style.transform = '';
    this.rankManual = false;
    this.paintCombo();
    this.paintApRate();
    this.paintScore();
    this.paintGauge();
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
    const on = this.apRate >= 1;
    this.comboLabel.hidden = !on;
    this.apRateBadge.hidden = !on;
    if (on) {
      this.apRateValue.textContent = `AP増加 ×1.${this.apRate}`;
    } else {
      this.apRateValue.textContent = '';
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

  private paintComboBounce(time: number): void {
    if (this.comboBounceAt < 0) {
      this.comboRow.style.transform = '';
      return;
    }
    const age = time - this.comboBounceAt;
    if (age < 0 || age >= COMBO_TWEEN) {
      this.comboRow.style.transform = '';
      this.comboBounceAt = -1;
      return;
    }
    // ComboRectTween: scale = 0.8 + 0.4*u - 0.2*u*u (0.8 → 1.0).
    const u = Math.min(age, COMBO_TWEEN) * (1 / COMBO_TWEEN);
    const scale = 0.8 + 0.4 * u - 0.2 * u * u;
    this.comboRow.style.transform = `scale(${scale})`;
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
    root.append(label, strip);
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

  setJudgementOutput(opt: JudgementOutputOption): void {
    this.judgementOutput = opt;
  }

  /** ConfigResolver.FastSlowThreshold — gates Condition FAST/SLOW (chrome TBD). */
  setFastSlowThreshold(opt: FastSlowOption): void {
    this.fastSlowThreshold = opt;
  }

  setJudgementY(opt: number): void {
    this.judgementYOpt = opt;
    this.repositionJudge();
  }

  setFastSlowY(opt: number): void {
    this.fastSlowYOpt = opt;
    // Condition chrome TBD — store for when FAST/SLOW nodes exist.
  }

  setEnableFeverDisplay(on: boolean): void {
    this.enableFeverDisplay = on;
    // Fever live HUD not yet mounted; flag reserved for Voltage/Fever chrome.
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
    root.append(pop);
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
    place(row, 400, 320, 0.5, 0.5, 0.5, 0.5, -40, 54, 360, 120);
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
    root.append(row, label, apRate);
    safe.append(root);
    return { row, label, apRate, apRateValue };
  }

  private buildAp(safe: HTMLElement): void {
    const root = document.createElement('div');
    root.className = 'hud-ap';
    // Gauges are children of the 138 bases (pos 0,0), not siblings of APVoltageRoot.
    const meter = (base: string, gage: string, x: number) => {
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
      // Scene Image is Filled / Radial360, fillOrigin Top, counterclockwise, fillAmount 1 (level56).
      // No live AP, so the fill stays empty.
      mountSprite(fill, gage, '');
      slot.append(ring, fill);
      root.append(slot);
    };
    meter('ui_sc2_ingame_ap_base', 'ui_sc2_ingame_gage_ap', -60);
    meter('ui_sc2_ingame_voltage_base', 'ui_sc2_ingame_gage_voltage', 80);
    const label = (text: string, x: number, y: number, w: number, className: string) => {
      const node = document.createElement('div');
      node.className = className;
      mountOutlinedText(node, text);
      place(node, 320, 160, 0.5, 0.5, 0.5, 0.5, x, y, w, 40);
      root.append(node);
    };
    label('AP', -60, 53, 80, 'hud-ap-label is-ap');
    label('VOLTAGE', 80, 53, 120, 'hud-ap-label is-vo');
    // Scene sample text is 7 / 99. Preview placeholder stays at 0.
    label('0', -60, -8, 80, 'hud-ap-value is-ap');
    label('0', 80, -8, 80, 'hud-ap-value is-vo');
    safe.append(root);
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
    // Scene sample text is MENTAL / 9999 / 9999. Preview placeholder keeps the numbers at 0.
    text('MENTAL', 'hud-mental-label', -108, 120);
    text('0', 'hud-mental-now', -16, 88);
    text('/', 'hud-mental-sep', 41, 32);
    text('0', 'hud-mental-max', 80, 80);
    const track = document.createElement('div');
    track.className = 'hud-mental-track';
    place(track, 400, 80, 0.5, 0.5, 0, 0.5, -160, -16, 280, 16);
    const fill = document.createElement('div');
    fill.className = 'hud-mental-fill';
    track.append(fill);
    root.append(track);
    safe.append(root);
  }
}
