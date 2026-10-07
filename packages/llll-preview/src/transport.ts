export class Transport {
  playing=false;
  rate=1;
  duration=1;
  /** 走带起点（≤0）。开场过场开启时为 −START_CLIP_DURATION，0 秒 = 谱面 / BGM 起点。 */
  start=0;
  private base=0;
  private anchor=0;
  constructor(private readonly now:()=>number){}
  get time(){
    const t=this.playing?this.base+(this.now()-this.anchor)*this.rate:this.base;
    if(t>=this.duration){this.base=this.duration;this.playing=false;return this.duration;}
    return t;
  }
  play(){if(this.playing)return;if(this.base>=this.duration)this.base=this.start;this.anchor=this.now();this.playing=true;}
  pause(){this.base=this.time;this.playing=false;}
  seek(t:number){this.check(t);this.base=Math.max(this.start,Math.min(t,this.duration));this.anchor=this.now();}
  setRate(rate:number){this.check(rate);if(rate<=0||rate>4)throw new Error('播放倍率需大于 0 且不超过 4');this.base=this.time;this.anchor=this.now();this.rate=rate;}
  setStart(start:number){this.check(start);if(start>0)throw new Error('起点不能晚于 0 秒');this.start=start;this.seek(this.time);}
  setDuration(duration:number){this.check(duration);if(duration<=0)throw new Error('时长必须大于 0');this.duration=duration;this.seek(this.time);}
  private check(n:number){if(!Number.isFinite(n))throw new Error('播放参数必须是有限数');}
}
