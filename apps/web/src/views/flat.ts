/** 平面谱面工作台适配：只负责把 flat renderer 接到统一前端。 */

import './flat.css';

import { type Chart, decodeChart } from '../../../flat-preview/src/chart';
import { FlatRenderer, loadSprites, noteLabel } from '../../../flat-preview/src/renderer';
import { type Layout, defaultLayout, scrollToLine, yTime } from '../../../flat-preview/src/view';
import { findSong } from '../../../llll-preview/src/songAssets';
import type { SongSelectionStore } from '../songSelection';

export interface FlatMountOptions {
  /** 统一前端为当前模式分配的根节点。 */
  root: HTMLElement;
  /** 可选：统一工具栏中的文件按钮挂载点。未传时放入右侧检查器。 */
  toolbar?: HTMLElement;
  /** 统一壳层持有的曲目与难度选择状态。 */
  songSelection: SongSelectionStore;
  /** 音符贴图根路径。 */
  spriteBase?: string;
}

export interface FlatViewController {
  load(bytes: Uint8Array, name: string): Promise<void>;
  dispose(): void;
}

const mounts = new WeakMap<HTMLElement, FlatViewController>();

const template = `
  <main class="flat-view" data-view="flat">
    <section class="viewer flat-viewer" aria-label="平面谱面预览">
      <div class="preview-heading flat-preview-heading">
        <div class="current-file"><span class="section-label">当前谱面</span><h1 id="chart-name">尚未载入</h1></div>
      </div>
      <div class="stage-shell flat-stage-shell">
        <div class="stage flat-stage" id="stage">
          <canvas id="canvas" aria-label="平面谱面画布"></canvas>
          <div id="judgement-line" class="flat-judgement-line" aria-hidden="true"></div>
          <div id="empty" class="empty flat-empty">
            <p>拖入谱面文件，或在设置中导入谱面。</p>
            <p class="hint">支持原格式 JSON 与 raw-deflate <code>.bytes</code>；文件不上传。</p>
          </div>
        </div>
      </div>
      <div id="status" class="viewer-status flat-status" role="status" aria-live="polite">未载入谱面</div>
      <div class="transport flat-transport">
        <label class="sr-only" for="timeline">播放进度</label>
        <input id="timeline" type="range" min="0" max="0" step="0.001" value="0">
        <div class="transport-row">
          <button id="play" class="primary" type="button" aria-label="播放">▶ 播放</button>
          <button id="restart" class="quiet" type="button" aria-label="回到开头">↺ 重播</button>
          <output id="time">00:00.000 / 00:00.000</output>
          <label class="rate-label">播放倍率
            <select id="rate">
              <option value="0.5">0.5×</option><option value="0.75">0.75×</option>
              <option value="1" selected>1×</option><option value="1.25">1.25×</option>
              <option value="1.5">1.5×</option><option value="2">2×</option>
            </select>
          </label>
        </div>
      </div>
    </section>
    <aside class="flat-inspector" aria-label="平面谱面设置">
      <div class="inspector-heading"><h2>平面谱面</h2><span>本地解析 · Canvas</span></div>
      <div class="settings-body flat-settings-body">
        <fieldset class="flat-file-field"><legend>导入</legend><div class="flat-file-slot"></div></fieldset>
        <fieldset><legend>视图</legend>
          <label>纵向缩放 <input id="zoom" type="range" min="20" max="2400" step="5" value="90"><output id="zoom-out">90 px/s</output></label>
          <label>轨道宽度 <input id="lane" type="range" min="4" max="40" step="1" value="14"><output id="lane-out">14 px</output></label>
          <label>音符厚度 <input id="thick" type="range" min="2" max="16" step="1" value="6"><output id="thick-out">6 px</output></label>
          <label>定位到 <input id="goto" type="number" min="0" step="0.1" value="0"><output id="goto-out">秒</output></label>
          <label class="check"><input id="grid" type="checkbox" checked>轨道格线</label>
          <label class="check"><input id="measure" type="checkbox" checked>小节线</label>
          <label class="check"><input id="simul" type="checkbox" checked>同时押连线</label>
          <label class="check"><input id="mirror" type="checkbox">左右镜像</label>
        </fieldset>
        <fieldset><legend>谱面</legend><dl id="meta"><dt>—</dt><dd>尚未导入</dd></dl></fieldset>
        <fieldset><legend>悬停</legend><p id="probe" class="probe">把鼠标移到音符上</p></fieldset>
      </div>
      <div class="inspector-footer flat-inspector-footer">设置仅影响预览，不会修改源文件。</div>
    </aside>
  </main>
`;

function query<T extends HTMLElement>(root: HTMLElement, id: string): T {
  const node = root.querySelector<HTMLElement>(`#${id}`);
  if (!node) throw new Error(`缺少元素 #${id}`);
  return node as T;
}

function createFileControl(): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'flat-file file-action';
  label.textContent = '导入谱面';
  const input = document.createElement('input');
  input.id = 'file';
  input.type = 'file';
  input.accept = '.json,.bytes,application/json';
  label.append(input);
  return label;
}

export function mount(options: FlatMountOptions): FlatViewController {
  const existing = mounts.get(options.root);
  if (existing) return existing;

  const root = options.root;
  root.replaceChildren();
  root.insertAdjacentHTML('beforeend', template);

  if (options.toolbar) root.querySelector<HTMLElement>('.flat-file-field')?.remove();
  const sharedInput = options.toolbar?.querySelector<HTMLInputElement>('#chart-file') ?? null;
  let fileControl: HTMLLabelElement | null = null;
  let fileInput: HTMLInputElement;
  const fileInputs: HTMLInputElement[] = [];
  if (sharedInput) {
    fileInput = sharedInput;
    // 保留旧版 flat 入口的不可见兼容节点，让已有本地导入入口继续可用。
    const compatibilityInput = document.createElement('input');
    compatibilityInput.id = 'file';
    compatibilityInput.className = 'sr-only';
    compatibilityInput.type = 'file';
    compatibilityInput.accept = '.json,.bytes,application/json';
    root.append(compatibilityInput);
    fileInputs.push(compatibilityInput);
  } else {
    const fileHost = root.querySelector<HTMLElement>('.flat-file-slot');
    if (!fileHost) throw new Error('缺少平面谱面文件控件挂载点。');
    fileControl = createFileControl();
    fileHost.append(fileControl);
    fileInput = fileControl.querySelector('input')!;
  }
  fileInputs.push(fileInput);

  const canvas = query<HTMLCanvasElement>(root, 'canvas');
  const stage = query<HTMLDivElement>(root, 'stage');
  const judgementLine = query<HTMLDivElement>(root, 'judgement-line');
  const empty = query<HTMLDivElement>(root, 'empty');
  const status = query<HTMLDivElement>(root, 'status');
  const probe = query<HTMLParagraphElement>(root, 'probe');
  const meta = query<HTMLDListElement>(root, 'meta');
  const chartName = query<HTMLHeadingElement>(root, 'chart-name');
  const zoom = query<HTMLInputElement>(root, 'zoom');
  const lane = query<HTMLInputElement>(root, 'lane');
  const thick = query<HTMLInputElement>(root, 'thick');
  const goto = query<HTMLInputElement>(root, 'goto');
  const timeline = query<HTMLInputElement>(root, 'timeline');
  const play = query<HTMLButtonElement>(root, 'play');
  const restart = query<HTMLButtonElement>(root, 'restart');
  const timeOutput = query<HTMLOutputElement>(root, 'time');
  const rate = query<HTMLSelectElement>(root, 'rate');
  const output = (id: string) => query<HTMLOutputElement>(root, id);

  let renderer: FlatRenderer;
  try {
    renderer = new FlatRenderer(canvas);
  } catch (error) {
    status.textContent = `无法初始化画布：${String(error)}`;
    status.classList.add('error');
    throw error;
  }

  let chart: Chart | null = null;
  let layout: Layout = defaultLayout();
  let instantPx = 6;
  let showGrid = true;
  let showMeasures = true;
  let showSimultaneous = true;
  let spritesReady = false;
  let disposed = false;
  let currentTime = 0;
  let playing = false;
  let playbackRate = 1;
  let frame = 0;
  let lastFrameAt = performance.now();
  let unsubscribeSongSelection = () => {};
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const cleanups: (() => void)[] = [];

  const listen = (node: EventTarget, type: string, handler: EventListener, opts?: AddEventListenerOptions) => {
    node.addEventListener(type, handler, opts);
    cleanups.push(() => node.removeEventListener(type, handler, opts));
  };

  function setStatus(text: string, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
  }

  function maxScroll(): number {
    if (!chart) return 0;
    return Math.max(0, layout.duration * layout.pxPerSec + layout.padY * 2 - stage.clientHeight);
  }

  /** 2D 镜头的判定线位置：接近舞台底部，与 3D 相机的近端判定线同语义。 */
  function judgementLineY(): number {
    return Math.max(1, stage.clientHeight) * 0.78;
  }

  function clampTime(time: number): number {
    if (!chart || !Number.isFinite(time)) return 0;
    return Math.max(0, Math.min(chart.duration, time));
  }

  function followTime() {
    if (!chart) return;
    const scroll = scrollToLine(currentTime, layout, judgementLineY());
    layout = { ...layout, scrollPx: Math.min(maxScroll(), Math.max(0, scroll)) };
  }

  function formatTime(time: number): string {
    const safe = Math.max(0, Number.isFinite(time) ? time : 0);
    const minutes = Math.floor(safe / 60);
    const seconds = safe - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
  }

  function syncTransport() {
    const duration = chart?.duration ?? 0;
    timeline.max = String(duration);
    timeline.value = String(Math.min(duration, currentTime));
    timeOutput.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    play.textContent = playing ? 'Ⅱ 暂停' : '▶ 播放';
    play.setAttribute('aria-label', playing ? '暂停' : '播放');
  }

  function draw() {
    if (disposed || !chart || !spritesReady) return;
    const stats = renderer.render(chart, {
      layout, instantPx, showMeasures, showSimultaneous, showGrid,
    });
    judgementLine.style.display = 'block';
    judgementLine.style.top = `${judgementLineY()}px`;
    canvas.dataset.drawn = String(stats.drawn);
    canvas.dataset.instants = String(stats.instants);
    canvas.dataset.holds = String(stats.holds);
    canvas.dataset.total = String(stats.total);
    canvas.dataset.duration = chart.duration.toFixed(4);
    canvas.dataset.roots = String(chart.roots.length);
    canvas.dataset.lines = String(chart.lines.length);
    canvas.dataset.layout = JSON.stringify(layout);
    canvas.dataset.time = currentTime.toFixed(4);
    canvas.dataset.playing = playing ? '1' : '0';
    canvas.dataset.judgementY = judgementLineY().toFixed(2);
  }

  function describe(next: Chart, name: string) {
    const holds = next.notes.filter(note => note.type === 1).length;
    const multi = next.notes.filter(note => note.type === 1 && note.holds.length > 1).length;
    const rows: [string, string][] = [
      ['音符', `${next.notes.length}`],
      ['链首', `${next.roots.length}`],
      ['Hold 节点', `${holds}（多航点 ${multi}）`],
      ['同时押组', `${next.lines.length}`],
      ['BPM 段', `${next.bpms.length}`],
      ['拍号段', `${next.beats.length}`],
      ['时长', `${next.duration.toFixed(3)} s`],
    ];
    meta.innerHTML = rows.map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`).join('');
    chartName.textContent = name;
  }

  async function load(bytes: Uint8Array, name: string) {
    try {
      const next = await decodeChart(bytes);
      if (disposed) return;
      chart = next;
      currentTime = 0;
      playing = false;
      layout = {
        ...layout,
        duration: next.duration,
        scrollPx: 0,
      };
      followTime();
      empty.classList.add('hidden');
      describe(next, name);
      setStatus(`已载入 ${name}：${next.notes.length} 个音符`);
      syncTransport();
      draw();
    } catch (error) {
      if (!disposed) setStatus(`${name} 载入失败：${String(error)}`, true);
    }
  }

  function setZoom(px: number) {
    if (!chart) return;
    layout = { ...layout, pxPerSec: px };
    followTime();
    zoom.value = String(px);
    output('zoom-out').textContent = `${px} px/s`;
    draw();
  }

  function jumpTo(time: number) {
    if (!Number.isFinite(time)) return;
    currentTime = clampTime(time);
    goto.value = String(currentTime);
    followTime();
    syncTransport();
    draw();
  }

  function seek(time: number) {
    if (!chart || !Number.isFinite(time)) return;
    currentTime = clampTime(time);
    followTime();
    syncTransport();
    draw();
  }

  function togglePlayback() {
    if (!chart) return;
    if (playing) {
      playing = false;
    } else {
      if (currentTime >= chart.duration - 1e-6) currentTime = 0;
      playing = true;
      lastFrameAt = performance.now();
    }
    syncTransport();
    draw();
  }

  function animate(now: number) {
    if (disposed) return;
    const delta = Math.max(0, Math.min(0.1, (now - lastFrameAt) / 1000));
    lastFrameAt = now;
    if (playing && chart) {
      currentTime = clampTime(currentTime + delta * playbackRate);
      if (currentTime >= chart.duration - 1e-6) {
        currentTime = chart.duration;
        playing = false;
      }
      followTime();
      draw();
    }
    syncTransport();
    frame = requestAnimationFrame(animate);
  }

  const wireFileInput = (fileInput: HTMLInputElement) => listen(fileInput, 'change', event => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    void file.arrayBuffer().then(buffer => load(new Uint8Array(buffer), file.name)).finally(() => { input.value = ''; });
  });
  for (const input of fileInputs) wireFileInput(input);
  if (options.toolbar) {
    const sharedButton = options.toolbar.querySelector<HTMLButtonElement>('#open-chart');
    if (sharedButton) listen(sharedButton, 'click', () => fileInput.click());
  }

  let songLoadId = 0;
  async function loadSongById(songId: string, difficulty: string) {
    const song = await findSong(songId);
    if (!song) throw new Error(`曲目列表里没有 Id ${songId}`);
    const chartFile = song.charts[difficulty];
    if (!chartFile) throw new Error(`曲目 ${songId} 没有难度 ${difficulty} 的谱面`);
    const id = ++songLoadId;
    setStatus(`正在加载 ${song.title} [${difficulty}]…`);
    const response = await fetch(`/assets/chart/${chartFile}`);
    if (!response.ok) throw new Error(`谱面下载失败（${response.status}）：${chartFile}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (disposed || id !== songLoadId) return;
    await load(bytes, `${song.title} [${difficulty}]`);
  }
  const openSong = async (songId: string, difficulty: string) => {
    try {
      await loadSongById(songId, difficulty);
    } catch (error) {
      if (!disposed) setStatus(`曲目加载失败：${String(error)}`, true);
    }
  };
  unsubscribeSongSelection = options.songSelection.subscribe((selection) => {
    if (selection) void openSong(selection.songId, selection.difficulty);
  }, false);

  for (const type of ['dragenter', 'dragover'] as const) {
    listen(stage, type, event => { event.preventDefault(); stage.classList.add('drop'); });
  }
  for (const type of ['dragleave', 'drop'] as const) {
    listen(stage, type, () => stage.classList.remove('drop'));
  }
  listen(stage, 'drop', event => {
    event.preventDefault();
    const file = (event as DragEvent).dataTransfer?.files?.[0];
    if (!file) return;
    void file.arrayBuffer().then(buffer => load(new Uint8Array(buffer), file.name));
  });

  listen(zoom, 'input', event => setZoom(Number((event.target as HTMLInputElement).value)));
  listen(lane, 'input', event => {
    layout = { ...layout, lanePx: Number((event.target as HTMLInputElement).value) };
    output('lane-out').textContent = `${lane.value} px`;
    draw();
  });
  listen(thick, 'input', event => {
    instantPx = Number((event.target as HTMLInputElement).value);
    output('thick-out').textContent = `${thick.value} px`;
    draw();
  });
  listen(query<HTMLInputElement>(root, 'grid'), 'change', event => { showGrid = (event.target as HTMLInputElement).checked; draw(); });
  listen(query<HTMLInputElement>(root, 'measure'), 'change', event => { showMeasures = (event.target as HTMLInputElement).checked; draw(); });
  listen(query<HTMLInputElement>(root, 'simul'), 'change', event => { showSimultaneous = (event.target as HTMLInputElement).checked; draw(); });
  listen(query<HTMLInputElement>(root, 'mirror'), 'change', event => {
    layout = { ...layout, mirror: (event.target as HTMLInputElement).checked };
    draw();
  });
  listen(goto, 'input', event => jumpTo(Number((event.target as HTMLInputElement).value)));
  listen(play, 'click', togglePlayback);
  listen(restart, 'click', () => {
    playing = false;
    currentTime = 0;
    goto.value = '0';
    followTime();
    syncTransport();
    draw();
  });
  listen(timeline, 'input', event => seek(Number((event.target as HTMLInputElement).value)));
  listen(rate, 'change', event => {
    const value = Number((event.target as HTMLSelectElement).value);
    if (Number.isFinite(value) && value > 0) playbackRate = value;
  });
  listen(document, 'keydown', event => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.target instanceof HTMLElement && keyboard.target.closest('input,select,button,textarea,a')) return;
    if (keyboard.code === 'Space') {
      keyboard.preventDefault();
      togglePlayback();
    } else if (keyboard.code === 'ArrowRight' || keyboard.code === 'ArrowLeft') {
      keyboard.preventDefault();
      seek(currentTime + (keyboard.code === 'ArrowRight' ? 5 : -5));
    }
  });

  listen(stage, 'wheel', event => {
    const wheel = event as WheelEvent;
    if (!chart) return;
    wheel.preventDefault();
    const step = wheel.deltaY > 0 ? -5 : 5;
    if (wheel.shiftKey) {
      setZoom(Math.max(20, Math.min(2400, layout.pxPerSec + step * 5)));
    } else {
      const px = Math.max(4, Math.min(40, layout.lanePx + (wheel.deltaY > 0 ? -1 : 1)));
      layout = { ...layout, lanePx: px };
      lane.value = String(px);
      output('lane-out').textContent = `${px} px`;
      draw();
    }
  }, { passive: false });

  listen(canvas, 'pointerdown', event => {
    const pointer = event as PointerEvent;
    playing = false;
    dragging = true;
    lastX = pointer.clientX;
    lastY = pointer.clientY;
    canvas.setPointerCapture(pointer.pointerId);
  });
  listen(canvas, 'pointerup', event => {
    const pointer = event as PointerEvent;
    dragging = false;
    if (canvas.hasPointerCapture(pointer.pointerId)) canvas.releasePointerCapture(pointer.pointerId);
  });
  listen(canvas, 'pointermove', event => {
    const pointer = event as PointerEvent;
    if (!chart) return;
    if (dragging) {
      layout = {
        ...layout,
        padX: layout.padX + pointer.clientX - lastX,
        scrollPx: Math.min(maxScroll(), Math.max(0, layout.scrollPx - (pointer.clientY - lastY))),
      };
      currentTime = clampTime(yTime(judgementLineY(), layout));
      goto.value = String(currentTime);
      syncTransport();
      lastX = pointer.clientX;
      lastY = pointer.clientY;
      draw();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const hit = renderer.hitTest(chart, layout, pointer.clientX - rect.left, pointer.clientY - rect.top, instantPx);
    probe.textContent = hit ? noteLabel(hit) : '把鼠标移到音符上';
  });
  listen(canvas, 'pointerleave', () => { probe.textContent = '把鼠标移到音符上'; });

  const resizeObserver = new ResizeObserver(() => {
    followTime();
    draw();
  });
  resizeObserver.observe(stage);

  const controller: FlatViewController = {
    load,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribeSongSelection();
      resizeObserver.disconnect();
      for (const cleanup of cleanups.splice(0)) cleanup();
      fileControl?.remove();
      if (mounts.get(root) === controller) mounts.delete(root);
      root.replaceChildren();
    },
  };
  mounts.set(root, controller);

  void loadSprites(options.spriteBase ?? '/rg').then(lib => {
    if (disposed) return;
    renderer.setLibrary(lib);
    spritesReady = true;
    canvas.dataset.textured = '1';
    draw();
  }).catch(error => {
    if (!disposed) setStatus(`贴图载入失败：${String(error)}`, true);
  });

  syncTransport();
  frame = requestAnimationFrame(animate);
  draw();
  const initialSelection = options.songSelection.get();
  if (initialSelection) void openSong(initialSelection.songId, initialSelection.difficulty);
  return controller;
}

export function dispose(root: HTMLElement): void {
  mounts.get(root)?.dispose();
}
