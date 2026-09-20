import './style.css';
import './workspace.css';
import { decodeChart } from './chart';
import { demoChart } from './demo';
import feverIndex from './feverMetadata.json';
import { feverForFilename, parseFeverWindow } from './feverMetadata';
import type { FeverWindow } from './fever';
import { AudioPlayer } from './audio';
import { createWebAudioSeOutput, SeResolver } from './se';
import { PreviewRenderer } from './renderer';
import { LiveHud } from './hud';
import {
  loadPreviewSettings,
  savePreviewSettings,
  type PreviewSettings,
} from './settingsPersist';
const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`
<header class="workspace-header"><a class="brand" href="./" aria-label="llll 谱面放映室首页"><span class="brand-mark" aria-hidden="true">llll</span><span>谱面放映室<small>CHART PREVIEW</small></span></a><div class="file-toolbar" aria-label="打开谱面与音频"><button id="open-chart" class="file-action" type="button">＋ 打开谱面</button><input class="sr-only" id="chart-file" type="file" accept=".json,.bytes" aria-label="选择谱面文件"><button id="open-audio" class="quiet" type="button">添加音频</button><input class="sr-only" id="audio-file" type="file" accept="audio/*" aria-label="添加本地音频"><button id="demo" class="text-button" type="button" aria-label="重新打开演示谱">演示谱</button></div><span class="local-badge">本地运行 · 文件不上传</span></header>
<main>
<section class="viewer" aria-label="谱面预览">
 <div class="preview-heading"><div class="current-file"><span class="section-label">当前谱面</span><h1 id="chart-name">演示谱面</h1></div><span class="file-name" id="audio-name">未加载音频 · 可以无声预览</span></div>
 <div class="stage-shell"><div class="stage" id="stage"><div id="live-bg" class="live-bg" aria-hidden="true"><div class="live-bg-image"></div><div class="live-bg-dot"></div></div><div id="live-bg-dim" class="live-bg-dim" aria-hidden="true"></div><canvas id="chart-canvas" aria-label="三维谱面画布"></canvas></div></div>
 <div id="message" class="viewer-status" role="status" aria-live="polite">就绪。选择本地谱面，或播放演示。</div>
 <div class="transport"><label class="sr-only" for="timeline">播放进度</label><input id="timeline" type="range" min="0" max="36" step="0.001" value="0"><div class="transport-row"><button id="play" class="primary" aria-label="播放">▶ 播放</button><button id="restart" class="quiet" aria-label="回到开头">↺ 重播</button><output id="time">00:00.000 / 00:36.000</output><label class="rate-label">播放倍率<select id="rate"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button id="fullscreen" class="quiet">全屏预览</button></div></div>
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
</main><footer><span>非官方研究工具 · 原格式谱面预览</span><span><kbd>Space</kbd> 播放 / 暂停 <kbd>←</kbd><kbd>→</kbd> 跳转 5 秒</span></footer>`;
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const input=(id:string)=>el<HTMLInputElement>(id);
const message=(text:string,error=false)=>{el('message').textContent=text;el('message').classList.toggle('error',error);};
el('open-chart').onclick=()=>input('chart-file').click();
el('open-audio').onclick=()=>input('audio-file').click();
el('panel-display').querySelector('h2')!.after(el('opt-hit-effect').closest('label')!);
el('panel-score').querySelector('h2')!.after(el('tech-score').closest('label')!);
const settingTabs=Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
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
  judgementOutput:Number(el<HTMLSelectElement>('opt-judgement-output').value),
  fastSlow:Number(el<HTMLSelectElement>('opt-fast-slow').value),
  totalAppeal:Number(input('opt-appeal').value),
  musicMasteryLevel:Number(input('opt-mastery').value),
  rankPreview:(()=>{const v=el<HTMLSelectElement>('rank-preview').value;return v==='D'||v==='C'||v==='B'||v==='A'||v==='S'?v:'none';})(),
  techScore:(()=>{const v=Number(el<HTMLSelectElement>('tech-score').value);return (v===1||v===2?v:0) as 0|1|2;})(),
  rate:Number(el<HTMLSelectElement>('rate').value),
  hitEffect:(()=>{const v=el<HTMLSelectElement>('opt-hit-effect').value;return v==='off'||v==='limited'||v==='full'?v:'current';})(),
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
 el<HTMLSelectElement>('opt-judgement-output').value=String(s.judgementOutput);
 el<HTMLSelectElement>('opt-fast-slow').value=String(s.fastSlow);
 input('opt-appeal').value=String(s.totalAppeal);
 input('opt-mastery').value=String(s.musicMasteryLevel);
 el<HTMLSelectElement>('rank-preview').value=s.rankPreview;
 el<HTMLSelectElement>('tech-score').value=String(s.techScore);
 el<HTMLSelectElement>('rate').value=String(s.rate);
 el<HTMLSelectElement>('opt-hit-effect').value=s.hitEffect;
}
applySettingsToForm(loadPreviewSettings());

let chart=demoChart(),generation=0,speed=Number(input('speed').value),mirror=input('mirror').checked,lines=input('lines').checked;
let renderer:PreviewRenderer|undefined,player:AudioPlayer|undefined;let seOut:ReturnType<typeof createWebAudioSeOutput>|undefined;let se:SeResolver|undefined;
try{renderer=new PreviewRenderer(el<HTMLCanvasElement>('chart-canvas'));player=new AudioPlayer();seOut=createWebAudioSeOutput(player.context);void seOut.ensureLoaded();se=new SeResolver(seOut);seOut.setTapVolume(Number(input('vol-tap').value));seOut.setSeVolume(Number(input('vol-se').value));player.setVolume(Number(input('volume').value));player.setRate(Number(el<HTMLSelectElement>('rate').value));player.setOffset(Number(input('offset').value)/1000);player.transport.setDuration(chart.duration);}catch(error){message(`无法初始化预览：${String(error)}。请启用 WebGL 和音频支持后刷新。`,true);el<HTMLButtonElement>('play').disabled=true;}
const format=(s:number)=>`${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(3).padStart(6,'0')}`;
function metadata(){input('timeline').max=String(chart.duration);}metadata();
async function toggle(){if(!player)return;try{if(player.transport.playing){player.pause();se?.pause();}else{await player.play();se?.resume();if(player.transport.time<=0.05)se?.playStart();}}catch(e){message(`播放失败：${String(e)}`,true);}}
el('play').onclick=()=>void toggle();
el('restart').onclick=()=>{player?.seek(0);se?.clear();};
input('timeline').oninput=()=>{player?.seek(Number(input('timeline').value));se?.clear();};
el<HTMLSelectElement>('rate').onchange=()=>{player?.setRate(Number(el<HTMLSelectElement>('rate').value));persistSettings();};
input('speed').oninput=()=>{speed=Number(input('speed').value);el('speed-value').textContent=speed.toFixed(1);persistSettings();};
input('mirror').onchange=()=>{mirror=input('mirror').checked;persistSettings();};input('lines').onchange=()=>{lines=input('lines').checked;persistSettings();};
input('volume').oninput=()=>{player?.setVolume(Number(input('volume').value));persistSettings();};
input('offset').onchange=()=>{if(!input('offset').checkValidity()||!input('offset').value){message('音频偏移需在 −10000 至 10000 毫秒之间。',true);return;}player?.setOffset(Number(input('offset').value)/1000);persistSettings();};
input('chart-file').onchange=async()=>{
 const file=input('chart-file').files?.[0];if(!file)return;const id=++generation;
 try{if(file.size>16*1024*1024)throw new Error('文件超过 16 MiB');const next=decodeChart(new Uint8Array(await file.arrayBuffer()));if(id!==generation)return;
 chart=next;setChartFever(file.name);el('chart-name').textContent=file.name;player?.reset();player?.transport.setDuration(chart.duration);metadata();message(`已加载 ${file.name}。`);}catch(e){if(id===generation)message(`谱面读取失败：${String(e)}。原谱面已保留。`,true);}finally{input('chart-file').value='';}
};
input('audio-file').onchange=async()=>{const file=input('audio-file').files?.[0];if(!file||!player)return;try{if(await player.load(file)){el('audio-name').textContent=file.name;message('音频已加载，点击播放。');}}catch(e){message(`音频解码失败：${String(e)}。请选择浏览器支持的 WAV、MP3 或 OGG 文件。`,true);}finally{input('audio-file').value='';}};
el('demo').onclick=()=>{generation++;chart=demoChart();setChartFever('');el('chart-name').textContent='演示谱面';player?.clear();player?.transport.setDuration(chart.duration);el('audio-name').textContent='未加载音频 · 可以无声预览';metadata();message('已恢复演示谱。');};
el('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('.viewer')?.requestFullscreen();}catch{message('当前浏览器不允许全屏，可使用浏览器的全屏菜单。',true);}};
document.addEventListener('keydown',e=>{if((e.target as HTMLElement).closest('input,select,button,textarea,a'))return;if(e.code==='Space'){e.preventDefault();void toggle();}if(e.code==='ArrowRight'||e.code==='ArrowLeft'){e.preventDefault();player?.seek(player.transport.time+(e.code==='ArrowRight'?5:-5));}});
const hud=new LiveHud(el('stage'));
hud.setSe(se ?? null);
let automaticFever: FeverWindow | null = null;
let baseDuration = chart.duration;
function applyFever(win: FeverWindow | null, source: string) {
 hud.setFeverWindow(win);
 chart.duration = Math.max(baseDuration, win?.end ?? 0);
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
 automaticFever = feverForFilename(filename, feverIndex);
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
input('opt-ap-continue').onchange=()=>persistSettings();
input('opt-mv').onchange=()=>persistSettings();
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
 const dim=el<HTMLElement>('live-bg-dim');
 // ChangeBackgroundAlpha: Dim _Color.a = BackgroundDarkness/100 (not whole viewer)
 if(dim) dim.style.opacity=String(Math.max(0,Math.min(1,backgroundDarkness/100)));
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
function animate(){
 if(player&&renderer){const was=player.transport.playing,t=player.transport.time;if(was&&!player.transport.playing)player.pause();hud.sync(chart,t);renderer.setFeverState(hud.feverVisible,hud.feverWindowStart);renderer.render(chart,t,speed,mirror,lines);input('timeline').value=String(t);el('time').textContent=`${format(t)} / ${format(chart.duration)}`;el('play').textContent=player.transport.playing?'Ⅱ 暂停':'▶ 播放';el('play').setAttribute('aria-label',player.transport.playing?'暂停':'播放');}
 frame=requestAnimationFrame(animate);
}animate();
window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);renderer?.dispose();player?.dispose();seOut?.dispose();hud.dispose();},{once:true});
