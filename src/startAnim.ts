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

export class StartAnimation {
  readonly root: HTMLDivElement;
  private readonly logic: HTMLDivElement;
  private readonly bg: HTMLDivElement;
  private readonly diffRoot: HTMLDivElement;
  private readonly white: HTMLDivElement;
  private readonly diffColor: HTMLDivElement;
  private readonly base01: HTMLImageElement;
  private readonly diffName: HTMLDivElement;
  private readonly right: HTMLDivElement;
  private readonly btm: HTMLDivElement;
  private readonly jacket: HTMLImageElement;
  private readonly title: HTMLDivElement;
  private readonly resize: ResizeObserver | null;
  private color: readonly [number, number, number] = DIFFICULTY_COLORS.MASTER!;
  private hasJacket = false;
  private raf = 0;
  private finish: ((done: boolean) => void) | null = null;

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
    const maskRight = div('sa-mask-right', jacketBox);
    this.right = div('sa-right', maskRight);
    const maskBtm = div('sa-mask-btm', jacketBox);
    this.btm = div('sa-btm', maskBtm);
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
    this.right.style.backgroundColor = rgba(c, f.right_a);
    this.right.style.transform = `translate(${f.right_x}px,${-f.right_y}px)`;
    this.btm.style.backgroundColor = rgba(c, f.btm_a);
    this.btm.style.transform = `translate(${f.btm_x}px,${-f.btm_y}px)`;
    this.title.style.color = rgba([255, 255, 255], f.scoreLabel_a);
  }

  /**
   * 播放整段过场（真实时间，animator.speed = 1，不随播放倍率）。
   * 播完返回 true；被 cancel() 打断返回 false。
   */
  play(now: () => number = () => performance.now() / 1000): Promise<boolean> {
    this.cancel();
    const t0 = now();
    this.root.hidden = false;
    this.layout();
    this.renderAt(0);
    return new Promise<boolean>((resolve) => {
      this.finish = (done) => {
        cancelAnimationFrame(this.raf);
        this.finish = null;
        this.root.hidden = true;
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

  dispose(): void {
    this.cancel();
    this.resize?.disconnect();
    this.root.remove();
  }
}
