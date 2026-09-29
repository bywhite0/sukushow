/**
 * 预览窗口固定比例（顶栏按钮组）。
 *
 * 游戏本体横屏运行，这里的比例都是「宽:高」。选「自由」时舞台撑满预览区；
 * 选定比例时按预览区可用空间取最大的该比例矩形并居中。HUD / 渲染器 / 过场
 * 都通过 ResizeObserver 监听舞台尺寸，改舞台宽高即可带动它们重新布局。
 */

export const ASPECT_PRESETS = [
  { id: 'free', label: '自由', ratio: null, hint: '跟随窗口' },
  { id: '16:9', label: '16:9', ratio: 16 / 9, hint: '非全面屏手机' },
  { id: '19.5:9', label: '19.5:9', ratio: 19.5 / 9, hint: '全面屏手机（iPhone 等）' },
  { id: '20:9', label: '20:9', ratio: 20 / 9, hint: '全面屏手机（多数安卓）' },
  { id: '16:10', label: '16:10', ratio: 16 / 10, hint: '安卓平板' },
  { id: '4:3', label: '4:3', ratio: 4 / 3, hint: 'iPad' },
] as const;

export type AspectId = (typeof ASPECT_PRESETS)[number]['id'];

export const DEFAULT_ASPECT: AspectId = 'free';

export function isAspectId(v: unknown): v is AspectId {
  return ASPECT_PRESETS.some((p) => p.id === v);
}

export function aspectRatioOf(id: AspectId): number | null {
  return ASPECT_PRESETS.find((p) => p.id === id)?.ratio ?? null;
}

/** 在 w×h 的可用区域内放下比例为 ratio 的最大矩形（向下取整到整像素）。 */
export function fitAspect(w: number, h: number, ratio: number): { width: number; height: number } {
  if (!(w > 0) || !(h > 0) || !(ratio > 0)) return { width: 0, height: 0 };
  if (w / h > ratio) {
    const height = Math.floor(h);
    return { width: Math.floor(height * ratio), height };
  }
  const width = Math.floor(w);
  return { width, height: Math.floor(width / ratio) };
}

export interface AspectPicker {
  root: HTMLDivElement;
  value: () => AspectId;
  set: (id: AspectId, notify?: boolean) => void;
}

/** 按钮组，样式与难度徽章同源（.difficulty-chip 的规格，文字宽度自适应）。 */
export function createAspectPicker(opts: { value: AspectId; onChange: (id: AspectId) => void }): AspectPicker {
  const root = document.createElement('div');
  root.className = 'aspect-group';
  root.setAttribute('role', 'radiogroup');
  root.setAttribute('aria-label', '预览比例');
  let current = opts.value;
  const buttons = ASPECT_PRESETS.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'aspect-chip';
    b.dataset.aspect = p.id;
    b.textContent = p.label;
    b.title = `${p.label} · ${p.hint}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `${p.label}（${p.hint}）`);
    b.onclick = () => set(p.id, true);
    return b;
  });
  root.append(...buttons);
  function render() {
    for (const b of buttons) {
      const on = b.dataset.aspect === current;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }
  function set(id: AspectId, notify = false) {
    if (id === current) return;
    current = id;
    render();
    if (notify) opts.onChange(id);
  }
  // 单选组的方向键切换。
  root.addEventListener('keydown', (e) => {
    const i = ASPECT_PRESETS.findIndex((p) => p.id === current);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = ASPECT_PRESETS[(i + step + ASPECT_PRESETS.length) % ASPECT_PRESETS.length]!;
    set(next.id, true);
    buttons.find((b) => b.dataset.aspect === next.id)?.focus();
  });
  render();
  return { root, value: () => current, set };
}

/**
 * 让 stage 在 shell 里保持比例。返回更新函数；ratio 为 null 时清掉内联尺寸，回到 CSS 的撑满。
 */
export function bindStageAspect(shell: HTMLElement, stage: HTMLElement): (id: AspectId) => void {
  let ratio: number | null = null;
  const apply = () => {
    if (ratio === null) {
      stage.style.width = '';
      stage.style.height = '';
      stage.style.flex = '';
      delete stage.dataset.aspect;
      return;
    }
    const cs = getComputedStyle(shell);
    const w = shell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = shell.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const fit = fitAspect(w, h, ratio);
    stage.style.width = `${fit.width}px`;
    stage.style.height = `${fit.height}px`;
    stage.style.flex = '0 0 auto';
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(apply).observe(shell);
  return (id) => {
    ratio = aspectRatioOf(id);
    if (ratio !== null) stage.dataset.aspect = id;
    apply();
  };
}
