/** 工作台：文件导入、视图参数、悬停探针。 */

import { type Chart, decodeChart } from './chart';
import { FlatRenderer, loadSprites, noteLabel } from './renderer';
import { type Layout, defaultLayout, scrollToBottom, yTime } from './view';

const el = <T extends HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少元素 #${id}`);
  return node as T;
};

const canvas = el<HTMLCanvasElement>('canvas');
const stage = el<HTMLDivElement>('stage');
const empty = el<HTMLDivElement>('empty');
const status = el<HTMLSpanElement>('status');
const probe = el<HTMLParagraphElement>('probe');
const meta = el<HTMLDListElement>('meta');

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
let showGrid = true, showMeasures = true, showSimultaneous = true;

function draw() {
  if (!chart) return;
  const stats = renderer.render(chart, { layout, instantPx, showMeasures, showSimultaneous, showGrid });
  canvas.dataset.drawn = String(stats.drawn);
  canvas.dataset.instants = String(stats.instants);
  canvas.dataset.holds = String(stats.holds);
  canvas.dataset.total = String(stats.total);
  canvas.dataset.duration = chart.duration.toFixed(4);
  canvas.dataset.roots = String(chart.roots.length);
  canvas.dataset.lines = String(chart.lines.length);
  // 当前布局快照，便于探针与自动化核对坐标。
  canvas.dataset.layout = JSON.stringify(layout);
}

function setStatus(text: string, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function describe(c: Chart) {
  const holds = c.notes.filter(n => n.type === 1).length;
  const multi = c.notes.filter(n => n.type === 1 && n.holds.length > 1).length;
  const rows: [string, string][] = [
    ['音符', `${c.notes.length}`],
    ['链首', `${c.roots.length}`],
    ['Hold 节点', `${holds}（多航点 ${multi}）`],
    ['同时押组', `${c.lines.length}`],
    ['BPM 段', `${c.bpms.length}`],
    ['拍号段', `${c.beats.length}`],
    ['时长', `${c.duration.toFixed(3)} s`],
  ];
  meta.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

async function load(bytes: Uint8Array, name: string) {
  try {
    const c = await decodeChart(bytes);
    chart = c;
    // 时间轴向上：0 秒在内容底部，故初始把视口贴到内容底端。
    layout = { ...layout, duration: c.duration, scrollPx: Math.max(0, c.duration * layout.pxPerSec - stage.clientHeight + layout.padY) };
    empty.classList.add('hidden');
    describe(c);
    setStatus(`已载入 ${name}：${c.notes.length} 个音符`);
    draw();
  } catch (error) {
    // 载入失败保留已有谱面。
    setStatus(`${name} 载入失败：${String(error)}`, true);
  }
}

el<HTMLInputElement>('file').onchange = async event => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await load(new Uint8Array(await file.arrayBuffer()), file.name);
  input.value = '';
};

for (const type of ['dragenter', 'dragover'] as const) {
  stage.addEventListener(type, event => { event.preventDefault(); stage.classList.add('drop'); });
}
for (const type of ['dragleave', 'drop'] as const) {
  stage.addEventListener(type, () => stage.classList.remove('drop'));
}
stage.addEventListener('drop', async event => {
  event.preventDefault();
  const file = (event as DragEvent).dataTransfer?.files?.[0];
  if (!file) return;
  await load(new Uint8Array(await file.arrayBuffer()), file.name);
});

const zoom = el<HTMLInputElement>('zoom'), lane = el<HTMLInputElement>('lane'), thick = el<HTMLInputElement>('thick');

/** 纵向可滚动上限：内容高 − 视口高。 */
function maxScroll(): number {
  if (!chart) return 0;
  return Math.max(0, (layout.duration - 0) * layout.pxPerSec + layout.padY * 2 - stage.clientHeight);
}

/** 改纵向缩放时保持视口底边的时间不变，避免跳位。 */
function setZoom(px: number) {
  const bottomTime = yTime(stage.clientHeight, layout);
  layout = { ...layout, pxPerSec: px };
  layout = { ...layout, scrollPx: Math.min(maxScroll(), Math.max(0, scrollToBottom(bottomTime, layout, stage.clientHeight))) };
  zoom.value = String(px);
  el<HTMLOutputElement>('zoom-out').textContent = `${px} px/s`;
  draw();
}

zoom.oninput = () => setZoom(Number(zoom.value));
lane.oninput = () => { layout = { ...layout, lanePx: Number(lane.value) }; el<HTMLOutputElement>('lane-out').textContent = `${lane.value} px`; draw(); };
thick.oninput = () => { instantPx = Number(thick.value); el<HTMLOutputElement>('thick-out').textContent = `${thick.value} px`; draw(); };
el<HTMLInputElement>('grid').onchange = e => { showGrid = (e.target as HTMLInputElement).checked; draw(); };
el<HTMLInputElement>('measure').onchange = e => { showMeasures = (e.target as HTMLInputElement).checked; draw(); };
el<HTMLInputElement>('simul').onchange = e => { showSimultaneous = (e.target as HTMLInputElement).checked; draw(); };
el<HTMLInputElement>('mirror').onchange = e => { layout = { ...layout, mirror: (e.target as HTMLInputElement).checked }; draw(); };

/** 把指定时刻滚到视口底边——即视口显示 [time, time + 视口高/pxPerSec] 这一段。 */
const goto = el<HTMLInputElement>('goto');
function jumpTo(time: number) {
  if (!Number.isFinite(time)) return;
  layout = { ...layout, scrollPx: Math.max(0, scrollToBottom(time, layout, stage.clientHeight)) };
  draw();
}
goto.oninput = () => jumpTo(Number(goto.value));
el<HTMLOutputElement>('goto-out').textContent = '秒';

// 滚轮缩放，Shift 换纵向；拖动平移。
stage.addEventListener('wheel', event => {
  if (!chart) return;
  event.preventDefault();
  const step = event.deltaY > 0 ? -5 : 5;
  if (event.shiftKey) {
    setZoom(Math.max(20, Math.min(2400, layout.pxPerSec + step * 5)));
  } else {
    const px = Math.max(4, Math.min(40, layout.lanePx + (event.deltaY > 0 ? -1 : 1)));
    layout = { ...layout, lanePx: px };
    lane.value = String(px);
    el<HTMLOutputElement>('lane-out').textContent = `${px} px`;
    draw();
  }
}, { passive: false });

let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', event => { dragging = true; lastX = event.clientX; lastY = event.clientY; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointerup', event => { dragging = false; canvas.releasePointerCapture(event.pointerId); });
canvas.addEventListener('pointermove', event => {
  if (!chart) return;
  if (dragging) {
    const scroll = Math.min(maxScroll(), Math.max(0, layout.scrollPx - (event.clientY - lastY)));
    layout = { ...layout, padX: layout.padX + (event.clientX - lastX), scrollPx: scroll };
    lastX = event.clientX; lastY = event.clientY;
    draw();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const hit = renderer.hitTest(chart, layout, event.clientX - rect.left, event.clientY - rect.top, instantPx);
  probe.textContent = hit ? noteLabel(hit) : '把鼠标移到音符上';
});

canvas.addEventListener('pointerleave', () => { probe.textContent = '把鼠标移到音符上'; });

new ResizeObserver(() => draw()).observe(stage);
draw();

// 音符贴图与九宫格边距：载入完成后重绘一次。
void loadSprites().then(lib => {
  renderer.setLibrary(lib);
  if (lib.images.some(Boolean)) canvas.dataset.textured = '1';
  draw();
});
