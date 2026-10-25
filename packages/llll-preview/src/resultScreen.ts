/**
 * 结算界面（RhythmGameResultScene，level57）的 canvas 2D 还原。
 *
 * 数据：`resultScreenClip.ts`（`scripts/gen-result-screen-data.py` 从 4.12.0 level57 授权导出）。
 * 编排以 4.12.0 为准：`RhythmGameResultSceneView.PlayAsync`（@0x4853A2C）、
 * `UserRecordContent.PlaySkippableAsync`（@0x46F648C）、`ResultSceneResolver`（@0x499F20C；
 * 只等 `bgm.IsPlayEnd()`，不等待曲终横幅）；场景切换过场为 FadeType.Capture
 * （NodeCapture：mTimeTopIn 0 / mTimeFadeOut 0.3）。跳过走 `OnCompleted`（@0x46F3958），
 * 不播 SE 0002/0003、不激活粒子，只把 flag / 灯 / 计数求值到静态终态。
 * 粒子按原始 active 关键帧确定开播时刻，再以确定性解析模型求值；
 * 按 ParticleSystemRenderer 的排序层与顺序分在主 UI 前后加色合成。
 *
 * 只由游玩模式在曲终横幅结束后打开；AutoPlay 预览不进入结算。
 * 运营内容（Plize / ClassMission / GrandPrix / ClassUp / AutoPlay 面板）不在还原范围。
 * Rate / PlayerRate 由本地成绩库（每首歌+难度的历史最佳技术分）+ masterdata 公式计算，见
 * @sukushow/llll-preview/rate；没有本地记录 / masterdata 时两块隐藏。清曲灯 after 用本机成绩推断，
 * 背景使用深色渐变（原版为出战卡组中心卡卡面）；这些都在 docs/evidence.md 标注为预览口径。
 */

import { image, hudFont, preloadImages, type Ctx } from './canvasKit';
import { BANNER_TEX_BASE } from './comboResult';
import { sampleCurve, DIFFICULTY_COLORS } from './startAnim';
import {
  RESULT_CLIPS,
  RESULT_FX,
  RESULT_FX_TEXTURES,
  RESULT_NODES,
  RESULT_SPRITES,
} from './resultScreenClip';
import {
  clamp01,
  clearLampOf,
  countupValue,
  easeInQuad,
  formatScore,
  formatTechnical,
  rankText,
  slideOffset,
  slideTotalWait,
  technicalGoal,
} from './resultScreenFormat';
import type { ResultClip, ResultEmitter, ResultNode } from './resultScreenTypes';
import { layoutResultText } from './resultScreenText';
import { resultActivationTime, resultParticleAboveUi, resultParticleAt, spawnResultEmitter, type ResultParticle } from './resultScreenParticles';
import type { ResultAudioOutput } from './resultAudio';
import { drawRankBadge, type RankBadge } from './rankBadge';

export type ResultScreenView = { cssW: number; cssH: number; dpr: number };

/** 结算入参：原版 RhythmGameResultSceneParam 的单机裁剪 + 预览自己的清曲灯推断。 */
export type ResultSnapshot = {
  score: number;
  /** 技术分原始加权和（显示端 ÷TotalNoteCount×10000）。 */
  technicalRaw: number;
  userCombo: number;
  /** Miss..PerfectPlus 的判定计数（长度 6，索引同 NoteJudgementType）。 */
  judgements: readonly number[];
  /** FAST / SLOW / FLICK 计数。 */
  conditions: readonly [number, number, number];
  /** ComboFlags：bit0 AllPerfect、bit1 FullCombo（GetComboFlags 位域）。 */
  comboFlags: number;
  remainMental: number;
  /** RhythmGameAchievementStatus：0 None(D) / 1 C / 2 B / 3 A / 4 S。 */
  scoreRank: number;
  musicTitle: string;
  /** 难度名（EXPERT 等，按大写显示）。 */
  difficulty: string;
  /** MusicScoreDifficulty：1 Normal … 4 Master。 */
  difficultyId: number;
  /** Musics masterdata 的 SongType（曲目类型图标 icon_song_type_{SongType}）；缺数据时按 1 占位。 */
  songType?: number;
  difficultyLevel: number;
  totalNoteCount: number;
  enableFastSlow: boolean;
  /** 各难度既有清曲灯（MusicScoreClearLamp 0 None / 1 Clear / 2 FC / 3 AP）；单机预览默认全 0。 */
  oldClearLamps?: readonly number[];
  jacketUrl?: string | null;
  /** 楽曲レート（预览无服务端记录时恒 0；Increase 行按 goal<1 不激活）。 */
  rate?: number;
  rateIncrease?: number;
  playerRate?: number;
  playerRateIncrease?: number;
};

export type ResultScreenAction = 'retry' | 'exit';

export type ResultScreenLoadProgress = { url: string; phase: 'download' | 'ready' };

const SPRITE_BASE = '/rg/sprites/';
/** 结算粒子贴图与曲终横幅同目录（BannerTex）。 */
const FX_TEX_BASE = BANNER_TEX_BASE;
const SAFE_W = 1920;
const DESIGN_W = 1920;
const DESIGN_H = 1080;

/** NodeCapture.mTimeFadeOut（场景切换冻帧淡出）。 */
const REVEAL_FADE = 0.3;
/** PlaySkippableAsync 第 8 步 `UniTask.Delay(500)`。 */
const FLAG_DELAY = 0.5;

/** 清曲灯 sprite（ClearLampSpriteResolver：索引 = MusicScoreClearLamp）。 */
const LAMP_SPRITES = [
  'ui_sc2_ic_note_none',
  'ui_sc2_ic_note_01',
  'ui_sc2_ic_note_02',
  'ui_sc2_ic_note_03',
] as const;
/** 曲目类型图标（Model.musicTypeIconName = icon_song_type_{SongType}）。 */
const MUSIC_TYPE_ICON_FALLBACK = 1;
const musicTypeIcon = (songType: number) => 'icon_song_type_' + String(Math.max(0, Math.min(3, Math.trunc(songType))));
const DIFFICULTY_NAMES = ['', 'NORMAL', 'HARD', 'EXPERT', 'MASTER'] as const;

const round = (v: number, n = 4) => Math.round(v * 10 ** n) / 10 ** n;
const rgbaCss = (c: readonly number[], a = 1) =>
  `rgba(${Math.round((c[0] ?? 0) * 255)},${Math.round((c[1] ?? 0) * 255)},${Math.round((c[2] ?? 0) * 255)},${round(clamp01(a))})`;

// ── 贴图着色缓存（逐像素乘色，等价 uGUI Image.color / GradientColor 顶点色）────
const tintCache = new Map<string, HTMLCanvasElement | null>();

function tintedSprite(url: string, left: readonly number[], right?: readonly number[]): HTMLImageElement | HTMLCanvasElement | null {
  const img = image(url);
  if (!img) return null;
  const l = [left[0] ?? 1, left[1] ?? 1, left[2] ?? 1, left[3] ?? 1];
  const r = right ? [right[0] ?? 1, right[1] ?? 1, right[2] ?? 1, right[3] ?? 1] : l;
  const white = [...l, ...r].every((v) => Math.abs(v - 1) < 1e-4);
  if (white) return img;
  const key = `${url}|${l.map((v) => round(v, 3)).join(',')}|${r.map((v) => round(v, 3)).join(',')}`;
  const hit = tintCache.get(key);
  if (hit !== undefined) return hit;
  let out: HTMLCanvasElement | null = null;
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0);
    const data = x.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    const w = c.width;
    for (let i = 0; i < px.length; i += 4) {
      const u = w > 1 ? ((i / 4) % w) / (w - 1) : 0;
      px[i] = (px[i] ?? 0) * (l[0]! + (r[0]! - l[0]!) * u);
      px[i + 1] = (px[i + 1] ?? 0) * (l[1]! + (r[1]! - l[1]!) * u);
      px[i + 2] = (px[i + 2] ?? 0) * (l[2]! + (r[2]! - l[2]!) * u);
      px[i + 3] = (px[i + 3] ?? 0) * (l[3]! + (r[3]! - l[3]!) * u);
    }
    x.putImageData(data, 0, 0);
    out = c;
  } catch {
    out = null;
  }
  if (tintCache.size > 256) tintCache.clear();
  tintCache.set(key, out);
  return out ?? img;
}

/** 粒子贴图按颜色量化着色（与曲终横幅同一口径）。 */
const particleTintCache = new Map<string, CanvasImageSource | null>();
const TINT_STEPS = 32;
function particleImage(tex: string, r: number, g: number, b: number): CanvasImageSource | null {
  const q = (v: number) => Math.round(clamp01(v) * TINT_STEPS) / TINT_STEPS;
  const key = `${tex}|${q(r)}|${q(g)}|${q(b)}`;
  if (particleTintCache.has(key)) return particleTintCache.get(key) ?? null;
  const img = tintedSprite(`${FX_TEX_BASE}${tex}.png`, [q(r), q(g), q(b), 1]);
  if (particleTintCache.size > 512) particleTintCache.clear();
  particleTintCache.set(key, img);
  return img;
}

// ── 节点 / 播放状态 ─────────────────────────────────────────────
type NodeState = {
  active: boolean;
  x: number;
  y: number;
  sx: number;
  sy: number;
  r: number;
  g: number;
  b: number;
  a: number;
};

type EmitterPlayback = {
  e: ResultEmitter;
  host: number;
  parts: ResultParticle[];
};

type Playback = {
  clip: ResultClip;
  host: string;
  start: number;
  dur: number;
  /** 跳过时只求值终帧、不生成粒子（OnCompleted 不激活任何粒子发射器）。 */
  particles: boolean;
  emitters: EmitterPlayback[];
};

type Phase =
  | 'idle'
  | 'reveal'
  | 'title'
  | 'slides'
  | 'score'
  | 'technical'
  | 'judgements'
  | 'combo'
  | 'conditions'
  | 'rate'
  | 'rateInc'
  | 'playerRate'
  | 'playerRateInc'
  | 'flagDelay'
  | 'comboFlag'
  | 'lamp'
  | 'done';

type Rect = { x: number; y: number; w: number; h: number };

const P = {
  title: 'ResultTitle',
  titleContent: 'TitleContent',
  record: 'UserRecordContent(A)',
  scoreNumber: 'UserRecordContent(A)/ScorePanel/ScoreContent/Number-Score',
  technicalNumber: 'UserRecordContent(A)/ScorePanel/TechnicalScoreContent/Number-TechnicalScore',
  judgementNumbers: [
    'UserRecordContent(A)/JudgementPanel/PerfectPlusContent/Number-PerfectPlus',
    'UserRecordContent(A)/JudgementPanel/PerfectContent/Number-Perfect',
    'UserRecordContent(A)/JudgementPanel/GreatContent/Number-Great',
    'UserRecordContent(A)/JudgementPanel/GoodContent/Number-Good',
    'UserRecordContent(A)/JudgementPanel/BadContent/Number-Bad',
    'UserRecordContent(A)/JudgementPanel/MissContent/Number-Miss',
  ],
  conditionNumbers: [
    'UserRecordContent(A)/JudgementPanel/FastSlowContent/Horizontal/Root1/Number-Fast',
    'UserRecordContent(A)/JudgementPanel/FastSlowContent/Horizontal/Root2/Number-Slow',
    'UserRecordContent(A)/JudgementPanel/FastSlowContent/Horizontal/Root3/Number-Flick',
  ],
  fastSlow: 'UserRecordContent(A)/JudgementPanel/FastSlowContent',
  comboEffect: 'UserRecordContent(A)/JudgementPanel/ComboContent/ComboEffectRoot',
  comboFlagText: 'UserRecordContent(A)/JudgementPanel/ComboContent/ComboEffectRoot/Image/Text-APFC',
  digitPaths: [
    'UserRecordContent(A)/JudgementPanel/ComboContent/SpriteRoot/Sprite0',
    'UserRecordContent(A)/JudgementPanel/ComboContent/SpriteRoot/Sprite1',
    'UserRecordContent(A)/JudgementPanel/ComboContent/SpriteRoot/Sprite2',
    'UserRecordContent(A)/JudgementPanel/ComboContent/SpriteRoot/Sprite3',
  ],
  rateNumber: 'UserRecordContent(A)/JudgementPanel/RateContent/Number-Rate',
  rateIncrease: 'UserRecordContent(A)/JudgementPanel/RateContent/Number-RateIncrease',
  rateContent: 'UserRecordContent(A)/JudgementPanel/RateContent',
  playerRateNumber: 'UserRecordContent(A)/JudgementPanel/PlayerRateContent/Number-PlayerRate',
  playerRateIncrease: 'UserRecordContent(A)/JudgementPanel/PlayerRateContent/Number-PlayerRateIncrease',
  playerRateContent: 'UserRecordContent(A)/JudgementPanel/PlayerRateContent',
  nextButton: 'UserRecordContent(A)/NextButton',
  nextText: 'UserRecordContent(A)/NextButton/Text',
  blocker: 'Blocker',
  bg: 'Canvas-Bg/RawImage-Bg',
  jacket: 'TitleContent/Jacket/Image-Jacket',
  rankIcon: 'TitleContent/RhythmGameScoreRankIcon',
  rankName: 'TitleContent/RhythmGameScoreRankIcon/White/RankColor/RankName',
  musicTitle: 'TitleContent/MusicTItle',
  musicLevel: 'TitleContent/MusicLevel',
  difficultyName: 'TitleContent/MusicTItle/DifficultyRoot/White/DifficultyColor/DifficultyName',
  jacketShadow: 'TitleContent/Jacket/JacketShadow',
  difficultyColor: 'TitleContent/MusicTItle/DifficultyRoot/White/DifficultyColor',
  musicTypeIcon: 'TitleContent/MusicTypeIcon',
} as const;

const SLIDE_PATHS = [
  'UserRecordContent(A)/ScorePanel/ScoreContent',
  'UserRecordContent(A)/ScorePanel/TechnicalScoreContent',
  'UserRecordContent(A)/JudgementPanel/PerfectPlusContent',
  'UserRecordContent(A)/JudgementPanel/PerfectContent',
  'UserRecordContent(A)/JudgementPanel/GreatContent',
  'UserRecordContent(A)/JudgementPanel/GoodContent',
  'UserRecordContent(A)/JudgementPanel/BadContent',
  'UserRecordContent(A)/JudgementPanel/MissContent',
  'UserRecordContent(A)/JudgementPanel/ComboContent',
  'UserRecordContent(A)/JudgementPanel/FastSlowContent',
  'UserRecordContent(A)/JudgementPanel/RateContent',
  'UserRecordContent(A)/JudgementPanel/PlayerRateContent',
] as const;

/** 预览补充的退出按钮（原版该页只有「次へ」，退出走返回键 / 其它内容页）。 */
const EXIT_BUTTON = { x: -828, y: -500, w: 180, h: 60 } as const;

type Slide = { index: number; goalX: number; delay: number };

/** 舞台合成层接口：StageCompositor 只要求 draw。 */
export class ResultScreen {
  private readonly nodes: readonly ResultNode[] = RESULT_NODES;
  private readonly index = new Map<string, number>();
  private readonly children: number[][] = [];
  private readonly roots: number[] = [];
  private readonly clips = new Map<string, ResultClip>();
  private readonly baseStates: NodeState[] = [];
  private readonly states: NodeState[] = [];
  private readonly activeOverride = new Map<number, boolean>();
  private readonly alphaOverride = new Map<number, number>();
  private readonly slideOverrides = new Map<number, { x: number; a: number }>();
  private readonly spriteOverride = new Map<number, string>();
  private readonly textOverride = new Map<number, string>();
  private readonly fillOverride = new Map<number, readonly number[]>();
  private readonly playbacks: Playback[] = [];
  /** 节点在画布 CSS 坐标中的矩形（draw 时按当前变换写入；点击命中用）。 */
  private readonly cssRects: (Rect | null)[] = [];

  private snapshot: ResultSnapshot | null = null;
  private phase: Phase = 'idle';
  private t = 0;
  private phaseStart = 0;
  private titleDur = 0;
  private slides: Slide[] = [];
  private slideStart = 0;
  private slideWait = 0;
  private slidesDone = false;
  private titleSlideStart = -1;
  private titleSlideActive = false;
  private reveal = 0;
  private frozen: CanvasImageSource | null = null;
  private finished = false;
  private skipped = false;
  private lampNeeded = false;
  private lampTarget = 1;
  /** 预览是否拿得到 Rate / PlayerRate 数值（本地成绩库 + masterdata；缺数据时整块隐藏，不伪造 0）。 */
  private hasRate = false;
  private hasPlayerRate = false;
  private lastClickAt = -1;
  private background: HTMLCanvasElement | null = null;
  private view: ResultScreenView = { cssW: 1920, cssH: 1080, dpr: 1 };
  private k = 1;
  private particleMatrices = new Map<number, DOMMatrix>();
  private particleHosts = new Set(RESULT_FX.map((e) => e.path));
  private hit: { retry: Rect | null; exit: Rect | null } = { retry: null, exit: null };
  private ready: Promise<void> | null = null;
  private loaded = false;
  private countAudioKey = '';
  private static warned = new Set<string>();

  constructor(private readonly audio: ResultAudioOutput | null = null) {
    this.nodes.forEach((n, i) => {
      this.index.set(n.path, i);
      this.children.push([]);
      this.cssRects.push(null);
      if (n.parent < 0) this.roots.push(i);
      const rgba = n.image ? n.image.rgba : n.text ? n.text.rgba : [1, 1, 1, 1] as const;
      this.baseStates.push({
        active: n.active,
        x: n.x,
        y: n.y,
        sx: n.sx,
        sy: n.sy,
        r: rgba[0] ?? 1,
        g: rgba[1] ?? 1,
        b: rgba[2] ?? 1,
        a: rgba[3] ?? 1,
      });
      this.states.push({ ...this.baseStates[i]! });
    });
    this.nodes.forEach((n, i) => {
      if (n.parent >= 0) this.children[n.parent]!.push(i);
    });
    for (const clip of RESULT_CLIPS) this.clips.set(clip.name, clip);
    this.titleDur = this.clipDur('sc2_ResultTitleAnimation');
  }

  /** 结算用到的全部静态贴图（预载 / 导出前等待）。 */
  static textureUrls(): string[] {
    const urls = new Set<string>();
    for (const name of RESULT_SPRITES) urls.add(`${SPRITE_BASE}${name}.png`);
    for (const name of RESULT_FX_TEXTURES) urls.add(`${FX_TEX_BASE}${name}.png`);
    for (const name of LAMP_SPRITES) urls.add(`${SPRITE_BASE}${name}.png`);
    for (let songType = 0; songType <= 3; songType++) urls.add(SPRITE_BASE + musicTypeIcon(songType) + '.png');
    for (let d = 0; d <= 9; d++) urls.add(`${SPRITE_BASE}ui_sc2_ingame_num_combo_${d}.png`);
    return [...urls];
  }

  load(onProgress?: (progress: ResultScreenLoadProgress) => void): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = preloadImages(ResultScreen.textureUrls(), onProgress).then(() => {
      this.loaded = true;
    });
    return this.ready;
  }

  get texturesReady(): boolean {
    return this.loaded;
  }

  get visible(): boolean {
    return this.phase !== 'idle';
  }

  get done(): boolean {
    return this.finished;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  get currentSnapshot(): ResultSnapshot | null {
    return this.snapshot;
  }

  get currentTime(): number {
    return this.t;
  }

  /** 当前两个按钮在画布 CSS 坐标里的矩形（未完成时为空）。 */
  get buttons(): { retry: Rect | null; exit: Rect | null } {
    return this.hit;
  }

  /** 打开结算。`frozen` 为场景切换瞬间的冻帧（原版 FadeType.Capture；无则直接起标题）。 */
  open(snapshot: ResultSnapshot, frozen: CanvasImageSource | null = null): void {
    this.audio?.stop();
    this.countAudioKey = '';
    void this.load();
    this.snapshot = snapshot;
    this.phase = 'idle';
    this.t = 0;
    this.phaseStart = 0;
    this.slides = [];
    this.slidesDone = false;
    this.slideStart = -1;
    this.slideWait = 0;
    this.finished = false;
    this.skipped = false;
    this.frozen = frozen;
    this.reveal = frozen ? 0 : -1;
    this.titleSlideStart = -1;
    this.titleSlideActive = false;
    this.lastClickAt = -1;
    this.hit = { retry: null, exit: null };
    this.activeOverride.clear();
    this.alphaOverride.clear();
    this.slideOverrides.clear();
    this.spriteOverride.clear();
    this.textOverride.clear();
    this.fillOverride.clear();
    this.playbacks.length = 0;
    this.background = null;
    this.applyWiring(snapshot);
    // 原版场景音乐先于揭幕，标题 SE 在揭幕结束后触发。
    this.audio?.startBgm();
    if (frozen) {
      this.phase = 'reveal';
    } else {
      this.beginTitle();
    }
    this.updateStates();
  }

  close(): void {
    this.audio?.stop();
    this.countAudioKey = '';
    this.phase = 'idle';
    this.finished = false;
    this.snapshot = null;
    this.frozen = null;
    this.playbacks.length = 0;
    this.hit = { retry: null, exit: null };
  }

  /**
   * 点击跳过（原版 blocker 只在标题演出结束后才可点；OnCompleted 直达终态）。
   * 跳过硬约束（4.12.0 OnCompleted @0x46F3958）：不播 SE 0002/0003、不激活任何粒子，
   * flag / 灯只求值到静态终帧（动画器禁用 + 缩放 / alpha 复位）。
   */
  skip(): void {
    if (this.finished || this.phase === 'idle' || this.phase === 'reveal' || this.phase === 'title') return;
    this.skipped = true;
    this.titleSlideActive = false;
    this.slidesDone = true;
    this.activeOverride.set(this.index.get(P.titleContent)!, true);
    this.alphaOverride.delete(this.index.get(P.titleContent)!);
    this.slideOverrides.set(this.index.get(P.titleContent)!, { x: this.nodes[this.index.get(P.titleContent)!]!.x, a: 1 });
    for (const s of this.slides) this.slideOverrides.set(s.index, { x: s.goalX, a: 1 });
    this.applyFinalCountups();
    if ((this.snapshot!.rateIncrease ?? 0) >= 1) this.showIncrease(P.rateIncrease);
    if ((this.snapshot!.playerRateIncrease ?? 0) >= 1) this.showIncrease(P.playerRateIncrease);
    if ((this.snapshot!.comboFlags & 3) !== 0) {
      this.activeOverride.set(this.index.get(P.comboEffect)!, true);
      this.startPlayback('sc2_ResultAllComboPerfect', P.comboEffect, this.clipDur('sc2_ResultAllComboPerfect'), false);
    }
    if (this.lampNeeded) {
      this.startPlayback('sc2_ResultClearLampRoot_01', this.lampHost(), this.clipDur('sc2_ResultClearLampRoot_01'), false);
    }
    this.finish();
    this.updateStates();
  }

  /** 推进一帧（秒）。只在 visible 时调用。 */
  tick(dt: number): void {
    if (this.phase === 'idle') return;
    this.t += Math.max(0, dt);
    const pt = this.pt();
    const s = this.snapshot;
    if (!s) return;
    switch (this.phase) {
      case 'reveal':
        if (this.t >= REVEAL_FADE) this.beginTitle();
        break;
      case 'title':
        if (pt >= this.titleDur) this.beginContent();
        break;
      case 'slides':
        if (this.t - this.slideStart >= this.slideWait) {
          this.finalizePhase('slides');
          this.setPhase('score');
        }
        break;
      case 'score':
        if (pt >= 0.5) {
          this.finalizePhase('score');
          this.setPhase('technical');
        }
        break;
      case 'technical':
        if (pt >= 0.5) {
          this.finalizePhase('technical');
          this.setPhase('judgements');
        }
        break;
      case 'judgements':
        if (pt >= 0.2 * s.judgements.length) {
          this.finalizePhase('judgements');
          this.setPhase('combo');
        }
        break;
      case 'combo':
        if (pt >= 0.3) {
          this.finalizePhase('combo');
          if (s.enableFastSlow) this.setPhase('conditions');
          else this.setPhase(this.hasRate ? 'rate' : this.afterRatePhase());
        }
        break;
      case 'conditions':
        if (pt >= 0.2 * 3) {
          this.finalizePhase('conditions');
          this.setPhase(this.hasRate ? 'rate' : this.afterRatePhase());
        }
        break;
      case 'rate':
        if (pt >= 0.5) {
          this.finalizePhase('rate');
          if ((s.rateIncrease ?? 0) >= 1) {
            this.showIncrease(P.rateIncrease);
            this.setPhase('rateInc');
          } else this.setPhase(this.afterRatePhase());
        }
        break;
      case 'rateInc':
        if (pt >= 0.5) {
          this.finalizePhase('rateInc');
          this.setPhase(this.afterRatePhase());
        }
        break;
      case 'playerRate':
        if (pt >= 0.5) {
          this.finalizePhase('playerRate');
          if ((s.playerRateIncrease ?? 0) >= 1) {
            this.showIncrease(P.playerRateIncrease);
            this.setPhase('playerRateInc');
          } else this.setPhase('flagDelay');
        }
        break;
      case 'playerRateInc':
        if (pt >= 0.5) {
          this.finalizePhase('playerRateInc');
          this.setPhase('flagDelay');
        }
        break;
      case 'flagDelay':
        if (pt >= FLAG_DELAY) {
          if ((s.comboFlags & 3) !== 0) {
            this.activeOverride.set(this.index.get(P.comboEffect)!, true);
            this.startPlayback('sc2_ResultAllComboPerfect', P.comboEffect, 0);
            this.audio?.playSe('combo');
            this.setPhase('comboFlag');
          } else if (this.lampNeeded) {
            this.beginLamp();
          } else {
            this.finish();
          }
        }
        break;
      case 'comboFlag':
        if (pt >= this.clipDur('sc2_ResultAllComboPerfect')) {
          if (this.lampNeeded) this.beginLamp();
          else this.finish();
        }
        break;
      case 'lamp':
        if (pt >= this.clipDur('sc2_ResultClearLampRoot_01')) this.finish();
        break;
      case 'done':
        break;
    }
    this.updateStates();
    this.updateCountups();
    this.updateCountAudio();
  }

  /** 画一帧。画布是舞台合成画布（与 HUD / 曲终横幅同一张 2D 画布）。 */
  draw(ctx: Ctx, view: ResultScreenView): void {
    if (this.phase === 'idle') return;
    this.view = view;
    this.updateStates();
    const k = Math.min(view.cssW / DESIGN_W, view.cssH / DESIGN_H);
    this.k = k;
    const scale = k * view.dpr;
    const designW = view.cssW / k;
    const designH = view.cssH / k;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    this.ensureBackground(designW, designH);
    this.cssRects.fill(null);
    // Canvas-Bg 是原版的独立画布（level57 导出未带整屏 RectTransform）：整屏背景直接铺，
    // 不走节点树；其余根节点按 SafeArea（横向 1920 居中、纵向拉伸）绘制。
    if (this.background) ctx.drawImage(this.background, 0, 0, designW, designH);

    const drawRoots = (paint: boolean) => {
      for (const i of this.roots) {
        const path = this.nodes[i]!.path;
        if (path === P.blocker || path === 'Canvas-Bg') continue;
        if (path === P.titleContent || path === P.record || path === P.title) {
          ctx.save();
          ctx.translate((designW - SAFE_W) / 2, 0);
          this.drawNode(ctx, i, SAFE_W, designH, undefined, paint);
          ctx.restore();
        } else {
          this.drawNode(ctx, i, designW, designH, undefined, paint);
        }
      }
    };
    // 先求宿主矩阵，再按原版 renderer 排序把粒子分在主 Canvas 前后。
    this.particleMatrices.clear();
    drawRoots(false);
    this.drawParticles(ctx, false);
    drawRoots(true);
    this.drawParticles(ctx, true);
    const nextIdx = this.index.get(P.nextButton);
    if (this.finished && nextIdx !== undefined) this.hit.retry = this.cssRects[nextIdx] ?? null;
    else this.hit.retry = null;
    this.drawExitButton(ctx, designW, designH);
    if (this.phase === 'reveal' && this.frozen) {
      const u = clamp01(this.t / REVEAL_FADE);
      const alpha = (1 - u) * (1 - u);
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.frozen, 0, 0, designW, designH);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** 点击画布（CSS 坐标，相对舞台画布左上角）。 */
  click(cssX: number, cssY: number): ResultScreenAction | 'skip' | null {
    if (this.phase === 'idle') return null;
    // 原版 blocker / NextButton 的点击 Observable 带 ThrottleFirst(0.3s)：首点立即生效，0.3s 内忽略。
    const now = typeof performance === 'undefined' ? 0 : performance.now();
    if (this.lastClickAt >= 0 && now - this.lastClickAt < 300) return null;
    if (this.finished) {
      const inside = (r: Rect | null) => r !== null && cssX >= r.x && cssX <= r.x + r.w && cssY >= r.y && cssY <= r.y + r.h;
      if (inside(this.hit.exit)) {
        this.lastClickAt = now;
        return 'exit';
      }
      if (inside(this.hit.retry)) {
        this.lastClickAt = now;
        return 'retry';
      }
      return null;
    }
    if (this.phase === 'reveal' || this.phase === 'title') return null;
    this.lastClickAt = now;
    this.skip();
    return 'skip';
  }

  /** 键盘：Enter / Space 主按钮（演出中先跳过），Esc 退出。 */
  key(code: string): ResultScreenAction | 'skip' | null {
    if (this.phase === 'idle') return null;
    if (code === 'Escape') return 'exit';
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
      if (!this.finished) {
        if (this.phase === 'reveal' || this.phase === 'title') return null;
        this.skip();
        return 'skip';
      }
      return 'retry';
    }
    return null;
  }

  /** 测试探针：按 UI 路径读当前文本（未覆盖时返回 null）。 */
  textOf(path: string): string | null {
    const i = this.index.get(path);
    if (i === undefined) return null;
    return this.textOverride.get(i) ?? null;
  }

  /** 测试探针：按 UI 路径读当前激活态（找不到返回 null）。 */
  activeOf(path: string): boolean | null {
    const i = this.index.get(path);
    if (i === undefined) return null;
    return this.states[i]!.active;
  }

  // ── 接线（View.Initialize b__1 / UserRecordContent b__0 等价）────────────
  private applyWiring(s: ResultSnapshot): void {
    const setText = (path: string, value: string) => {
      const i = this.index.get(path);
      if (i !== undefined) this.textOverride.set(i, value);
    };
    const setSprite = (path: string, sprite: string) => {
      const i = this.index.get(path);
      if (i !== undefined) this.spriteOverride.set(i, sprite);
    };
    const setFill = (path: string, color: readonly number[]) => {
      const i = this.index.get(path);
      if (i !== undefined) this.fillOverride.set(i, color);
    };
    const setActive = (path: string, on: boolean) => {
      const i = this.index.get(path);
      if (i !== undefined) this.activeOverride.set(i, on);
    };

    const difficultyKey = (s.difficulty || DIFFICULTY_NAMES[s.difficultyId] || 'MASTER').toUpperCase();
    setText(P.musicTitle, s.musicTitle);
    setText(P.musicLevel, String(s.difficultyLevel));
    setText(P.difficultyName, difficultyKey);
    const difficultyRgb = DIFFICULTY_COLORS[difficultyKey] ?? DIFFICULTY_COLORS.MASTER!;
    const difficultyColor = [difficultyRgb[0] / 255, difficultyRgb[1] / 255, difficultyRgb[2] / 255] as const;
    setFill(P.jacketShadow, difficultyColor);
    setFill(P.difficultyColor, difficultyColor);
    setSprite(P.musicTypeIcon, musicTypeIcon(s.songType ?? MUSIC_TYPE_ICON_FALLBACK));

    // Rate / PlayerRate：原版输入为 mission 的 TechnicalScoreBefore/After 与玩家 Rate 历史；
    // 预览用本地成绩库（best technical）+ masterdata Level/MaxCombo 按同一公式算出（见 rate.ts），
    // 没有记录 / masterdata 时整块隐藏，不伪造 0 或 (+0)。
    this.hasRate = typeof s.rate === 'number' && Number.isFinite(s.rate);
    this.hasPlayerRate = typeof s.playerRate === 'number' && Number.isFinite(s.playerRate);
    setActive(P.rateContent, this.hasRate);
    setActive(P.playerRateContent, this.hasPlayerRate);

    // Rank 徽章（SetRank：文本 + 材质色；结算不播 ColorChange）
    setText(P.rankName, rankText(s.scoreRank));
    setActive(P.nextButton, false);
    setText(P.nextText, '再玩一次');

    // 清曲灯：BeforeImage=既有灯；目标难度的 ClearLampImage-01=本局灯（单机由成绩推断，见 clearLampOf）。
    const oldLamps = s.oldClearLamps ?? [0, 0, 0, 0];
    this.lampTarget = Math.max(1, Math.min(4, s.difficultyId));
    const newLamp = clearLampOf(s.comboFlags, s.remainMental);
    for (let i = 0; i < 4; i++) {
      const base = `TitleContent/ClearLampRoot/ClearLampRoot (${i + 1})`;
      const old = Math.max(0, Math.min(3, Math.trunc(oldLamps[i] ?? 0)));
      setSprite(`${base}/BeforeImage`, LAMP_SPRITES[old]!);
      const lamp = i === this.lampTarget - 1 ? newLamp : old;
      setSprite(`${base}/ClearLampImage-01`, LAMP_SPRITES[lamp]!);
    }
    const oldTarget = Math.trunc(oldLamps[this.lampTarget - 1] ?? 0);
    this.lampNeeded = newLamp > oldTarget;

    // 曲终旗标（b__0：AP→ALL PERFECT / FC→FULL COMBO；两者都没有则整段跳过）
    if ((s.comboFlags & 1) !== 0) setText(P.comboFlagText, 'ALL PERFECT');
    else if ((s.comboFlags & 2) !== 0) setText(P.comboFlagText, 'FULL COMBO');
    setActive(P.comboEffect, false);

    // 滑入块（UserRecordContent.slideContents 序列化序；EnableFastSlow=false 时移除 FastSlowContent）
    setActive(P.fastSlow, s.enableFastSlow);
    this.slides = [];
    let delay = 0.1;
    for (const path of SLIDE_PATHS) {
      if (!s.enableFastSlow && path === P.fastSlow) continue;
      if (!this.hasRate && path === P.rateContent) continue;
      if (!this.hasPlayerRate && path === P.playerRateContent) continue;
      const i = this.index.get(path);
      if (i === undefined) continue;
      // 起始透明度交给 slideOverrides（进场时 x=goal+150、alpha=0）；不要在 alphaOverride 里常驻 0，
      // 否则会与滑入 alpha 相乘、内容永远不出现。
      this.slides.push({ index: i, goalX: this.nodes[i]!.x, delay });
      this.slideOverrides.set(i, { x: this.nodes[i]!.x + 150, a: 0 });
      delay += 0.1;
    }
    this.slideWait = slideTotalWait(this.slides.length);

    // 计数器初值：原版接线时 Apply(0)。
    setText(P.scoreNumber, formatScore(0));
    setText(P.technicalNumber, formatTechnical(0));
    for (const path of P.judgementNumbers) setText(path, '0');
    for (const path of P.conditionNumbers) setText(path, '0');
    setText(P.rateNumber, '0');
    setText(P.playerRateNumber, '0');
    this.setComboDigits(0);

    // 初始隐藏：标题 / 内容 / blocker / 下一局按钮由各阶段打开。
    setActive(P.title, false);
    setActive(P.record, false);
    setActive(P.blocker, false);
    this.alphaOverride.set(this.index.get(P.titleContent)!, 0);
  }

  private beginTitle(): void {
    this.setPhase('title');
    this.activeOverride.set(this.index.get(P.title)!, true);
    this.startPlayback('sc2_ResultTitleAnimation', P.title, 0);
    this.audio?.playSe('title');
  }

  private beginContent(): void {
    this.setPhase('slides');
    this.activeOverride.set(this.index.get(P.record)!, true);
    this.activeOverride.set(this.index.get(P.blocker)!, true);
    this.alphaOverride.delete(this.index.get(P.titleContent)!);
    this.titleSlideStart = this.t;
    this.titleSlideActive = true;
    this.slideStart = this.t;
    this.slidesDone = false;
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseStart = this.t;
    this.updateCountAudio();
  }

  /** Increase 行在原版只在 GoalValue >= 1 时 SetActive(true)（§3 第 8/10 步）。 */
  private showIncrease(path: string): void {
    const i = this.index.get(path);
    if (i !== undefined) this.activeOverride.set(i, true);
  }

  private beginLamp(): void {
    this.startPlayback('sc2_ResultClearLampRoot_01', this.lampHost(), 0);
    this.audio?.playSe('lamp');
    this.setPhase('lamp');
  }

  private finish(): void {
    this.activeOverride.set(this.index.get(P.nextButton)!, true);
    this.finished = true;
    this.setPhase('done');
  }

  private lampHost(): string {
    return `TitleContent/ClearLampRoot/ClearLampRoot (${this.lampTarget})`;
  }

  private pt(): number {
    return Math.max(0, this.t - this.phaseStart);
  }

  /** Rate 段之后：有 PlayerRate 数据就走 playerRate，否则直接进旗标前等待。 */
  private afterRatePhase(): Phase {
    return this.hasPlayerRate ? 'playerRate' : 'flagDelay';
  }

  private clipDur(name: string): number {
    return this.clips.get(name)?.dur ?? 0;
  }

  private startPlayback(name: string, host: string, elapsed: number, particles = true): void {
    const clip = this.clips.get(name);
    if (!clip) return;
    if (!this.index.has(host)) return;
    const prefix = `${host}/`;
    const emitters: EmitterPlayback[] = [];
    if (particles) {
      for (const e of RESULT_FX) {
        if (!e.path.startsWith(prefix)) continue;
        const hostNode = this.index.get(e.path);
        if (hostNode === undefined) continue;
        emitters.push({
          e,
          host: hostNode,
          parts: spawnResultEmitter(e, this.t - elapsed + resultActivationTime(clip, host, e.path, this.nodes)),
        });
      }
    }
    this.playbacks.push({ clip, host, start: this.t - elapsed, dur: clip.dur, particles, emitters });
  }

  // ── 每帧状态：基础值 + 呈现覆盖 + clip 曲线 ────────────────────────
  private updateStates(): void {
    if (!this.snapshot) return;
    for (let i = 0; i < this.nodes.length; i++) {
      const b = this.baseStates[i]!;
      const st = this.states[i]!;
      st.active = this.activeOverride.get(i) ?? b.active;
      st.x = b.x;
      st.y = b.y;
      st.sx = b.sx;
      st.sy = b.sy;
      st.r = b.r;
      st.g = b.g;
      st.b = b.b;
      st.a = b.a;
    }
    if (this.titleSlideActive && this.titleSlideStart >= 0) {
      const u = clamp01((this.t - this.titleSlideStart) / 0.5);
      const i = this.index.get(P.titleContent)!;
      this.slideOverrides.set(i, { x: this.nodes[i]!.x + slideOffset(u), a: easeInQuad(u) });
      if (u >= 1) this.titleSlideActive = false;
    }
    if (!this.slidesDone && this.slideStart >= 0) {
      for (const slide of this.slides) {
        const u = clamp01((this.t - this.slideStart - slide.delay) / 0.5);
        this.slideOverrides.set(slide.index, { x: slide.goalX + slideOffset(u), a: easeInQuad(u) });
      }
    }
    for (const [i, slide] of this.slideOverrides) {
      const st = this.states[i];
      if (!st) continue;
      st.x = slide.x;
      st.a *= slide.a;
    }
    for (const [i, alpha] of this.alphaOverride) {
      const st = this.states[i];
      if (st) st.a *= alpha;
    }
    // clip 曲线（标题 / 曲终旗标 / 清曲灯；播完保持末帧）。
    // attr 是 TMP / 材质 alpha 属性哈希的归并：同一节点可能有多条（APFC 文字 alpha 淡入 + 3 条常量属性），
    // 按最小值合成，避免常量 1 把淡入盖掉（last-wins 会把文字钉在不透明）。
    const attrAlpha = new Map<number, number>();
    for (const pb of this.playbacks) {
      const local = Math.min(Math.max(0, this.t - pb.start), pb.dur);
      const prefix = `${pb.host}/`;
      for (const curve of pb.clip.curves) {
        const abs = curve.path === '' ? pb.host : prefix + curve.path;
        const i = this.index.get(abs);
        if (i === undefined) continue;
        const st = this.states[i]!;
        const v = sampleCurve(curve.keys, local);
        switch (curve.prop) {
          case 'active':
            st.active = v > 0.5;
            break;
          case 'x':
            st.x = v;
            break;
          case 'y':
            st.y = v;
            break;
          case 'scale.x':
            st.sx = v;
            break;
          case 'scale.y':
            st.sy = v;
            break;
          case 'r':
            st.r = v;
            break;
          case 'g':
            st.g = v;
            break;
          case 'b':
            st.b = v;
            break;
          case 'a':
            st.a = v;
            break;
          case 'attr':
            attrAlpha.set(i, Math.min(attrAlpha.get(i) ?? 1, v));
            break;
        }
      }
    }
    for (const [i, a] of attrAlpha) this.states[i]!.a *= a;
  }

  // ── 计数器 ─────────────────────────────────────────────────────
  /** 每个计数器独立管理 LoopSeScope；零值仍等待，但不发声。 */
  private updateCountAudio(): void {
    const s = this.snapshot;
    if (!s || !this.audio) return;
    let key = this.phase as string;
    let goal = 0;
    switch (this.phase) {
      case 'score': goal = s.score; break;
      case 'technical': goal = technicalGoal(s.technicalRaw, s.totalNoteCount); break;
      case 'combo': goal = s.userCombo; break;
      case 'rate': goal = s.rate ?? 0; break;
      case 'rateInc': goal = s.rateIncrease ?? 0; break;
      case 'playerRate': goal = s.playerRate ?? 0; break;
      case 'playerRateInc': goal = s.playerRateIncrease ?? 0; break;
      case 'judgements': {
        const i = Math.min(5, Math.floor(this.pt() / 0.2));
        key += `/${i}`;
        goal = s.judgements[5 - i] ?? 0;
        break;
      }
      case 'conditions': {
        const i = Math.min(2, Math.floor(this.pt() / 0.2));
        key += `/${i}`;
        goal = s.conditions[i]!;
        break;
      }
    }
    if (key === this.countAudioKey) return;
    this.countAudioKey = key;
    this.audio.stopCount();
    if (goal > 0) this.audio.startCount();
  }

  private updateCountups(): void {
    const s = this.snapshot;
    if (!s) return;
    const pt = this.pt();
    const set = (path: string, value: string) => {
      const i = this.index.get(path);
      if (i !== undefined) this.textOverride.set(i, value);
    };
    switch (this.phase) {
      case 'score':
        set(P.scoreNumber, formatScore(countupValue(s.score, pt, 0.5)));
        break;
      case 'technical':
        set(P.technicalNumber, formatTechnical(countupValue(technicalGoal(s.technicalRaw, s.totalNoteCount), pt, 0.5)));
        break;
      case 'judgements': {
        const goals = [s.judgements[5] ?? 0, s.judgements[4] ?? 0, s.judgements[3] ?? 0, s.judgements[2] ?? 0, s.judgements[1] ?? 0, s.judgements[0] ?? 0];
        const idx = Math.min(goals.length, Math.floor(pt / 0.2));
        goals.forEach((goal, i) => {
          const v = i < idx ? goal : i === idx ? countupValue(goal, pt - i * 0.2, 0.2) : 0;
          set(P.judgementNumbers[i]!, String(v));
        });
        break;
      }
      case 'combo':
        this.setComboDigits(countupValue(s.userCombo, pt, 0.3));
        break;
      case 'conditions': {
        const idx = Math.min(3, Math.floor(pt / 0.2));
        s.conditions.forEach((goal, i) => {
          const v = i < idx ? goal : i === idx ? countupValue(goal, pt - i * 0.2, 0.2) : 0;
          set(P.conditionNumbers[i]!, String(v));
        });
        break;
      }
      case 'rate':
        set(P.rateNumber, String(countupValue(s.rate ?? 0, pt, 0.5)));
        break;
      case 'rateInc':
        set(P.rateIncrease, `(+${countupValue(s.rateIncrease ?? 0, pt, 0.5)})`);
        break;
      case 'playerRate':
        set(P.playerRateNumber, String(countupValue(s.playerRate ?? 0, pt, 0.5)));
        break;
      case 'playerRateInc':
        set(P.playerRateIncrease, `(+${countupValue(s.playerRateIncrease ?? 0, pt, 0.5)})`);
        break;
      default:
        break;
    }
  }

  /** 阶段切换前把当前计数推到目标值（原版序列 await 完成态）。 */
  private finalizePhase(phase: Phase): void {
    const s = this.snapshot;
    if (!s) return;
    const set = (path: string, value: string) => {
      const i = this.index.get(path);
      if (i !== undefined) this.textOverride.set(i, value);
    };
    switch (phase) {
      case 'score':
        set(P.scoreNumber, formatScore(s.score));
        break;
      case 'technical':
        set(P.technicalNumber, formatTechnical(technicalGoal(s.technicalRaw, s.totalNoteCount)));
        break;
      case 'judgements':
        set(P.judgementNumbers[0]!, String(s.judgements[5] ?? 0));
        set(P.judgementNumbers[1]!, String(s.judgements[4] ?? 0));
        set(P.judgementNumbers[2]!, String(s.judgements[3] ?? 0));
        set(P.judgementNumbers[3]!, String(s.judgements[2] ?? 0));
        set(P.judgementNumbers[4]!, String(s.judgements[1] ?? 0));
        set(P.judgementNumbers[5]!, String(s.judgements[0] ?? 0));
        break;
      case 'combo':
        this.setComboDigits(s.userCombo);
        break;
      case 'conditions':
        set(P.conditionNumbers[0]!, String(s.conditions[0]));
        set(P.conditionNumbers[1]!, String(s.conditions[1]));
        set(P.conditionNumbers[2]!, String(s.conditions[2]));
        break;
      case 'rate':
        set(P.rateNumber, String(s.rate ?? 0));
        break;
      case 'rateInc':
        set(P.rateIncrease, `(+${s.rateIncrease ?? 0})`);
        break;
      case 'playerRate':
        set(P.playerRateNumber, String(s.playerRate ?? 0));
        break;
      case 'playerRateInc':
        set(P.playerRateIncrease, `(+${s.playerRateIncrease ?? 0})`);
        break;
      case 'slides':
        for (const slide of this.slides) this.slideOverrides.set(slide.index, { x: slide.goalX, a: 1 });
        break;
      default:
        break;
    }
  }

  private applyFinalCountups(): void {
    this.finalizePhase('score');
    this.finalizePhase('technical');
    this.finalizePhase('judgements');
    this.finalizePhase('combo');
    this.finalizePhase('conditions');
    this.finalizePhase('rate');
    this.finalizePhase('rateInc');
    this.finalizePhase('playerRate');
    this.finalizePhase('playerRateInc');
    this.finalizePhase('slides');
  }

  /** CountupCombo：低位起逐位 v%10，rest=(int)(v/10)；高位无值隐藏（v≤0 只留个位 0）。 */
  private setComboDigits(value: number): void {
    let rest = Math.max(0, Math.trunc(value));
    for (let i = 0; i < 4; i++) {
      const node = this.index.get(P.digitPaths[i]!);
      if (node === undefined) continue;
      const show = i === 0 || rest > 0;
      if (!show) {
        this.spriteOverride.set(node, '');
        this.activeOverride.set(node, false);
        continue;
      }
      const digit = rest % 10;
      rest = Math.trunc(rest / 10);
      this.spriteOverride.set(node, `ui_sc2_ingame_num_combo_${digit}`);
      this.activeOverride.set(node, true);
    }
  }

  // ── 绘制 ───────────────────────────────────────────────────────
  private drawNode(ctx: Ctx, idx: number, fw: number, fh: number, rect?: Rect, paint = true): void {
    const node = this.nodes[idx]!;
    const customRank = node.path === P.rankIcon;
    const st = this.states[idx]!;
    let w: number;
    let h: number;
    let left: number;
    let top: number;
    if (rect) {
      ({ x: left, y: top, w, h } = rect);
    } else {
      w = (node.anchor[2] - node.anchor[0]) * fw + node.w;
      h = (node.anchor[3] - node.anchor[1]) * fh + node.h;
      left = node.anchor[0] * fw + st.x - node.pivot[0] * node.w;
      top = fh - (node.anchor[1] * fh + st.y - node.pivot[1] * node.h) - h;
    }
    // 画布 CSS 坐标（按钮命中用；祖先链没有旋转 / 缩放的非均匀变换）。
    const m = ctx.getTransform();
    const dpr = this.view.dpr || 1;
    this.cssRects[idx] = {
      x: (m.a * left + m.c * top + m.e) / dpr,
      y: (m.b * left + m.d * top + m.f) / dpr,
      w: (Math.hypot(m.a, m.b) * w) / dpr,
      h: (Math.hypot(m.c, m.d) * h) / dpr,
    };
    if (!st.active || (paint && st.a <= 0)) return;
    ctx.save();
    ctx.translate(left + node.pivot[0] * w, top + node.pivot[1] * h);
    if (node.rot) ctx.rotate(-node.rot);
    ctx.scale(st.sx, st.sy);
    ctx.translate(-node.pivot[0] * w, -node.pivot[1] * h);
    ctx.globalAlpha *= clamp01(st.a);
    if (!paint && this.particleHosts.has(node.path)) {
      this.particleMatrices.set(idx, ctx.getTransform().translate(w / 2, h / 2));
    }
    if (paint && w > 0 && h > 0) {
      if (customRank && this.snapshot) {
        drawRankBadge(ctx, rankBadgeOf(this.snapshot.scoreRank), 0, 0);
      } else {
        this.drawImage(ctx, idx, node, w, h, st);
      }
      this.drawText(ctx, idx, node, w, h, st);
    }
    if (customRank) {
      ctx.restore();
      return;
    }
    if (paint && node.mask && w > 0 && h > 0) {
      const radius = node.image && node.image.kind === 'rounded' ? node.image.radius : 0;
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, Math.max(0, radius));
      ctx.clip();
    }
    const kids = this.children[idx] ?? [];
    if (node.layout && kids.length) {
      this.drawLayoutChildren(ctx, node, kids, w, h, paint);
    } else {
      for (const k of kids) this.drawNode(ctx, k, w, h, undefined, paint);
    }
    ctx.restore();
  }

  private drawLayoutChildren(ctx: Ctx, node: ResultNode, kids: readonly number[], w: number, h: number, paint: boolean): void {
    const l = node.layout!;
    // Unity HorizontalLayoutGroup 只排激活子节点：CountupCombo 隐藏高位后剩下的数字要居中。
    kids = kids.filter((k) => this.states[k]!.active);
    if (!kids.length) return;
    const availW = w - l.padding[0] - l.padding[1];
    const availH = h - l.padding[2] - l.padding[3];
    const ownW = kids.map((k) => {
      const kn = this.nodes[k]!;
      return l.controlWidth ? 0 : (kn.anchor[2] - kn.anchor[0]) * w + kn.w;
    });
    const ownH = kids.map((k) => {
      const kn = this.nodes[k]!;
      return l.controlHeight ? 0 : (kn.anchor[3] - kn.anchor[1]) * h + kn.h;
    });
    const controlW = l.controlWidth && l.forceExpand ? (availW - l.spacing * (kids.length - 1)) / kids.length : 0;
    const totalW = l.controlWidth ? kids.length * controlW + l.spacing * (kids.length - 1) : ownW.reduce((a, b) => a + b, 0) + l.spacing * (kids.length - 1);
    const extraW = Math.max(0, availW - totalW);
    const alignH = l.align % 3;
    const offsetX = alignH === 1 ? extraW / 2 : alignH === 2 ? extraW : 0;
    const alignV = Math.floor(l.align / 3);
    let x = l.padding[0] + offsetX;
    kids.forEach((k, kIndex) => {
      const kw = l.controlWidth ? controlW : ownW[kIndex]!;
      const kh = l.controlHeight ? availH : ownH[kIndex]!;
      const y = alignV === 0 ? l.padding[2] : alignV === 2 ? h - l.padding[3] - kh : l.padding[2] + (availH - kh) / 2;
      this.drawNode(ctx, k, w, h, { x, y, w: kw, h: kh }, paint);
      x += kw + l.spacing;
    });
  }

  private drawImage(ctx: Ctx, idx: number, node: ResultNode, w: number, h: number, st: NodeState): void {
    const path = node.path;
    const override = this.spriteOverride.get(idx);
    if (override !== undefined) {
      if (override === '') return;
      const img = tintedSprite(`${SPRITE_BASE}${override}.png`, [st.r, st.g, st.b, 1]);
      if (!img) return;
      // SpriteRenderer 使用原生 90×120；节点变换已施加 prefab 的 0.8，得到 72×96。
      // RectTransform 的 64×85 只参与 HLG 排布。
      const combo = override.startsWith('ui_sc2_ingame_num_combo_');
      const dw = combo ? img.width : w;
      const dh = combo ? img.height : h;
      ctx.save();
      ctx.translate((w - dw) / 2, (h - dh) / 2);
      ctx.drawImage(img, 0, 0, dw, dh);
      ctx.restore();
      return;
    }
    if (path === P.bg) {
      if (this.background) ctx.drawImage(this.background, 0, 0, w, h);
      return;
    }
    if (path === P.jacket) {
      const url = this.snapshot?.jacketUrl;
      const img = url ? image(url) : null;
      if (img) ctx.drawImage(img, 0, 0, w, h);
      return;
    }
    const imageNode = node.image;
    if (!imageNode) return;
    const fill = this.fillOverride.get(idx);
    if (imageNode.kind === 'rounded') {
      const c = fill ?? [st.r, st.g, st.b];
      const radius = Math.max(0, Math.min(imageNode.radius, w / 2, h / 2));
      ctx.fillStyle = rgbaCss(c);
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, radius);
      // ProceduralImage 的 border / falloff：Shadow 这类节点靠边缘羽化才有投影感。
      if (imageNode.falloff > 0) {
        ctx.save();
        ctx.filter = `blur(${imageNode.falloff}px)`;
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fill();
      }
      return;
    }
    if (imageNode.kind === 'raw') return;
    if (!imageNode.sprite) {
      ctx.fillStyle = rgbaCss(fill ?? [st.r, st.g, st.b]);
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const img = tintedSprite(`${SPRITE_BASE}${imageNode.sprite}.png`, fill ?? [st.r, st.g, st.b, 1]);
    if (img) {
      ctx.save();
      let dw = w;
      let dh = h;
      if (imageNode.preserveAspect) {
        const k = Math.min(w / img.width, h / img.height);
        dw = img.width * k;
        dh = img.height * k;
        ctx.translate((w - dw) * node.pivot[0], (h - dh) * (1 - node.pivot[1]));
      }
      ctx.drawImage(img, 0, 0, dw, dh);
      ctx.restore();
    } else if (!ResultScreen.warned.has(imageNode.sprite)) {
      ResultScreen.warned.add(imageNode.sprite);
      console.warn(`[result-screen] 缺少贴图 ${imageNode.sprite}.png`);
    }
  }

  private drawText(ctx: Ctx, idx: number, node: ResultNode, w: number, h: number, st: NodeState): void {
    const text = node.text;
    if (!text) return;
    const value = this.textOverride.get(idx) ?? text.content;
    if (!value) return;
    const { size, spacing, lines } = layoutResultText(ctx, text, value, w, h);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const color = [st.r, st.g, st.b] as const;
    lines.forEach(({ runs, x: startX, y }) => {
      let x = startX;
      for (const run of runs) {
        const fill = run.color ? `rgba(${Math.round(run.color[0]! * 255)},${Math.round(run.color[1]! * 255)},${Math.round(run.color[2]! * 255)},1)` : rgbaCss(color);
        const drawRun = (draw: (chars: string, x: number, y: number) => void) => {
          if (spacing === 0) draw(run.text, x, y);
          else {
            let at = x;
            for (const char of run.text) {
              draw(char, at, y);
              at += ctx.measureText(char).width + spacing;
            }
          }
        };
        if (text.material === 'EBNomalTextWithShadow') {
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.45)';
          ctx.shadowBlur = Math.max(2, size * 0.08);
          ctx.shadowOffsetY = size * 0.05;
          ctx.fillStyle = fill;
          drawRun((chars, at, baseline) => ctx.fillText(chars, at, baseline));
          ctx.restore();
        }
        if (text.material === 'OutLineWhite') {
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(2, size * 0.14);
          ctx.strokeStyle = '#fff';
          drawRun((chars, at, baseline) => ctx.strokeText(chars, at, baseline));
        }
        ctx.fillStyle = fill;
        // TMP 的 SDF 材质比 canvas 填充略粗；用同色描边模拟 face dilate。
        // 段位字母（EBNomalTextWithShadow）在原版里明显更重，描边加粗到 0.05em。
        if (text.material !== 'OutLineWhite') {
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(0.5, size * (text.material === 'EBNomalTextWithShadow' ? 0.08 : 0.012));
          ctx.strokeStyle = fill;
          drawRun((chars, at, baseline) => ctx.strokeText(chars, at, baseline));
        }
        drawRun((chars, at, baseline) => ctx.fillText(chars, at, baseline));
        x += spacing === 0 ? ctx.measureText(run.text).width
          : Array.from(run.text).reduce((sum, char) => sum + ctx.measureText(char).width + spacing, 0);
      }
    });
  }

  private drawParticles(ctx: Ctx, aboveUi: boolean): void {
    const emitters = this.playbacks.flatMap((pb) => pb.emitters)
      .filter((ep) => resultParticleAboveUi(ep.e) === aboveUi)
      .sort((a, b) => a.e.sortLayer - b.e.sortLayer || a.e.sort - b.e.sort);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const ep of emitters) {
      const matrix = this.particleMatrices.get(ep.host);
      if (!matrix) continue;
      ctx.setTransform(matrix);
      for (const p of ep.parts) {
        const f = resultParticleAt(ep.e, p, this.t);
        if (!f || f.a <= 0 || f.w <= 0 || f.h <= 0) continue;
        const img = particleImage(ep.e.tex, f.r, f.g, f.b);
        if (!img) continue;
        ctx.save();
        ctx.translate(f.x, -f.y);
        ctx.rotate(-f.rotation);
        // ParticleSystemRenderer 独立于 Graphic / CanvasGroup 的 alpha。
        ctx.globalAlpha = clamp01(f.a);
        ctx.drawImage(img, -f.w / 2, -f.h / 2, f.w, f.h);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawExitButton(ctx: Ctx, designW: number, designH: number): void {
    if (!this.finished) {
      this.hit.exit = null;
      return;
    }
    const w = EXIT_BUTTON.w;
    const h = EXIT_BUTTON.h;
    const cx = designW / 2 + EXIT_BUTTON.x;
    const cy = designH / 2 - EXIT_BUTTON.y;
    const x = cx - w / 2;
    const y = cy - h / 2;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 3, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = '#696365';
    ctx.font = hudFont(700, 26);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('退出游玩', cx, cy + 1);
    ctx.restore();
    this.hit.exit = {
      x: (x - 3) * this.k,
      y: (y - 3) * this.k,
      w: (w + 6) * this.k,
      h: (h + 6) * this.k,
    };
  }

  private ensureBackground(designW: number, designH: number): void {
    // 原版背景取出战卡组中心卡卡面（Model ctor @0x46F8A60）；预览使用深色渐变。
    const width = Math.max(1, Math.round(designW));
    const height = Math.max(1, Math.round(designH));
    if (this.background?.width === width && this.background.height === height) return;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const g = c.getContext('2d');
    if (!g) return;
    const base = g.createLinearGradient(0, 0, 0, c.height);
    base.addColorStop(0, '#1a1c2a');
    base.addColorStop(0.55, '#12131c');
    base.addColorStop(1, '#0a0a10');
    g.fillStyle = base;
    g.fillRect(0, 0, c.width, c.height);
    const glow = g.createRadialGradient(
      c.width / 2, c.height * 0.42, Math.min(c.width, c.height) * 0.08,
      c.width / 2, c.height * 0.42, Math.max(c.width, c.height) * 0.62,
    );
    glow.addColorStop(0, 'rgba(120,110,170,0.22)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, c.width, c.height);
    const vignette = g.createRadialGradient(
      c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.25,
      c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.72,
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, c.width, c.height);
    this.background = c;
  }
}

function rankBadgeOf(rank: number): RankBadge {
  switch (Math.trunc(rank)) {
    case 1: return 'C';
    case 2: return 'B';
    case 3: return 'A';
    case 4: return 'S';
    default: return 'none';
  }
}
