import './llll.css';
import { decodeChart } from '@sukushow/chart/chart';
import { demoChart } from '@sukushow/llll-preview/demo';
import { parseFeverWindow, type FeverWindow } from '@sukushow/chart/fever';
import { parseChartName } from '@sukushow/chart/masterdata';
import { feverForSong, finishTimeForSong } from '@sukushow/chart/songTiming';
import { AudioPlayer } from '@sukushow/llll-preview/audio';
import { MusicVideo } from '@sukushow/llll-preview/musicVideo';
import { CapturingSeOutput, createWebAudioSeOutput, SeResolver } from '@sukushow/llll-preview/se';
import { PreviewRenderer } from '@sukushow/llll-preview/renderer';
import { LiveHud } from '@sukushow/llll-preview/hud';
import { imagesSettled, loadHudFonts, loadedImageRevision, preloadImages } from '@sukushow/llll-preview/canvasKit';
import type { ExportFrameSource } from '@sukushow/export';
import { installExportDialog, probeAllConfigs } from './exportDialog';
import { LIVE_BG_DOT_URL, LIVE_BG_URL, StageCompositor, type StageView } from '@sukushow/llll-preview/stageCompositor';
import { EXPORT_OPENING, StartAnimation, START_BASE01_URL, START_CLIP_DURATION } from '@sukushow/llll-preview/startAnim';
import { ComboResult, BANNER_TEX_BASE, COMBO_RESULT_CLIP_DURATION, type ComboResultLoadProgress, type ResultKind } from '@sukushow/llll-preview/comboResult';
import { RG_RESOURCE_URLS, type RgLoadProgress } from '@sukushow/llll-preview/rgAssets';
import { SE_RESOURCE_URLS, type SeLoadProgress } from '@sukushow/llll-preview/se';
import { COMBO_RESULT_TEXTURES } from '@sukushow/llll-preview/comboResultClip';
import { fetchBytes, findSong, findSongByChartFile, loadSongList, songAssets, SONG_LIST_URL, type SongList } from '@sukushow/llll-preview/songAssets';
import { createAspectPicker, bindStageAspect, DEFAULT_ASPECT, type AspectId } from './llll/aspectRatio';
import type { SongSelectionStore } from '../songSelection';
import {
  loadPreviewSettings,
  savePreviewSettings,
  type PreviewSettings,
} from './llll/settingsPersist';
import { createResourceLoading, formatResourceSize, measureResourceSizes, totalResourceSize } from '../resourceLoading';
export type LlllMountContext = { root: HTMLElement; toolbar: HTMLElement; songSelection: SongSelectionStore };

export function mount({ root, toolbar, songSelection }: LlllMountContext) {
const app=root;
app.innerHTML=`
<main>
<section class="viewer" aria-label="谱面预览">
 <div class="preview-heading"><div class="current-file"><span class="section-label">当前谱面</span><h1 id="chart-name">演示谱面</h1></div><span class="file-name" id="audio-name">未加载音频 · 可以无声预览</span></div>
 <div class="stage-shell"><div class="stage" id="stage" data-stage-mode="3d">
  <canvas id="chart-canvas" aria-hidden="true"></canvas>
  <canvas id="stage-canvas" aria-label="LLLL 舞台谱面预览画面" aria-hidden="false"></canvas>
  <div class="stage-mode-switch" role="group" aria-label="谱面显示模式">
   <span class="stage-mode-label">显示</span>
   <button type="button" data-stage-mode="3d" aria-pressed="true">3D</button>
   <button type="button" data-stage-mode="2d" aria-pressed="false">2D</button>
  </div>
  <div class="resource-loading" data-resource-loading role="status" aria-live="polite">
   <div class="resource-loading-card">
    <strong data-resource-loading-title>正在准备 LLLL 预览</strong>
    <progress data-resource-loading-progress max="1" value="0" aria-label="预览资源加载进度"></progress>
    <div class="resource-loading-meta"><span data-resource-loading-detail>正在连接资源…</span><output data-resource-loading-percent>0%</output></div>
    <span class="resource-loading-size" data-resource-loading-size hidden></span>
   </div>
  </div>
 </div></div>
 <div id="message" class="viewer-status" role="status" aria-live="polite">就绪。选择本地谱面，或播放演示。</div>
 <div class="transport"><label class="sr-only" for="timeline">播放进度</label><input id="timeline" type="range" min="0" max="36" step="0.001" value="0"><div class="transport-row"><button id="play" class="primary" aria-label="播放">▶ 播放</button><button id="restart" class="quiet" aria-label="回到开头">↺ 重播</button><output id="time">00:00.000 / 00:36.000</output><label class="rate-label">播放倍率<select id="rate"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button id="export-video" class="quiet" type="button">导出视频</button><button id="fullscreen" class="quiet">全屏预览</button></div></div>
</section>
<aside aria-label="预览设置">
 <div class="inspector-heading"><h2>预览设置</h2><span>自动保存</span></div>
 <div class="settings-tabs" role="tablist" aria-label="设置分类">
  <button id="tab-track" role="tab" aria-selected="true" aria-controls="panel-track">播放与轨道</button>
  <button id="tab-display" role="tab" aria-selected="false" aria-controls="panel-display" tabindex="-1">显示与特效</button>
  <button id="tab-audio" role="tab" aria-selected="false" aria-controls="panel-audio" tabindex="-1">音量</button>
  <button id="tab-score" role="tab" aria-selected="false" aria-controls="panel-score" tabindex="-1">计分</button>
 </div>
 <div class="settings-body">
 <section class="panel" id="panel-track" role="tabpanel" aria-labelledby="tab-track" tabindex="0"><h2>轨道与播放</h2>
<label class="setting" for="speed"><span>下落速度 <small>NoteSpeed×0.1</small><output id="speed-value">5.0</output></span><input id="speed" type="range" min="1" max="20" step="0.1" value="5"></label>
<label class="setting" for="opt-start-z"><span>出现位置 NoteStartZ<output id="opt-start-z-value">0</output></span><input id="opt-start-z" type="range" min="0" max="100" step="1" value="0"></label>
<label class="setting" for="opt-lane-width"><span>轨道宽度 LaneWidth<output id="opt-lane-width-value">100</output></span><input id="opt-lane-width" type="range" min="80" max="120" step="1" value="100"></label>
<label class="setting" for="opt-grid"><span>轨道分割 GridCount</span><select id="opt-grid"><option value="0" selected>关闭</option><option value="1">2</option><option value="2">3</option><option value="3">4</option><option value="4">5</option><option value="5">6</option></select></label>
<label class="setting" for="opt-fps"><span>目标帧率</span><select id="opt-fps"><option value="0" selected>60</option><option value="1">120</option></select></label>
<label class="setting" for="offset"><span>音频偏移 <small>毫秒</small></span><input id="offset" type="number" min="-10000" max="10000" step="10" value="0"><small>正值让音频晚于谱面开始。</small></label>
<label class="check"><input id="mirror" type="checkbox">左右镜像</label>
<label class="check"><input id="lines" type="checkbox" checked>显示同时押线</label>
</section>
<section class="panel" id="panel-display" role="tabpanel" aria-labelledby="tab-display" tabindex="0" hidden><h2>显示与特效</h2>
<label class="setting" for="opt-lane-dark"><span>轨道暗度 LaneDarkness<output id="opt-lane-dark-value">80</output></span><input id="opt-lane-dark" type="range" min="0" max="130" step="1" value="80"></label>
<label class="setting" for="opt-bg-dark"><span>背景暗度 BackgroundDarkness<output id="opt-bg-dark-value">0</output></span><input id="opt-bg-dark" type="range" min="0" max="100" step="1" value="0"></label>
<label class="setting" for="opt-judge-y"><span>判定字高度 JudgementY<output id="opt-judge-y-value">5</output></span><input id="opt-judge-y" type="range" min="1" max="10" step="1" value="5"></label>
<label class="setting" for="opt-fs-y"><span>FAST/SLOW 高度 FastSlowY<output id="opt-fs-y-value">5</output></span><input id="opt-fs-y" type="range" min="1" max="10" step="1" value="5"></label>
<label class="check"><input id="opt-perfect-plus" type="checkbox">Perfect+ 判定显示</label>
<label class="setting" for="opt-judgement-output"><span>判定字输出</span><select id="opt-judgement-output"><option value="0" selected>全部</option><option value="1">Perfect+ 以下</option><option value="2">Perfect 以下</option><option value="3">Great 以下</option><option value="4">Good 以下</option><option value="5">Bad 以下</option><option value="6">Miss 以下</option></select></label>
<label class="setting" for="opt-fast-slow"><span>FAST/SLOW 显示</span><select id="opt-fast-slow"><option value="0" selected>关闭</option><option value="1">Great 以下</option><option value="2">Perfect 以下</option></select></label>
<label class="setting" for="tech-score"><span>技术分显示</span><select id="tech-score"><option value="0" selected>关闭</option><option value="1">实时</option><option value="2">预估全 PP</option></select></label>
<label class="check"><input id="opt-fever" type="checkbox" checked>Fever 显示</label>
<label class="setting" for="opt-fever-start"><span>Fever 开始（秒）</span><input id="opt-fever-start" type="number" min="0" step="any" aria-describedby="fever-status"></label>
<label class="setting" for="opt-fever-end"><span>Fever 结束（秒）</span><input id="opt-fever-end" type="number" min="0" step="any" aria-describedby="fever-status"><small>仅当前谱面有效；两项留空关闭，不估算。</small></label>
<button id="fever-reset" type="button" class="quiet">恢复歌曲元数据</button><p id="fever-status" role="status">未配置 Fever</p>
<label class="check"><input id="opt-skill-view" type="checkbox" checked>技能轨道显示</label>
<label class="check"><input id="opt-skill-cutin" type="checkbox" checked>技能 Cut-in</label>
<label class="check"><input id="opt-ap-continue" type="checkbox" checked>AP 继续提示</label>
<label class="check"><input id="opt-start-anim" type="checkbox" checked>开场过场</label>
<label class="setting" for="opt-combo-result"><span>曲终横幅 <small>GetResultIndex</small></span><select id="opt-combo-result"><option value="0" selected>AllPerfect</option><option value="1">FullCombo</option><option value="2">Clear</option><option value="3">Finish</option></select><small>自动演奏恒为 AP；其余档位仅供预览。</small></label>
<label class="check"><input id="opt-mv" type="checkbox" checked>MV / MusicVideo</label>
</section>
<section class="panel" id="panel-audio" role="tabpanel" aria-labelledby="tab-audio" tabindex="0" hidden><h2>音量</h2>
<label class="setting" for="volume"><span>音乐 Music</span><input id="volume" type="range" min="0" max="1" step="0.01" value="0.7"></label>
<label class="setting" for="vol-tap"><span>打击音 NoteTap</span><input id="vol-tap" type="range" min="0" max="1" step="0.01" value="1"></label>
<label class="setting" for="vol-se"><span>SE</span><input id="vol-se" type="range" min="0" max="1" step="0.01" value="1"></label>
<label class="setting" for="vol-voice"><span>Voice</span><input id="vol-voice" type="range" min="0" max="1" step="0.01" value="1"></label>
</section>
<section class="panel" id="panel-score" role="tabpanel" aria-labelledby="tab-score" tabindex="0" hidden><h2>计分预览</h2>
<label class="setting" for="opt-appeal"><span>TotalAppeal</span><input id="opt-appeal" type="number" min="1000" max="2000000" step="1000" value="350000"><small>卡组 Appeal；默认 350000。</small></label>
<label class="setting" for="opt-mastery"><span>熟练度等级</span><input id="opt-mastery" type="number" min="0" max="50" step="1" value="0"><small>MusicMasteryLevel；halfwayScore = Appeal×(1+等级×0.01)/音符数。</small></label>
<label class="setting" for="opt-hit-effect"><span>击中特效</span><select id="opt-hit-effect"><option value="current" selected>直冲天上</option><option value="limited">限速</option><option value="full">加深</option><option value="off">关闭</option></select></label>
<label class="setting" for="rank-preview"><span>段位预览</span><select id="rank-preview"><option value="none" selected>未激活</option><option value="D">D</option><option value="C">C</option><option value="B">B</option><option value="A">A</option><option value="S">S</option></select></label>
</section></div>
<div class="inspector-footer">设置仅影响预览，不会修改源文件。</div>
</aside>
</main>`;
const el=<T extends HTMLElement=HTMLElement>(id:string)=>{
 const node=root.querySelector<T>(`#${id}`)??toolbar.querySelector<T>(`#${id}`);
 if(!node)throw new Error(`缺少元素 #${id}`);
 return node;
};
const input=(id:string)=>el<HTMLInputElement>(id);
const message=(text:string,error=false)=>{el('message').textContent=text;el('message').classList.toggle('error',error);};
el('open-chart').onclick=()=>input('chart-file').click();
el('open-audio').onclick=()=>input('audio-file').click();
el('panel-display').querySelector('h2')!.after(el('opt-hit-effect').closest('label')!);
el('panel-score').querySelector('h2')!.after(el('tech-score').closest('label')!);
const settingTabs=Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
function selectSettingsTab(tab:HTMLButtonElement){
 for(const item of settingTabs){
  const selected=item===tab;
  item.setAttribute('aria-selected',String(selected));
  item.tabIndex=selected?0:-1;
  el(item.getAttribute('aria-controls')!).hidden=!selected;
 }
}
for(const [index,tab] of settingTabs.entries()){
 tab.onclick=()=>selectSettingsTab(tab);
 tab.onkeydown=(event)=>{
  const positions:Record<string,number>={ArrowRight:(index+1)%settingTabs.length,ArrowLeft:(index+settingTabs.length-1)%settingTabs.length,Home:0,End:settingTabs.length-1};
  const next=positions[event.key];
  if(next===undefined)return;
  event.preventDefault();event.stopPropagation();
  selectSettingsTab(settingTabs[next]!);settingTabs[next]!.focus();
 };
}


let aspectId:AspectId=DEFAULT_ASPECT;
function readSettings():PreviewSettings{
 return{
  speed:Number(input('speed').value),
  offsetMs:Number(input('offset').value),
  volume:Number(input('volume').value),
  volumeNoteTap:Number(input('vol-tap').value),
  volumeSe:Number(input('vol-se').value),
  volumeVoice:Number(input('vol-voice').value),
  mirror:input('mirror').checked,
  lines:input('lines').checked,
  noteStartZ:Number(input('opt-start-z').value),
  laneWidth:Number(input('opt-lane-width').value),
  laneDarkness:Number(input('opt-lane-dark').value),
  backgroundDarkness:Number(input('opt-bg-dark').value),
  gridCount:Number(el<HTMLSelectElement>('opt-grid').value),
  targetFPS:Number(el<HTMLSelectElement>('opt-fps').value),
  judgementY:Number(input('opt-judge-y').value),
  fastSlowY:Number(input('opt-fs-y').value),
  enablePerfectPlus:input('opt-perfect-plus').checked,
  enableApContinue:input('opt-ap-continue').checked,
  enableMusicVideo:input('opt-mv').checked,
  enableRhythmSkillView:input('opt-skill-view').checked,
  enableSkillCutin:input('opt-skill-cutin').checked,
  enableFeverDisplay:input('opt-fever').checked,
  enableStartAnimation:input('opt-start-anim').checked,
  comboResult:(()=>{const v=Number(el<HTMLSelectElement>('opt-combo-result').value);return (v===1||v===2||v===3?v:0) as ResultKind;})(),
  judgementOutput:Number(el<HTMLSelectElement>('opt-judgement-output').value),
  fastSlow:Number(el<HTMLSelectElement>('opt-fast-slow').value),
  totalAppeal:Number(input('opt-appeal').value),
  musicMasteryLevel:Number(input('opt-mastery').value),
  rankPreview:(()=>{const v=el<HTMLSelectElement>('rank-preview').value;return v==='D'||v==='C'||v==='B'||v==='A'||v==='S'?v:'none';})(),
  techScore:(()=>{const v=Number(el<HTMLSelectElement>('tech-score').value);return (v===1||v===2?v:0) as 0|1|2;})(),
  rate:Number(el<HTMLSelectElement>('rate').value),
  hitEffect:(()=>{const v=el<HTMLSelectElement>('opt-hit-effect').value;return v==='off'||v==='limited'||v==='full'?v:'current';})(),
  aspectRatio:aspectId,
 };
}
function persistSettings(){savePreviewSettings(readSettings());}
function applySettingsToForm(s:PreviewSettings){
 input('speed').value=String(s.speed);el('speed-value').textContent=s.speed.toFixed(1);
 input('offset').value=String(s.offsetMs);
 input('volume').value=String(s.volume);
 input('vol-tap').value=String(s.volumeNoteTap);
 input('vol-se').value=String(s.volumeSe);
 input('vol-voice').value=String(s.volumeVoice);
 input('mirror').checked=s.mirror;input('lines').checked=s.lines;
 input('opt-start-z').value=String(s.noteStartZ);el('opt-start-z-value').textContent=String(s.noteStartZ);
 input('opt-lane-width').value=String(s.laneWidth);el('opt-lane-width-value').textContent=String(s.laneWidth);
 input('opt-lane-dark').value=String(s.laneDarkness);el('opt-lane-dark-value').textContent=String(s.laneDarkness);
 input('opt-bg-dark').value=String(s.backgroundDarkness);el('opt-bg-dark-value').textContent=String(s.backgroundDarkness);
 el<HTMLSelectElement>('opt-grid').value=String(s.gridCount);
 el<HTMLSelectElement>('opt-fps').value=String(s.targetFPS);
 input('opt-judge-y').value=String(s.judgementY);el('opt-judge-y-value').textContent=String(s.judgementY);
 input('opt-fs-y').value=String(s.fastSlowY);el('opt-fs-y-value').textContent=String(s.fastSlowY);
 input('opt-perfect-plus').checked=s.enablePerfectPlus;
 input('opt-ap-continue').checked=s.enableApContinue;
 input('opt-mv').checked=s.enableMusicVideo;
 input('opt-skill-view').checked=s.enableRhythmSkillView;
 input('opt-skill-cutin').checked=s.enableSkillCutin;
 input('opt-fever').checked=s.enableFeverDisplay;
 input('opt-start-anim').checked=s.enableStartAnimation;
 el<HTMLSelectElement>('opt-combo-result').value=String(s.comboResult);
 el<HTMLSelectElement>('opt-judgement-output').value=String(s.judgementOutput);
 el<HTMLSelectElement>('opt-fast-slow').value=String(s.fastSlow);
 input('opt-appeal').value=String(s.totalAppeal);
 input('opt-mastery').value=String(s.musicMasteryLevel);
 el<HTMLSelectElement>('rank-preview').value=s.rankPreview;
 el<HTMLSelectElement>('tech-score').value=String(s.techScore);
 el<HTMLSelectElement>('rate').value=String(s.rate);
 el<HTMLSelectElement>('opt-hit-effect').value=s.hitEffect;
 aspectId=s.aspectRatio;
}
applySettingsToForm(loadPreviewSettings());
// 预览窗口固定比例：顶栏按钮组 + 舞台按比例居中。
const applyAspect=bindStageAspect(document.querySelector<HTMLElement>('.stage-shell')!,el('stage'));
const aspectPicker=createAspectPicker({value:aspectId,onChange:(id)=>{aspectId=id;applyAspect(id);persistSettings();}});
el('aspect-mount').replaceChildren(aspectPicker.root);
applyAspect(aspectId);

let chart=demoChart(),generation=0,speed=Number(input('speed').value),mirror=input('mirror').checked,lines=input('lines').checked;
/** 视频导出进行中：实时循环已暂停，走带 / 键盘操作无效。 */
let exporting=false;
let visualRevision=0;
const musicVideo=new MusicVideo(()=>{visualRevision++;});
let currentMvId='';
musicVideo.setEnabled(input('opt-mv').checked);
const stage=el<HTMLDivElement>('stage');
const loading=createResourceLoading(stage,root.querySelector<HTMLElement>('.transport')!);
const hudTextureUrls=LiveHud.textureUrls();
const initialResourceUrls=[...new Set([
 START_BASE01_URL,LIVE_BG_URL,LIVE_BG_DOT_URL,
 ...hudTextureUrls,
 ...COMBO_RESULT_TEXTURES.map((name)=>`${BANNER_TEX_BASE}${name}.png`),
 '/rg/fonts/FOT-RODINPRO-B.otf','/rg/fonts/FOT-RODINPRO-EB.otf',
 ...SE_RESOURCE_URLS,...RG_RESOURCE_URLS,
])];
const initialResourceTask=loading.begin('正在准备 LLLL 预览',initialResourceUrls.length);
const initialResourceSizes=new Map<string,number>();
const initialResourceDownloads=new Map<string,number>();
const initialResourceDone=new Set<string>();
const resourceName=(url:string)=>url.split('/').pop()??url;
const initialResourceTotal=()=>totalResourceSize(initialResourceSizes);
const reportInitialResource=(url:string,phase:'download'|'ready',downloaded?:number,detail=`资源 ${resourceName(url)}`)=>{
 if(phase==='ready')visualRevision++;
 if(phase==='download'&&!initialResourceDownloads.has(url))initialResourceDownloads.set(url,0);
 if(downloaded!==undefined)initialResourceDownloads.set(url,Math.max(0,downloaded));
 if(phase==='ready'){
  initialResourceDone.add(url);
  initialResourceDownloads.set(url,initialResourceSizes.get(url)??initialResourceDownloads.get(url)??0);
 }
 const totalBytes=initialResourceTotal();
 const downloadedBytes=[...initialResourceDownloads.values()].reduce((sum,value)=>sum+value,0);
 initialResourceTask.setLabel(phase==='ready'?`已加载 ${detail}`:`下载 ${detail}`);
 initialResourceTask.update(initialResourceDone.size,phase==='ready'?`${detail} 已就绪`:`正在下载 ${detail}…`,{downloadedBytes,totalBytes});
};
const initialResourceSizesReady=measureResourceSizes(initialResourceUrls).then((sizes)=>{
 for(const [url,size] of sizes)initialResourceSizes.set(url,size);
 for(const url of initialResourceDone){
  const size=initialResourceSizes.get(url);
  if(size!==undefined)initialResourceDownloads.set(url,size);
 }
 const totalBytes=initialResourceTotal();
 const downloadedBytes=[...initialResourceDownloads.values()].reduce((sum,value)=>sum+value,0);
 initialResourceTask.update(initialResourceDone.size,'资源大小已统计，正在加载场景与 HUD…',{downloadedBytes,totalBytes});
 return sizes;
});
let renderer:PreviewRenderer|undefined,player:AudioPlayer|undefined;let seOut:ReturnType<typeof createWebAudioSeOutput>|undefined;let se:SeResolver|undefined;
try{renderer=new PreviewRenderer(el<HTMLCanvasElement>('chart-canvas'),(progress: RgLoadProgress)=>reportInitialResource(progress.url,progress.phase,progress.downloadedBytes,`场景资源 ${resourceName(progress.url)}`));player=new AudioPlayer();seOut=createWebAudioSeOutput(player.context);se=new SeResolver(seOut);seOut.setTapVolume(Number(input('vol-tap').value));seOut.setSeVolume(Number(input('vol-se').value));player.setVolume(Number(input('volume').value));player.setRate(Number(el<HTMLSelectElement>('rate').value));player.setOffset(Number(input('offset').value)/1000);player.transport.setDuration(chart.duration);}catch(error){message(`无法初始化预览：${String(error)}。请启用 WebGL 和音频支持后刷新。`,true);el<HTMLButtonElement>('play').disabled=true;}
const format=(v:number)=>{const s=Math.abs(v)<5e-4?0:Math.abs(v);return `${v<0&&s>0?'-':''}${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(3).padStart(6,'0')}`;};
function metadata(){input('timeline').min=String(Math.floor((player?.transport.start??0)*1000)/1000);input('timeline').max=String(chart.duration);}metadata();
const startAnim=new StartAnimation();
const comboResult=new ComboResult();
/** 舞台合成画布：背景 / 3D / HUD / 过场 / 曲终横幅按原层序画进同一张 2D 画布（实时预览与导出共用）。 */
const compositor=new StageCompositor(el<HTMLCanvasElement>('stage-canvas'));
type LlllStageMode='3d'|'2d';
const stageModeButtons=Array.from(root.querySelectorAll<HTMLButtonElement>('.stage-mode-switch button[data-stage-mode]'));
function setStageMode(mode:LlllStageMode){
 stage.dataset.stageMode=mode;
 renderer?.setCameraMode(mode);
 for(const button of stageModeButtons){
  const active=button.dataset.stageMode===mode;
  button.classList.toggle('is-active',active);
  button.setAttribute('aria-pressed',String(active));
 }
}
for(const button of stageModeButtons){
 button.onclick=()=>setStageMode(button.dataset.stageMode==='2d'?'2d':'3d');
}
setStageMode('3d');
comboResult.setKind(readSettings().comboResult);
let startInfo={title:'演示谱面',difficulty:null as string|null,jacketUrl:null as string|null};
startAnim.setInfo(startInfo);
function setStartInfo(next:Partial<typeof startInfo>){startInfo={...startInfo,...next};startAnim.setInfo(startInfo);}
/**
 * ReadyAsync：开场 SE → ShowAsync（过场 clip）→ bgm.Play。过场计入进度条：开启时走带从
 * −START_CLIP_DURATION 起，0 秒 = BGM / 谱面起点，所以重播、暂停、拖动都能复现过场。
 */
function applyIntro(){
 if(!player)return;
 const tr=player.transport,atStart=tr.time<=tr.start+1e-6;
 tr.setStart(input('opt-start-anim').checked?-START_CLIP_DURATION:0);
 if(atStart&&!tr.playing)player.seek(tr.start);
 metadata();
}
/** 从 time 开播时补放开场 SE：过场中按已走过的秒数接着放；无过场时仅从头开播才放。 */
function kickStartSe(){
 if(!player||!se)return;
 const tr=player.transport,off=tr.time-tr.start;
 if(tr.start<0?tr.time<0:off<=0.05)se.playStart(Math.max(0,off));
}
function seekTo(t:number){
 if(!player||exporting)return;
 player.seek(t);se?.clear();se?.stopAll();
 if(player.transport.playing)kickStartSe();
}
async function toggle(){
 if(!player||exporting)return;
 try{
  if(player.transport.playing){
   // 过场中按键 = 跳过开场，直接到 0 秒开播（开场 SE 不打断）。
   if(player.transport.time<0){player.seek(0);return;}
   player.pause();se?.pause();return;
  }
  await player.play();se?.resume();kickStartSe();
 }catch(e){message(`播放失败：${String(e)}`,true);}
}
applyIntro();
el('play').onclick=()=>void toggle();
el('restart').onclick=()=>seekTo(player?.transport.start??0);
input('timeline').oninput=()=>seekTo(Number(input('timeline').value));
el<HTMLSelectElement>('rate').onchange=()=>{player?.setRate(Number(el<HTMLSelectElement>('rate').value));persistSettings();};
input('speed').oninput=()=>{speed=Number(input('speed').value);el('speed-value').textContent=speed.toFixed(1);persistSettings();};
input('mirror').onchange=()=>{mirror=input('mirror').checked;persistSettings();};input('lines').onchange=()=>{lines=input('lines').checked;persistSettings();};
input('volume').oninput=()=>{player?.setVolume(Number(input('volume').value));persistSettings();};
input('offset').onchange=()=>{if(!input('offset').checkValidity()||!input('offset').value){message('音频偏移需在 −10000 至 10000 毫秒之间。',true);return;}player?.setOffset(Number(input('offset').value)/1000);persistSettings();};
input('chart-file').onchange=async()=>{
 const file=input('chart-file').files?.[0];if(!file)return;const id=++generation;const task=loading.begin(`正在读取 ${file.name}`,3);
 try{task.update(1,'读取谱面文件…',{downloadedBytes:0,totalBytes:file.size});if(file.size>16*1024*1024)throw new Error('文件超过 16 MiB');const next=decodeChart(new Uint8Array(await file.arrayBuffer()));if(id!==generation)return;
 const matched=songList?findSongByChartFile(songList,file.name)?.song:null;
 const {mvUrl,mvStartSec,mvDurationSec}=matched?songAssets(matched):{mvUrl:null,mvStartSec:0,mvDurationSec:0};
 const selectedMvUrl=input('opt-mv').checked?mvUrl:null;
 const mvSizes=await measureResourceSizes([selectedMvUrl]);
 const mvTotalBytes=mvSizes.get(selectedMvUrl??'');
 const downloads=new Map<string,number>([[file.name,file.size]]);
 const downloadedBytes=()=>[...downloads.values()].reduce((sum,value)=>sum+value,0);
 const totalBytes=file.size+(mvTotalBytes??0);
 const mvReady=musicVideo.setUrl(selectedMvUrl,mvStartSec,mvDurationSec,(state)=>{
  if(selectedMvUrl&&state.downloadedBytes!==undefined)downloads.set(selectedMvUrl,state.downloadedBytes);
  task.update(2,state.phase==='download'?'正在加载 MV…':'MV 已就绪',{downloadedBytes:downloadedBytes(),totalBytes});
 },mvTotalBytes);
 const mvEnd=selectedMvUrl?mvStartSec+mvDurationSec:0;
 if(mvEnd>0)chart.duration=Math.max(chart.duration,mvEnd);
 currentMvId=selectedMvUrl?matched!.id:'';
 task.update(2,`应用谱面（${formatResourceSize(file.size)}）…`,{downloadedBytes:downloadedBytes(),totalBytes});chart=next;finishTime=finishTimeForSong(parseChartName(file.name)?.musicId);comboResult.hide();setChartFever(file.name);el('chart-name').textContent=file.name;setStartInfo(startInfoForFile(file.name));player?.reset();player?.transport.setDuration(chart.duration);metadata();const mvLoaded=await mvReady;
  if(selectedMvUrl&&!mvLoaded)task.fail('MV 加载失败；已回退默认背景。');
  else task.update(3,'预览已更新',{downloadedBytes:downloadedBytes(),totalBytes});
  message(`已加载 ${file.name}${selectedMvUrl?`（MV ${mvLoaded?'✓':'—'}）`:''}。`);}catch(e){if(id===generation)message(`谱面读取失败：${String(e)}。原谱面已保留。`,true);}finally{task.finish();input('chart-file').value='';}
};
input('audio-file').onchange=async()=>{const file=input('audio-file').files?.[0];if(!file||!player)return;const task=loading.begin(`正在读取 ${file.name}`,2);try{task.update(1,'读取音频文件…',{downloadedBytes:0,totalBytes:file.size});if(await player.load(file)){task.update(2,`完成音频解码（${formatResourceSize(file.size)}）…`,{downloadedBytes:file.size,totalBytes:file.size});el('audio-name').textContent=file.name;message('音频已加载，点击播放。');}}catch(e){message(`音频解码失败：${String(e)}。请选择浏览器支持的 WAV、MP3 或 OGG 文件。`,true);}finally{task.finish();input('audio-file').value='';}};
el('demo').onclick=()=>{generation++;musicVideo.setUrl(null);currentMvId='';chart=demoChart();finishTime=null;comboResult.hide();setChartFever('');el('chart-name').textContent='演示谱面';setStartInfo({title:'演示谱面',difficulty:null,jacketUrl:null});player?.clear();player?.transport.setDuration(chart.duration);el('audio-name').textContent='未加载音频 · 可以无声预览';metadata();message('已恢复演示谱。');};
el('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await root.querySelector<HTMLElement>('.viewer')?.requestFullscreen();}catch{message('当前浏览器不允许全屏，可使用浏览器的全屏菜单。',true);}};
const onKeydown=(e:KeyboardEvent)=>{if(exporting)return;if((e.target as HTMLElement).closest('input,select,button,textarea,a'))return;if(e.code==='Space'){e.preventDefault();void toggle();}if(e.code==='ArrowRight'||e.code==='ArrowLeft'){e.preventDefault();if(player)seekTo(player.transport.time+(e.code==='ArrowRight'?5:-5));}};
document.addEventListener('keydown',onKeydown);
const hud=new LiveHud();
void (async()=>{
 try{
  await initialResourceSizesReady;
  const reportImage=(prefix:string)=>(progress:{url:string;phase:'download'|'ready'})=>reportInitialResource(progress.url,progress.phase,undefined,`${prefix} ${resourceName(progress.url)}`);
  const reportGroupReady=(urls:readonly string[],prefix:string)=>{
   for(const url of urls)if(!initialResourceDone.has(url))reportInitialResource(url,'ready',undefined,`${prefix} ${resourceName(url)}`);
  };
		 await Promise.all([
		  preloadImages([START_BASE01_URL],reportImage('开场资源')),
		  loadHudFonts().then(()=>reportGroupReady(['/rg/fonts/FOT-RODINPRO-B.otf','/rg/fonts/FOT-RODINPRO-EB.otf'],'字体')),
	   ...hudTextureUrls.map((url)=>preloadImages([url],reportImage('HUD 贴图'))),
	   comboResult.load((progress:ComboResultLoadProgress)=>reportInitialResource(progress.url,progress.phase,undefined,`结果动画 ${resourceName(progress.url)}`)),
	   (renderer?.whenReady()??Promise.resolve()).then(()=>reportGroupReady(RG_RESOURCE_URLS,'场景资源')),
	   (seOut?.ensureLoaded((progress:SeLoadProgress)=>reportInitialResource(progress.url,progress.phase,progress.downloadedBytes,`SE ${resourceName(progress.url)}`))??Promise.resolve()),
	   preloadImages([LIVE_BG_URL,LIVE_BG_DOT_URL],reportImage('舞台背景')),
	  ]);
  await imagesSettled();
  reportGroupReady(initialResourceUrls,'资源');
  initialResourceTask.update(initialResourceUrls.length,'全部舞台资源已就绪',{downloadedBytes:[...initialResourceDownloads.values()].reduce((sum,value)=>sum+value,0),totalBytes:initialResourceTotal()});
  initialResourceTask.finish('预览资源已就绪');
 }catch(error){
  initialResourceTask.fail(`基础资源加载失败：${String(error)}`);
  message(`基础资源加载失败：${String(error)}`,true);
 }
})();
hud.setSe(se ?? null);
let automaticFever: FeverWindow | null = null;
let baseDuration = chart.duration;
/** 曲终时刻 FinishTime = MusicsRecord.PlayTime(ms) / 1000（LiveEnd.Is = FinishTime ≤ t）；无曲目元数据时为 null，不播曲终横幅。 */
let finishTime: number | null = null;
function applyFever(win: FeverWindow | null, source: string) {
 visualRevision++;
 hud.setFeverWindow(win);
 chart.duration = Math.max(baseDuration, win?.end ?? 0, finishTime === null ? 0 : finishTime + COMBO_RESULT_CLIP_DURATION);
 player?.transport.setDuration(chart.duration);
 metadata();
 el('fever-status').textContent = win ? `${source}：${win.start}–${win.end} 秒` : '未配置 Fever';
}
function restoreFever() {
 input('opt-fever-start').value = automaticFever ? String(automaticFever.start) : '';
 input('opt-fever-end').value = automaticFever ? String(automaticFever.end) : '';
 input('opt-fever-start').removeAttribute('aria-invalid');
 input('opt-fever-end').removeAttribute('aria-invalid');
 applyFever(automaticFever, '歌曲元数据');
}
function setChartFever(filename: string) {
 baseDuration = chart.duration;
 automaticFever = feverForSong(parseChartName(filename)?.musicId);
 restoreFever();
}
function editFever() {
 try {
  const win = parseFeverWindow(input('opt-fever-start').value, input('opt-fever-end').value);
  input('opt-fever-start').removeAttribute('aria-invalid');
  input('opt-fever-end').removeAttribute('aria-invalid');
  applyFever(win, '手动指定');
 } catch (error) {
  input('opt-fever-start').setAttribute('aria-invalid', 'true');
  input('opt-fever-end').setAttribute('aria-invalid', 'true');
  applyFever(null, '');
  el('fever-status').textContent = `${String(error)} 当前 Fever 已停用。`;
 }
}
input('opt-fever-start').oninput = editFever;
input('opt-fever-end').oninput = editFever;
el('fever-reset').onclick = restoreFever;
setChartFever('');
const applyTechScore=()=>{const v=Number(el<HTMLSelectElement>('tech-score').value);hud.setTechnicalScoreDisplay((v===1||v===2?v:0) as 0|1|2);persistSettings();};
el<HTMLSelectElement>('tech-score').onchange=applyTechScore;applyTechScore();
const applyHudOptions=()=>{
 hud.setEnablePerfectPlus(el<HTMLInputElement>('opt-perfect-plus').checked);
 hud.setEnableApContinue(input('opt-ap-continue').checked);
 const jo=Number(el<HTMLSelectElement>('opt-judgement-output').value);
 hud.setJudgementOutput((jo>=0&&jo<=6?jo:0) as 0|1|2|3|4|5|6);
 const fs=Number(el<HTMLSelectElement>('opt-fast-slow').value);
 hud.setFastSlowThreshold((fs===1||fs===2?fs:0) as 0|1|2);
 hud.setJudgementY(Number(input('opt-judge-y').value));
 hud.setFastSlowY(Number(input('opt-fs-y').value));
 hud.setEnableFeverDisplay(input('opt-fever').checked);
 persistSettings();
};
el<HTMLInputElement>('opt-perfect-plus').onchange=applyHudOptions;
el<HTMLSelectElement>('opt-judgement-output').onchange=applyHudOptions;
el<HTMLSelectElement>('opt-fast-slow').onchange=applyHudOptions;
input('opt-judge-y').oninput=()=>{el('opt-judge-y-value').textContent=input('opt-judge-y').value;applyHudOptions();};
input('opt-fs-y').oninput=()=>{el('opt-fs-y-value').textContent=input('opt-fs-y').value;applyHudOptions();};
input('opt-fever').onchange=applyHudOptions;
input('opt-ap-continue').onchange=applyHudOptions;
input('opt-start-anim').onchange=()=>{applyIntro();persistSettings();};
el<HTMLSelectElement>('opt-combo-result').onchange=()=>{comboResult.setKind(readSettings().comboResult);persistSettings();};
input('opt-mv').onchange=()=>{musicVideo.setEnabled(input('opt-mv').checked);persistSettings();};
input('opt-skill-view').onchange=()=>persistSettings();
input('opt-skill-cutin').onchange=()=>persistSettings();
applyHudOptions();

const applyHitEffect=()=>{
 const v=el<HTMLSelectElement>('opt-hit-effect').value;
 renderer?.setHitEffectMode(v==='off'||v==='limited'||v==='full'?v:'current');
 persistSettings();
};
el<HTMLSelectElement>('opt-hit-effect').onchange=applyHitEffect;
applyHitEffect();

const applyVisualOptions=()=>{
 const noteStartZ=Number(input('opt-start-z').value);
 const laneWidth=Number(input('opt-lane-width').value);
 const gridCount=Number(el<HTMLSelectElement>('opt-grid').value);
 const laneDarkness=Number(input('opt-lane-dark').value);
 const backgroundDarkness=Number(input('opt-bg-dark').value);
 el('opt-start-z-value').textContent=String(noteStartZ);
 el('opt-lane-width-value').textContent=String(laneWidth);
 el('opt-lane-dark-value').textContent=String(laneDarkness);
 el('opt-bg-dark-value').textContent=String(backgroundDarkness);
 renderer?.setVisualOptions({noteStartZ,laneWidth,gridCount,laneDarkness});
 // ChangeBackgroundAlpha: Dim _Color.a = BackgroundDarkness/100（只盖舞台背景，不盖 3D / HUD）
 compositor.setBackgroundDim(backgroundDarkness/100);el('stage-canvas').dataset.bgDim=String(compositor.backgroundDim);
 persistSettings();
};
input('opt-start-z').oninput=applyVisualOptions;
input('opt-lane-width').oninput=applyVisualOptions;
input('opt-lane-dark').oninput=applyVisualOptions;
input('opt-bg-dark').oninput=applyVisualOptions;
el<HTMLSelectElement>('opt-grid').onchange=applyVisualOptions;
el<HTMLSelectElement>('opt-fps').onchange=()=>persistSettings();
applyVisualOptions();

input('vol-tap').oninput=()=>{seOut?.setTapVolume(Number(input('vol-tap').value));persistSettings();};
input('vol-se').oninput=()=>{seOut?.setSeVolume(Number(input('vol-se').value));persistSettings();};
input('vol-voice').oninput=()=>persistSettings();

const applyRank=()=>{const v=el<HTMLSelectElement>('rank-preview').value;hud.setRankManual((v==='D'||v==='C'||v==='B'||v==='A'||v==='S'?v:'none') as 'none'|'D'|'C'|'B'|'A'|'S');persistSettings();};
el<HTMLSelectElement>('rank-preview').onchange=applyRank;applyRank();
const applyScoreCfg=()=>{
 const appeal=Number(el<HTMLInputElement>('opt-appeal').value);
 const mastery=Number(el<HTMLInputElement>('opt-mastery').value);
 hud.setScoreConfig({
  totalAppeal:Number.isFinite(appeal)&&appeal>0?appeal:350000,
  musicMasteryLevel:Number.isFinite(mastery)&&mastery>=0?Math.min(50,Math.trunc(mastery)):0,
 });
 persistSettings();
};
el<HTMLInputElement>('opt-appeal').onchange=applyScoreCfg;
el<HTMLInputElement>('opt-mastery').onchange=applyScoreCfg;
applyScoreCfg();

let frame=0;
let comboLastT=0;
let lastLiveFrame: { time: number; chart: typeof chart; playing: boolean; revision: number; image: number; hudTexture: number; resultTexture: boolean; width: number; height: number; dpr: number; mode: string } | null = null;
const invalidatePreview=()=>{visualRevision++;};
const visualInputs=['speed','mirror','lines','opt-start-z','opt-lane-width','opt-grid','opt-lane-dark','opt-bg-dark',
 'opt-judge-y','opt-fs-y','opt-perfect-plus','opt-judgement-output','opt-fast-slow','opt-fever',
 'opt-ap-continue','opt-start-anim','opt-combo-result','opt-hit-effect','rank-preview','tech-score','opt-appeal','opt-mastery'];
for(const id of visualInputs){
 const control=el(id);
 control.addEventListener('input',invalidatePreview);
 control.addEventListener('change',invalidatePreview);
}
/** 实时预览的视口：舞台 CSS 尺寸 × min(dpr, 2)（与渲染器同一上限）。 */
function liveView():StageView{
 const stage=el('stage');
 return {cssW:stage.clientWidth,cssH:stage.clientHeight,dpr:Math.min(2,globalThis.devicePixelRatio||1)};
}
/** 3D 画布 render() 之后立即合成（缓冲只在本帧内有效）。 */
function composeStage(view:StageView,t:number,video:HTMLVideoElement|null=musicVideo.frame(t)){
 compositor.draw(view,{gl:el<HTMLCanvasElement>('chart-canvas'),video,videoBackground:musicVideo.useVideoBackground,hud,startAnim,comboResult});
 const c=el('stage-canvas');
 const active=musicVideo.useVideoBackground?currentMvId:'';if(c.dataset.mv!==active)c.dataset.mv=active;
 const intro=startAnim.state??'';if(c.dataset.intro!==intro)c.dataset.intro=intro;
 const result=comboResult.visible?String(comboResult.resultKind):'';if(c.dataset.result!==result)c.dataset.result=result;
}
/**
 * 曲终横幅：t ≥ FinishTime 时显示 clip 时刻 t − FinishTime（随走带时间，拖动可复现）；
 * 播放中正向越过 FinishTime 时播一次 se_rhythm_finish_0004（自动演奏恒为 AllPerfect）。
 */
function syncComboResult(t:number,playing:boolean){
 if(finishTime===null||t<finishTime){if(comboResult.visible)comboResult.hide();comboLastT=t;return;}
 if(playing&&comboLastT<finishTime&&t-finishTime<0.25)se?.playFinish(comboResult.resultKind);
 comboResult.render(t-finishTime);
 comboLastT=t;
}
function animate(){
 if(player&&renderer){
  const tr=player.transport,was=tr.playing,t=tr.time;
  if(was&&!tr.playing){player.pause();se?.pause();}
  const playing=tr.playing;
  const view=liveView();
  const next={time:t,chart,playing,revision:visualRevision,image:loadedImageRevision(),
   hudTexture:hud.textureRevision,resultTexture:comboResult.texturesReady,
   width:view.cssW,height:view.cssH,dpr:view.dpr,mode:renderer.getCameraMode()};
  const previous=lastLiveFrame;
  const changed=!previous||previous.time!==t||previous.chart!==chart||previous.playing!==playing||
   previous.revision!==next.revision||previous.image!==next.image||previous.hudTexture!==next.hudTexture||
   previous.resultTexture!==next.resultTexture||previous.width!==next.width||previous.height!==next.height||
   previous.dpr!==next.dpr||previous.mode!==next.mode;
  if(playing||changed){
   musicVideo.sync(t,playing,tr.rate);
   hud.sync(chart,t,playing);syncComboResult(t,was&&playing);
   renderer.setPlaying(playing);renderer.setFeverState(hud.feverVisible,hud.feverWindowStart);renderer.render(chart,t,speed,mirror,lines);
   input('timeline').value=String(t);el('time').textContent=`${format(t)} / ${format(chart.duration)}`;
   startAnim.show(tr.start<0&&t<0?(!playing&&t<=tr.start+1e-6?'idle':t-tr.start):null);
   composeStage(view,t);
   const skip=playing&&t<0;
   el('play').textContent=skip?'⏭ 跳过开场':playing?'Ⅱ 暂停':'▶ 播放';el('play').setAttribute('aria-label',skip?'跳过开场':playing?'暂停':'播放');
   lastLiveFrame=next;
  }
 }
 frame=requestAnimationFrame(animate);
}animate();

/* ── 视频导出：同一条 canvas 合成路径，按虚拟时钟逐帧渲染 ── */
/** 逻辑步频：实时预览每个动画帧推进一次 HUD 判定与 SeResolver（3 帧窗口）；导出按 60 Hz 细分（推断：原包 MainLogic 以 60 fps 运行）。 */
const EXPORT_LOGIC_HZ=60;
/** 起点前预滚（秒）：让起点时刻已在飞的击中特效、hold 光效与 HUD 动画在第一帧就存在（时长为推断值）。 */
const EXPORT_PREROLL_SEC=1;
function createExportSource(opts:{intro:boolean}):ExportFrameSource{
 const canvas=el<HTMLCanvasElement>('stage-canvas');
 const gl=el<HTMLCanvasElement>('chart-canvas');
 let view:StageView={cssW:1920,cssH:1080,dpr:1};
 let capture:CapturingSeOutput|null=null,liveSe:SeResolver|undefined,resumeAt=0,lastLogic=0,lastFrame=0,phaseAcc=0,began=false;
 const minStart=opts.intro?EXPORT_OPENING.startSec:EXPORT_OPENING.endSec;
 /** 一个逻辑步：HUD 判定 + SE 派发（记成事件）+ 曲终横幅。 */
 const logicStep=(tau:number)=>{capture!.now=tau;hud.sync(chart,tau,true);syncComboResult(tau,true);};
 /** 逻辑推进到 t：按 ≤1/60 s 等分细分，最后一步恰好落在 t。 */
 const advanceLogic=(t:number)=>{
  const dt=t-lastLogic;if(!(dt>0))return;
  const n=Math.max(1,Math.ceil(dt*EXPORT_LOGIC_HZ-1e-6));
  for(let k=1;k<=n;k++)logicStep(k===n?t:lastLogic+dt*k/n);
  lastLogic=t;
 };
 /** 3D 场景推进到 t（特效按 dt 逐帧步进，hold 呼吸按 dt×60 折算步数）。 */
 const renderScene=(t:number)=>{
  const r=renderer!;
  phaseAcc+=Math.max(0,t-lastFrame)*60;const steps=Math.floor(phaseAcc+1e-6);phaseAcc-=steps;r.setPhaseSteps(steps);
  r.setPlaying(true);r.setFeverState(hud.feverVisible,hud.feverWindowStart);r.render(chart,t,speed,mirror,lines);
  lastFrame=t;
 };
 const showIntro=(t:number)=>startAnim.show(opts.intro&&t<0?t-minStart:null);
 return {
  canvas,
  async begin(width,height,startSec){
   if(!player||!renderer||!se||!seOut)throw new Error('预览未初始化');
   exporting=true;began=true;
   cancelAnimationFrame(frame);frame=0;
   const tr=player.transport;resumeAt=tr.time;
   player.pause();se.pause();player.setRate(1);musicVideo.beginExport();
   view={cssW:width,cssH:height,dpr:1};
   renderer.setFixedSize({w:width,h:height,dpr:1});
   canvas.classList.add('exporting');
   await Promise.all([loadHudFonts(),preloadImages(LiveHud.textureUrls()),comboResult.load(),renderer.whenReady(),seOut.ensureLoaded()]);
   // 过场贴图（封面等）在首次绘制时才请求：先各画一遍再等全部贴图就绪。
   if(opts.intro)for(const c of [0,0.5,1,1.5,2,2.5,3,3.5]){startAnim.show(c);compositor.draw(view,{gl,hud,startAnim,comboResult});}
   startAnim.show(null);
   await imagesSettled();
   const out=seOut;
   capture=new CapturingSeOutput({tapVolume:out.tapVolume,seVolume:out.seVolume,hasCue:(i)=>out.cueBuffers.has(i)});
   liveSe=se;se=new SeResolver(capture);hud.setSe(se);
   // 预滚：暂停语义直接重建到 p0（特效清空、hold 光效按时刻补回），之后按播放语义逐步推进到起点。
   const p0=Math.max(minStart,startSec-EXPORT_PREROLL_SEC);
   // 两次暂停语义的跳转（p0−1 ms → p0）保证 HUD 与特效都从 p0 重建，不沿用实时预览残留的状态。
   capture.now=p0;hud.sync(chart,p0-1e-3,false);hud.sync(chart,p0,false);comboLastT=p0;if(finishTime===null||p0<finishTime)comboResult.hide();
   renderer.setPhaseSteps(0);renderer.setPlaying(false);renderer.render(chart,p0-1e-3,speed,mirror,lines);renderer.render(chart,p0,speed,mirror,lines);
   lastLogic=p0;lastFrame=p0;phaseAcc=0;
   // 开场 SE：与 kickStartSe 同规则——含过场时在过场开头（−START_CLIP_DURATION）起播；
   // 不含过场时仅从 0 秒（≤0.05 s）开始导出才放。起点之前的事件在混音时从中途接上。
   if(opts.intro){capture.now=minStart;se.playStart(0);}
   else if(startSec<=0.05){capture.now=startSec;se.playStart(Math.max(0,startSec));}
   for(let tau=p0+1/EXPORT_LOGIC_HZ;tau<startSec-1e-9;tau+=1/EXPORT_LOGIC_HZ){advanceLogic(tau);renderScene(tau);}
  },
  async renderAt(t,signal){
   const video=await musicVideo.seekFrame(t,signal);
   advanceLogic(t);
   renderScene(t);
   showIntro(t);
   composeStage(view,t,video);
  },
  collectAudio(endSec){
   // 视频最后一帧还覆盖一个帧间隔；补齐该区间的音效，再按实际片长截断循环音。
   advanceLogic(endSec);
   const out=seOut!,buffers=new Map<string,AudioBuffer>();
   for(const [i,b] of out.cueBuffers)buffers.set(String(i),b);
   capture?.finish(endSec);
   return {
    events:capture?capture.events.map(e=>({...e})):[],
    bgm:player?.audioBuffer??null,bgmStartSec:player?.offset??0,bgmVolume:player?.volume??0,
    soundVolume:1,soundBuffers:buffers,
    // 实时预览的 hold 循环是整段循环（loop=true，无循环点）。
    loopPoints:()=>null,
   };
  },
  end(){
   if(!began)return;began=false;
   if(liveSe){se=liveSe;hud.setSe(se);liveSe=undefined;}
   capture=null;
   renderer?.setFixedSize(null);renderer?.setPhaseSteps(1);
   canvas.classList.remove('exporting');
   startAnim.show(null);
   lastLiveFrame=null;
   exporting=false;musicVideo.endExport();
   if(player){player.setRate(Number(el<HTMLSelectElement>('rate').value));seekTo(resumeAt);}
   comboLastT=resumeAt;
   if(!frame)frame=requestAnimationFrame(animate);
  },
 };
}
const exportDialog=installExportDialog(el<HTMLButtonElement>('export-video'),{
 opening:EXPORT_OPENING,
 openingLabel:'包含开场过场（负时刻；关闭时最早从 0 秒起）',
 fileNamePrefix:'llll-preview',
 createSource:createExportSource,
 // 走带终点已含曲终横幅（chart.duration ≥ FinishTime + 横幅时长）。
 durationSec:()=>player?.transport.duration??chart.duration,
 openingDefault:()=>input('opt-start-anim').checked,
 lockTargets:()=>[document.querySelector<HTMLElement>('.workspace-header')!,document.querySelector<HTMLElement>('aside')!,document.querySelector<HTMLElement>('.transport')!],
 title:()=>el('chart-name').textContent??'',
 message,
});
if(!player)el<HTMLButtonElement>('export-video').disabled=true;

/** 测试 / 调试钩子（只读取状态；导出探测 / 自动化验证用）。 */
(window as unknown as {__LPW__:unknown}).__LPW__={
 hud,startAnim,comboResult,compositor,musicVideo,exportDialog,
 get renderer(){return renderer;},get player(){return player;},
 probeExportConfigs:probeAllConfigs,
};
let disposed=false;
let unsubscribeSongSelection=()=>{};
const dispose=()=>{if(disposed)return;disposed=true;generation++;unsubscribeSongSelection();el('open-chart').onclick=null;el('open-audio').onclick=null;el('demo').onclick=null;el('chart-file').onchange=null;el('audio-file').onchange=null;el('fullscreen').onclick=null;cancelAnimationFrame(frame);musicVideo.dispose();renderer?.dispose();player?.dispose();seOut?.dispose();hud.dispose();startAnim.dispose();comboResult.dispose();document.removeEventListener('keydown',onKeydown);window.removeEventListener('pagehide',dispose);if((window as unknown as {__LPW__?:unknown}).__LPW__)delete (window as unknown as {__LPW__?:unknown}).__LPW__;};
window.addEventListener('pagehide',dispose,{once:true});

/* ── 选曲：统一壳层持有选择器，舞台只负责加载与渲染 ── */
let songList:SongList|null=null;
/** 本地打开的谱面若是 rhythmgame_chart_<id>_<n>.bytes，就按曲目列表补上曲名 / 难度 / 封面。 */
function startInfoForFile(name:string){
 const hit=songList?findSongByChartFile(songList,name):null;
 return hit?{title:hit.song.title,difficulty:hit.difficulty,jacketUrl:songAssets(hit.song).coverUrl}:{title:name,difficulty:null,jacketUrl:null};
}
/** 按曲目 Id 打开：谱面 + BGM；封面 / 曲名 / 难度色交给开场过场。 */
async function loadSongById(songId:string,difficulty:string){
 const task=loading.begin(`正在加载曲目 ${songId} [${difficulty}]`,input('opt-mv').checked?5:4);
 const downloads=new Map<string,number>();
 const downloadedBytes=()=>[...downloads.values()].reduce((sum,value)=>sum+value,0);
 let downloadTotalBytes: number|undefined;
 const updateDownload=(url:string,name:string,state:{phase:'download'|'ready';downloadedBytes?:number})=>{
  if(state.downloadedBytes!==undefined)downloads.set(url,state.downloadedBytes);
  if(state.phase==='ready'&&!downloads.has(url))downloads.set(url,0);
  task.setLabel(`加载 ${name}`);
  task.update(0,state.phase==='download'?`正在下载 ${name}…`:`${name} 已下载`,{downloadedBytes:downloadedBytes(),totalBytes:downloadTotalBytes});
 };
 try{
  task.update(0,'查找曲目资源…');
  const song=await findSong(songId,(state)=>updateDownload(SONG_LIST_URL,'曲目库',state));
  if(!song)throw new Error(`曲目列表里没有 Id ${songId}`);
  const chartFile=song.charts[difficulty];
  if(!chartFile)throw new Error(`曲目 ${songId} 没有难度 ${difficulty} 的谱面`);
  const chartUrl=`/assets/chart/${chartFile}`;
  const {bgmUrl,coverUrl,mvUrl,mvStartSec,mvDurationSec}=songAssets(song);
  const activeMvUrl=input('opt-mv').checked?mvUrl:null;
  task.update(0,'正在统计曲目资源大小…');
  const downloadSizes=await measureResourceSizes([SONG_LIST_URL,chartUrl,bgmUrl,coverUrl,activeMvUrl]);
  downloadTotalBytes=totalResourceSize(downloadSizes);
  task.setLabel(`正在加载 ${song.title} [${difficulty}]`);
  task.update(0,'正在查找谱面…',{downloadedBytes:downloadedBytes(),totalBytes:downloadTotalBytes});
  const id=++generation;
  message(`正在加载 ${song.title} [${difficulty}]…`);
  task.update(1,'正在下载谱面…',{downloadedBytes:downloadedBytes(),totalBytes:downloadTotalBytes});
  const chartBytes=await fetchBytes(chartUrl,(state)=>updateDownload(chartUrl,'谱面',state));
  if(!chartBytes)throw new Error(`谱面下载失败：${chartFile}。请先运行 python scripts/link-assets.py`);
  const next=decodeChart(chartBytes);
  task.update(2,`谱面已下载（${formatResourceSize(chartBytes.byteLength)}），正在下载 BGM…`,{downloadedBytes:downloadedBytes(),totalBytes:downloadTotalBytes});
  const bgm=await fetchBytes(bgmUrl,(state)=>{
   if(state.downloadedBytes!==undefined&&bgmUrl)downloads.set(bgmUrl,state.downloadedBytes);
   task.update(2,state.phase==='download'?'正在下载 BGM…':'BGM 已下载',{downloadedBytes:downloadedBytes(),totalBytes:downloadTotalBytes});
  });
  if(id!==generation)return;
  chart=next;player?.clear();
  const selectedMvUrl=input('opt-mv').checked?mvUrl:null;
  const mvReady=musicVideo.setUrl(selectedMvUrl,mvStartSec,mvDurationSec,(state)=>{
   if(selectedMvUrl&&state.downloadedBytes!==undefined)downloads.set(selectedMvUrl,state.downloadedBytes);
   task.update(4,state.phase==='download'?'正在加载 MV…':'MV 已就绪',{downloadedBytes:downloadedBytes(),totalBytes:downloadTotalBytes});
  },downloadSizes.get(selectedMvUrl ?? ''));
  const mvEnd=selectedMvUrl?mvStartSec+mvDurationSec:0;
  if(mvEnd>0)chart.duration=Math.max(chart.duration,mvEnd);
  currentMvId=selectedMvUrl?song.id:'';finishTime=finishTimeForSong(songId);comboResult.hide();setChartFever(chartFile);
  el('chart-name').textContent=`${song.title} [${difficulty}]`;
  setStartInfo({title:song.title,difficulty,jacketUrl:coverUrl});
  player?.transport.setDuration(chart.duration);metadata();
  task.update(3,`正在解码 BGM${bgm?`（${formatResourceSize(bgm.byteLength)}）`:''}…`,{downloadedBytes:downloadedBytes(),totalBytes:downloadTotalBytes});
  let hasBgm=false;
  if(bgm&&player){try{hasBgm=await player.loadBuffer(bgm.buffer as ArrayBuffer);}catch(e){console.warn('[llll-preview] BGM 解码失败：',e);}}
  if(id!==generation)return;
  task.update(3,'正在加载曲绘…',{downloadedBytes:downloadedBytes(),totalBytes:downloadTotalBytes});
  if(coverUrl)await preloadImages([coverUrl],(state)=>updateDownload(coverUrl,'曲绘',state));
  if(id!==generation)return;
  if(coverUrl&&downloadSizes.has(coverUrl))downloads.set(coverUrl,downloadSizes.get(coverUrl)!);
  task.update(4,'正在等待 MV 就绪…',{downloadedBytes:downloadedBytes(),totalBytes:downloadTotalBytes});
  const mvLoaded=await mvReady;
  if(id!==generation)return;
  const mvTotal=selectedMvUrl?5:4;
  if(selectedMvUrl&&!mvLoaded)task.fail('MV 加载失败；已回退默认背景。');
  else task.update(mvTotal,selectedMvUrl?'MV 已就绪':'预览已更新',{downloadedBytes:downloadedBytes(),totalBytes:downloadTotalBytes});
  el('audio-name').textContent=hasBgm?`bgm_${song.soundId}.ogg`:'未找到 BGM · 可以无声预览';
  task.update(mvTotal,'预览已更新',{downloadedBytes:downloadedBytes(),totalBytes:downloadTotalBytes});
  message(`已加载 ${song.title} [${difficulty}]（BGM ${hasBgm?'✓':'—'}${selectedMvUrl?`，MV ${mvLoaded?'✓':'—'}`:''}），点击播放。`);
 }finally{task.finish();}
}
void loadSongList().then((list)=>{if(!disposed)songList=list}).catch((error)=>{
 console.warn('[llll-preview] 曲目列表加载失败：',error);
});
const openSong=async(songId:string,difficulty:string)=>{
 try{await loadSongById(songId,difficulty);}
 catch(e){if(!disposed)message(`曲目加载失败：${String(e)}`,true);}
};
unsubscribeSongSelection=songSelection.subscribe((selection)=>{
 if(selection)void openSong(selection.songId,selection.difficulty);
},false);
const initialSelection=songSelection.get();
if(initialSelection){
 const offset=new URLSearchParams(location.search).get('offset');
 if(offset!==null&&offset!==''&&Number.isFinite(Number(offset))){input('offset').value=offset;player?.setOffset(Number(offset)/1000);}
 void openSong(initialSelection.songId,initialSelection.difficulty);
}
return {dispose};
}
