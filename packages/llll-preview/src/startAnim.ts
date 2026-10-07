/**
 * 开场过场 RhythmGameStart（level56 GO 349，Canvas sortingOrder 30，盖在 HUD 之上）。
 *
 * 时序：MainLogicResolver.ReadyAsync 先播 se_rhythm_start_0001，再 await
 * StartAnimationResolver.ShowAsync（animator.speed=1 → SetActive(true) → 等
 * normalizedTime ≥ 1 → SetActive(false)），之后才 bgm.Play。开局没有 3-2-1 倒数
 * （Countdown 只用于暂停恢复）。
 *
 * Inject：ColorPreset.GetDifficultyColor 染 difficultyImages
 * （DifficultyColor 底 + 曲绘右 / 下两条强调条），难度名 ToUpper 写入 DifficultyName，
 * 曲绘 image_music_thumbnail_{id:D6} 进 RawImage，曲名写入 ScoreLabel。
 *
 * 布局取 level56 RectTransform / ProceduralImage / RectMask2D 序列化值（1920×1080 参考分辨率，
 * 与 HUD 同一 CanvasScaler 缩放）。uGUI 的 Graphic.color.a 不向子节点相乘，
 * 所以这里各层 alpha 只落在自身的填充色 / 文字色 / 叶子图片上，不用会级联的 CSS opacity 包父节点。
 */
import { hudScale } from './hud';
import { type Ctx, drawText, fillRoundRect, image, preloadImages } from './canvasKit';
import { START_CLIP_CURVES, START_CLIP_DURATION, type ClipKey, type StartCurveName } from './startAnimClip';

export { START_CLIP_DURATION };

/** 导出时间轴上写死的开场区间：开场过场占走带时间轴的 [−START_CLIP_DURATION, 0)。 */
export const EXPORT_OPENING = { startSec: -START_CLIP_DURATION, endSec: 0 } as const;

/**
 * 0 秒待机显示的静止帧（秒）。clip 1.75–3.0 s 所有曲线静止（描边条到位、全员不透明），
 * 取其起点；原版过场之后再无 HUD 入场动画，HUD 在 3.0–3.667 s 的整体淡出中露出。
 */
export const START_IDLE_TIME = 1.75;

export const START_BASE01_URL = '/rg/sprites/ui_sc2_result_base_01.png';

/** ColorPreset.GetDifficultyColor（表 @0x1AA4430）。 */
export const DIFFICULTY_COLORS: Record<string, readonly [number, number, number]> = {
  NORMAL: [0x36, 0xd6, 0xe0],
  HARD: [0xff, 0xb3, 0x2f],
  EXPERT: [0xfd, 0x5b, 0x91],
  MASTER: [0x93, 0x70, 0xd5],
};

/** DifficultyRoot m_Color（常量绑定，灰紫描边）。 */
const RIM_RGB = [0.6078431606292725, 0.5686274766921997, 0.6823529601097107].map((v) => Math.round(v * 255));

export type StartAnimationInfo = {
  title: string;
  difficulty: string | null;
  jacketUrl: string | null;
};

/** 在单条流式曲线上取值：t 落在 [key_i, key_i+1) 用 key_i 的三次系数；末键之后保持末键常数。 */
export function sampleCurve(keys: readonly ClipKey[], t: number): number {
  let k = keys[0]!;
  for (const key of keys) {
    if (key[0] <= t) k = key;
    else break;
  }
  const u = t - k[0];
  return ((k[1] * u + k[2]) * u + k[3]) * u + k[4];
}

export type StartFrame = Record<StartCurveName, number>;

export function sampleStartClip(t: number): StartFrame {
  const time = Math.max(0, Math.min(START_CLIP_DURATION, t));
  const out = {} as StartFrame;
  for (const name of Object.keys(START_CLIP_CURVES) as StartCurveName[]) {
    out[name] = sampleCurve(START_CLIP_CURVES[name], time);
  }
  return out;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const rgba = (rgb: readonly number[], a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp01(a).toFixed(4)})`;

/** [x0, y0, x1, y1]，jacket 局部坐标（576 方框左上为原点，y 向下）。 */
export type DotRect = readonly [number, number, number, number];
/**
 * DotOutlineMask 下两块 RectMask：MaskRight x 576–606 / y 30–606，MaskBtm x 30–576 / y 576–606。
 * 两者贴封面的内缘各多伸 1px 到封面下，避免与封面边缘之间出现抗锯齿缝。
 */
export const DOT_MASK_RIGHT: DotRect = [575, 30, 606, 606];
export const DOT_MASK_BTM: DotRect = [30, 575, 576, 606];

function intersect(a: DotRect, b: DotRect): DotRect | null {
  const r: DotRect = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[2] > r[0] && r[3] > r[1] ? r : null;
}

/** 两根点缀条（right 50×576 右对齐 / btm 596×50 左对齐）平移后经各自遮罩裁切的可见矩形。 */
export function dotOutlineRects(f: StartFrame): DotRect[] {
  const right: DotRect = [556 + f.right_x, 30 - f.right_y, 606 + f.right_x, 606 - f.right_y];
  const btm: DotRect = [30 + f.btm_x, 556 - f.btm_y, 626 + f.btm_x, 606 - f.btm_y];
  return [intersect(right, DOT_MASK_RIGHT), intersect(btm, DOT_MASK_BTM)].filter((r): r is DotRect => r !== null);
}

export function dotOutlinePath(f: StartFrame): string {
  const n = (v: number) => +v.toFixed(3);
  return dotOutlineRects(f).map(([x0, y0, x1, y1]) => `M${n(x0)} ${n(y0)}H${n(x1)}V${n(y1)}H${n(x0)}Z`).join('');
}

/** 过场画到的视口（与 HUD 相同）。 */
export type StartView = { cssW: number; cssH: number; dpr: number };

export class StartAnimation {
  private color: readonly [number, number, number] = DIFFICULTY_COLORS.MASTER!;
  private info: StartAnimationInfo = { title: '', difficulty: null, jacketUrl: null };
  private diffName = 'MASTER';
  /** 当前显示：null = 隐藏，'idle' = 起点待机静止帧，数字 = clip 时刻（秒）。 */
  private shown: number | 'idle' | null = null;

  constructor() {
    void preloadImages([START_BASE01_URL]);
    this.setInfo({ title: '', difficulty: null, jacketUrl: null });
  }

  setInfo(info: StartAnimationInfo): void {
    const key = (info.difficulty ?? 'MASTER').toUpperCase();
    this.color = DIFFICULTY_COLORS[key] ?? DIFFICULTY_COLORS.MASTER!;
    this.diffName = key;
    this.info = { ...info };
    if (info.jacketUrl) void preloadImages([info.jacketUrl]);
  }

  /** 曲名 / 难度名 / 封面（测试与调试用）。 */
  get current(): { title: string; difficulty: string; jacketUrl: string | null } {
    return { title: this.info.title, difficulty: this.diffName, jacketUrl: this.info.jacketUrl };
  }

  get idling(): boolean {
    return this.shown === 'idle';
  }

  get visible(): boolean {
    return this.shown !== null;
  }

  /** 'idle' / 'playing' / null（隐藏）。 */
  get state(): 'idle' | 'playing' | null {
    return this.shown === null ? null : this.shown === 'idle' ? 'idle' : 'playing';
  }

  /** 当前显示的 clip 时刻（秒）；隐藏时为 null。 */
  get clipTime(): number | null {
    return this.shown === null ? null : this.shown === 'idle' ? START_IDLE_TIME : this.shown;
  }

  /**
   * 由走带时间驱动（过场计入进度条 [−START_CLIP_DURATION, 0)）：
   * 'idle' = 停在起点未播放时的待机静止帧；数字 = clip 时刻；null 或 ≥ 时长 = 隐藏。
   */
  show(frame: number | 'idle' | null): void {
    if (typeof frame === 'number' && !(frame >= 0 && frame < START_CLIP_DURATION)) frame = null;
    this.shown = frame;
  }

  /**
   * 画当前帧（盖在 HUD 之上）。坐标 = level56 RectTransform，原点为画面中心、y 向下，
   * 按 HUD 同一 hudScale 缩放。uGUI 的 Graphic.color.a 不向子节点相乘，
   * 所以各层 alpha 只落在自身的填充色 / 文字色 / 叶子图片上。
   */
  draw(ctx: Ctx, view: StartView): void {
    const t = this.clipTime;
    if (t === null) return;
    const f = sampleStartClip(t);
    const c = this.color;
    const pw = view.cssW * view.dpr, ph = view.cssH * view.dpr;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgba([0, 0, 0], f.bg_a);
    ctx.fillRect(0, 0, pw, ph);
    const k = hudScale(view.cssW, view.cssH) * view.dpr;
    ctx.setTransform(k, 0, 0, k, pw / 2, ph / 2);
    // DifficultyRoot (0,384) 236×72，三层圆角（r=50，按边长钳制），逐层 inset 4
    fillRoundRect(ctx, -118, -420, 236, 72, 50, rgba(RIM_RGB, f.difficultyRoot_a));
    fillRoundRect(ctx, -114, -416, 228, 64, 50, rgba([255, 255, 255], f.white_a));
    fillRoundRect(ctx, -110, -412, 220, 56, 50, rgba(c, f.difficultyColor_a));
    // Base01：anchor/pivot (0.5,0)，218×36，贴 DifficultyColor 底边；不受圆角裁切
    const base01 = image(START_BASE01_URL);
    if (base01 && f.base01_a > 0) {
      ctx.globalAlpha = clamp01(f.base01_a);
      ctx.drawImage(base01, -110 + 2, -412 + 20, 218, 36);
      ctx.globalAlpha = 1;
    }
    // DifficultyName：EB 32，居中，characterSpacing −1
    drawText(ctx, this.diffName, { size: 32, weight: 800, color: rgba([255, 255, 255], f.difficultyName_a), letterSpacing: -0.32 },
      -110, -412, 220, 56);
    // Jacket 框 (0,22) 576×576：点缀条（按遮罩裁出的矩形合成一条路径）在下，封面在上
    const jx = -288, jy = -310;
    const rects = dotOutlineRects(f);
    if (rects.length && f.right_a > 0) {
      ctx.beginPath();
      for (const [x0, y0, x1, y1] of rects) ctx.rect(jx + x0, jy + y0, x1 - x0, y1 - y0);
      ctx.fillStyle = rgba(c, f.right_a);
      ctx.fill();
    }
    const jacket = this.info.jacketUrl ? image(this.info.jacketUrl) : null;
    if (jacket && f.jacket_a > 0) {
      ctx.globalAlpha = clamp01(f.jacket_a);
      ctx.drawImage(jacket, jx, jy, 576, 576);
      ctx.globalAlpha = 1;
    }
    // ScoreLabel (0,−387) 1200×64：RODIN B 40，居中，characterSpacing −3.5
    drawText(ctx, this.info.title, { size: 40, weight: 700, color: rgba([255, 255, 255], f.scoreLabel_a), letterSpacing: -1.4 },
      -600, 355, 1200, 64);
    ctx.restore();
  }

  dispose(): void {
    this.shown = null;
  }
}
