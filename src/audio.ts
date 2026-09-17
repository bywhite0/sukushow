import { Transport } from './transport';
export class AudioPlayer {
  readonly context=new AudioContext();
  readonly transport=new Transport(()=>this.context.currentTime);
  private buffer:AudioBuffer|null=null;
  private source:AudioBufferSourceNode|null=null;
  private gain=this.context.createGain();
  private generation=0;
  offset=0;
  constructor(){this.gain.connect(this.context.destination);}
  async load(file:File){
    if(file.size>128*1024*1024)throw new Error('音频超过 128 MiB');
    const id=++this.generation;
    const buffer=await this.context.decodeAudioData(await file.arrayBuffer());
    if(id!==this.generation)return false;
    this.buffer=buffer;this.sync();return true;
  }
  async play(){await this.context.resume();if(this.context.state!=='running')throw new Error('浏览器未允许音频播放，请再次点击播放');this.transport.play();this.sync();}
  pause(){this.transport.pause();this.stopSource();}
  seek(time:number){this.transport.seek(time);this.sync();}
  setRate(rate:number){this.transport.setRate(rate);this.sync();}
  setOffset(seconds:number){if(!Number.isFinite(seconds))throw new Error('偏移必须是有限数');this.offset=seconds;this.sync();}
  setVolume(volume:number){this.gain.gain.value=Math.max(0,Math.min(1,volume));}
  reset(){this.pause();this.transport.seek(0);}
  clear(){this.generation++;this.buffer=null;this.reset();}
  private sync(){
    this.stopSource();if(!this.buffer||!this.transport.playing)return;
    const t=this.transport.time-this.offset;if(t>=this.buffer.duration)return;
    const source=this.context.createBufferSource();source.buffer=this.buffer;source.playbackRate.value=this.transport.rate;source.connect(this.gain);
    source.start(this.context.currentTime+Math.max(0,-t)/this.transport.rate,Math.max(0,t));this.source=source;
  }
  private stopSource(){if(!this.source)return;this.source.stop();this.source.disconnect();this.source=null;}
  dispose(){this.generation++;this.stopSource();this.gain.disconnect();void this.context.close();}
}
