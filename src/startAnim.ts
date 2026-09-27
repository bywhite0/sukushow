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
import { START_CLIP_CURVES, START_CLIP_DURATION, type ClipKey, type StartCurveName } from './startAnimClip';

export { START_CLIP_DURATION };

/**
 * 0 秒待机显示的静止帧（秒）。clip 1.75–3.0 s 所有曲线静止（描边条到位、全员不透明），
 * 取其起点；原版过场之后再无 HUD 入场动画，HUD 在 3.0–3.667 s 的整体淡出中露出。
 */
export const START_IDLE_TIME = 1.75;

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

function div(className: string, parent?: HTMLElement): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  parent?.append(node);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

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

export class StartAnimation {
  readonly root: HTMLDivElement;
  private readonly logic: HTMLDivElement;
  private readonly bg: HTMLDivElement;
  private readonly diffRoot: HTMLDivElement;
  private readonly white: HTMLDivElement;
  private readonly diffColor: HTMLDivElement;
  private readonly base01: HTMLImageElement;
  private readonly diffName: HTMLDivElement;
  private readonly dotPath: SVGPathElement;
  private readonly jacket: HTMLImageElement;
  private readonly title: HTMLDivElement;
  private readonly resize: ResizeObserver | null;
  private color: readonly [number, number, number] = DIFFICULTY_COLORS.MASTER!;
  private hasJacket = false;
  private raf = 0;
  private finish: ((done: boolean) => void) | null = null;
  private idle = false;

  constructor(private readonly stage: HTMLElement) {
    this.root = div('start-anim');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.hidden = true;
    this.bg = div('sa-bg', this.root);
    this.logic = div('sa-logic', this.root);

    this.diffRoot = div('sa-diff-root', this.logic);
    this.white = div('sa-white', this.diffRoot);
    this.diffColor = div('sa-diff-color', this.white);
    this.base01 = document.createElement('img');
    this.base01.className = 'sa-base01';
    this.base01.alt = '';
    this.base01.src = '/rg/sprites/ui_sc2_result_base_01.png';
    this.diffColor.append(this.base01);
    this.diffName = div('sa-diff-name', this.diffColor);

    const jacketBox = div('sa-jacket', this.logic);
    // right/btm 两条：按各自 RectMask 裁出可见矩形后合成一条 SVG 路径一次填充，
    // 拼接边在同一路径内抵消，不会出现两层抗锯齿叠加的亮线/色点。
    const dots = document.createElementNS(SVG_NS, 'svg');
    dots.setAttribute('class', 'sa-dots');
    dots.setAttribute('viewBox', '0 0 606 606');
    dots.setAttribute('aria-hidden', 'true');
    this.dotPath = document.createElementNS(SVG_NS, 'path');
    dots.append(this.dotPath);
    jacketBox.append(dots);
    this.jacket = document.createElement('img');
    this.jacket.className = 'sa-jacket-image';
    this.jacket.alt = '';
    this.jacket.decoding = 'async';
    jacketBox.append(this.jacket);

    this.title = div('sa-title', this.logic);
    stage.append(this.root);

    this.resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.layout());
    this.resize?.observe(stage);
    this.layout();
    this.setInfo({ title: '', difficulty: null, jacketUrl: null });
  }

  get active(): boolean {
    return this.finish !== null;
  }

  setInfo(info: StartAnimationInfo): void {
    const key = (info.difficulty ?? 'MASTER').toUpperCase();
    this.color = DIFFICULTY_COLORS[key] ?? DIFFICULTY_COLORS.MASTER!;
    this.diffName.textContent = key;
    this.title.textContent = info.title;
    this.hasJacket = Boolean(info.jacketUrl);
    if (info.jacketUrl) this.jacket.src = info.jacketUrl;
    else this.jacket.removeAttribute('src');
    this.jacket.hidden = !this.hasJacket;
    if (this.idle) this.renderAt(START_IDLE_TIME);
  }

  get idling(): boolean {
    return this.idle;
  }

  /** 0 秒待机：显示过场静止帧盖住 HUD；播放中调用无效。 */
  setIdle(on: boolean): void {
    if (this.active || on === this.idle) return;
    this.idle = on;
    this.root.hidden = !on;
    if (on) {
      this.root.dataset.state = 'idle';
      this.layout();
      this.renderAt(START_IDLE_TIME);
    } else delete this.root.dataset.state;
  }

  private layout(): void {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.logic.style.transform = `scale(${hudScale(w, h)})`;
  }

  /** 按 clip 时刻写一帧（秒）。 */
  renderAt(t: number): void {
    const f = sampleStartClip(t);
    const c = this.color;
    this.bg.style.backgroundColor = rgba([0, 0, 0], f.bg_a);
    this.diffRoot.style.backgroundColor = rgba(RIM_RGB, f.difficultyRoot_a);
    this.white.style.backgroundColor = rgba([255, 255, 255], f.white_a);
    this.diffColor.style.backgroundColor = rgba(c, f.difficultyColor_a);
    this.base01.style.opacity = clamp01(f.base01_a).toFixed(4);
    this.diffName.style.color = rgba([255, 255, 255], f.difficultyName_a);
    this.jacket.style.opacity = clamp01(f.jacket_a).toFixed(4);
    // anchoredPosition 为 y 向上；DOM y 向下。
    this.dotPath.setAttribute('d', dotOutlinePath(f));
    this.dotPath.setAttribute('fill', `rgb(${c[0]},${c[1]},${c[2]})`);
    this.dotPath.setAttribute('fill-opacity', clamp01(f.right_a).toFixed(4));
    this.title.style.color = rgba([255, 255, 255], f.scoreLabel_a);
  }

  /**
   * 播放整段过场（真实时间，animator.speed = 1，不随播放倍率）。
   * 播完返回 true；被 cancel() 打断返回 false。
   */
  play(now: () => number = () => performance.now() / 1000): Promise<boolean> {
    this.cancel();
    const t0 = now();
    this.idle = false;
    this.root.dataset.state = 'playing';
    this.root.hidden = false;
    this.layout();
    this.renderAt(0);
    return new Promise<boolean>((resolve) => {
      this.finish = (done) => {
        cancelAnimationFrame(this.raf);
        this.finish = null;
        this.root.hidden = true;
        delete this.root.dataset.state;
        resolve(done);
      };
      const step = () => {
        const t = now() - t0;
        if (t >= START_CLIP_DURATION) {
          this.renderAt(START_CLIP_DURATION);
          this.finish?.(true);
          return;
        }
        this.renderAt(t);
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  cancel(): void {
    this.finish?.(false);
  }

  /** 跳过过场：立即结束并按「播完」返回 true，调用方随即开播。 */
  skip(): void {
    this.finish?.(true);
  }

  dispose(): void {
    this.cancel();
    this.resize?.disconnect();
    this.root.remove();
  }
}
