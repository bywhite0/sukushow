import './style.css';

type ViewId = 'llll' | 'pjsk' | 'flat';

const views: { id: ViewId; label: string; detail: string }[] = [
  { id: 'llll', label: 'LLLL 3D', detail: '原生舞台 · HUD · 导出' },
  { id: 'pjsk', label: 'PJSK 渲染', detail: '60 轨 WASM · 导出' },
  { id: 'flat', label: '2D 谱面', detail: 'Canvas 读谱 · 探针' },
];

const requested = new URLSearchParams(window.location.search).get('view');
const view: ViewId = views.some(item => item.id === requested) ? requested as ViewId : 'llll';
const nav = document.querySelector<HTMLElement>('#navigation');
const app = document.querySelector<HTMLDivElement>('#app');
if (!nav || !app) throw new Error('缺少统一前端容器。');

nav.innerHTML = `
  <a class="nav-brand" href="./?view=llll" aria-label="sukushow 首页">
    <span class="nav-mark">sukushow</span><span class="nav-title">谱面放映室</span>
  </a>
  <div class="nav-views" role="navigation" aria-label="工作台">
    ${views.map(item => `<a class="nav-item${item.id === view ? ' is-active' : ''}" href="./?view=${item.id}" aria-current="${item.id === view ? 'page' : 'false'}"><strong>${item.label}</strong><small>${item.detail}</small></a>`).join('')}
  </div>
  <span class="nav-local">LOCAL · 文件不上传</span>
`;

const modules: Record<ViewId, () => Promise<unknown>> = {
  llll: () => import('./views/llll'),
  pjsk: () => import('./views/pjsk'),
  flat: () => import('./views/flat'),
};

modules[view]().catch(error => {
  app.innerHTML = `<main class="load-error" role="alert"><h1>工作台加载失败</h1><p>${String(error)}</p><a href="./?view=llll">返回 LLLL 工作台</a></main>`;
  console.error(error);
});
