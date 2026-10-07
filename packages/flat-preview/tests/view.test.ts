import { describe, expect, it } from 'vitest';
import { parseChart } from '../src/chart';
import {
  LANES, chainEnd, chainQuads, defaultLayout, edgeX, holdQuad, instantRect,
  measures, noteSpan, scrollToBottom, scrollToLine, timeY, trackWidth, yTime,
} from '../src/view';

/** l/r 为头端点轨道，l2/r2 为尾端点轨道。 */
const flags = (type: number, l: number, r: number, l2 = l, r2 = r) =>
  (type & 15) | ((r & 63) << 4) | ((r2 & 63) << 10) | ((l & 63) << 16) | ((l2 & 63) << 22);

const lay = () => defaultLayout();

describe('坐标系', () => {
  it('轨道 0 的左缘贴住栏左边界', () => {
    const l = lay();
    expect(edgeX(0, l)).toBe(l.padX);
  });

  it('轨道 59 的右缘贴住栏右边界', () => {
    const l = lay();
    expect(edgeX(LANES, l)).toBe(l.padX + trackWidth(l));
  });

  it('轨道中心即边界的等差中项', () => {
    const l = lay();
    expect((edgeX(10, l) + edgeX(11, l)) / 2).toBe(l.padX + 10.5 * l.lanePx);
  });

  it('镜像把边界沿栏中心对折', () => {
    const a = lay(), b = { ...lay(), mirror: true };
    const left = a.padX, right = a.padX + trackWidth(a);
    for (let edge = 0; edge <= LANES; edge++) {
      expect(edgeX(edge, b)).toBeCloseTo(left + right - edgeX(edge, a));
    }
  });

  it('镜像对合：翻转两次回到原位', () => {
    const a = lay(), b = { ...a, mirror: true };
    for (let edge = 0; edge <= LANES; edge += 7) {
      expect(edgeX(edge, { ...b, mirror: false })).toBe(edgeX(edge, a));
    }
  });
});

describe('时间轴', () => {
  it('0 秒落在内容底端', () => {
    const l = { ...lay(), duration: 10 };
    // 内容底端 = padY + duration*pxPerSec（未滚动）
    expect(timeY(0, l)).toBe(l.padY + 10 * l.pxPerSec);
  });

  it('时间向上递增（越晚越靠上）', () => {
    const l = { ...lay(), duration: 10 };
    expect(timeY(2, l)).toBeLessThan(timeY(1, l));
  });

  it('总时长落在顶部留白处', () => {
    const l = { ...lay(), duration: 10 };
    expect(timeY(10, l)).toBe(l.padY);
  });

  it('yTime 与 timeY 互逆', () => {
    const l = { ...lay(), duration: 200, scrollPx: 320 };
    for (const t of [0, 1.5, 12.25, 200]) expect(yTime(timeY(t, l), l)).toBeCloseTo(t);
  });

  it('滚动偏移把内容上移', () => {
    const l = { ...lay(), duration: 10 };
    expect(timeY(5, { ...l, scrollPx: 100 })).toBe(timeY(5, l) - 100);
  });

  it('scrollToBottom 让该时刻贴住视口底边', () => {
    const l = { ...lay(), duration: 60 };
    const s = scrollToBottom(30, l, 500);
    expect(timeY(30, { ...l, scrollPx: s })).toBeCloseTo(500);
  });

  it('视口显示的是 [t, t + 视口高/pxPerSec] 这一段', () => {
    const l = { ...lay(), duration: 60 };
    const s = scrollToBottom(30, l, 500);
    const view = { ...l, scrollPx: s };
    // 底边 = t，顶边 = t + 500/pxPerSec
    expect(yTime(500, view)).toBeCloseTo(30);
    expect(yTime(0, view)).toBeCloseTo(30 + 500 / l.pxPerSec);
  });

  it('scrollToLine 让当前时刻贴住固定判定线', () => {
    const l = { ...lay(), duration: 60 };
    const s = scrollToLine(30, l, 380);
    expect(timeY(30, { ...l, scrollPx: s })).toBeCloseTo(380);
  });
});

describe('音符横向范围', () => {
  it('单格音符宽度等于一格', () => {
    const c = parseChart({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: flags(0, 29, 29) }], Bpms: [] });
    const l = lay();
    const [a, b] = noteSpan(c.notes[0], l, false);
    expect(b - a).toBeCloseTo(l.lanePx);
  });

  it('跨 15 格的音符宽为 15 格', () => {
    const c = parseChart({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: flags(0, 6, 20) }], Bpms: [] });
    const l = lay();
    const [a, b] = noteSpan(c.notes[0], l, false);
    expect(b - a).toBeCloseTo(15 * l.lanePx);
  });

  it('镜像后左右对调', () => {
    const c = parseChart({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: flags(0, 6, 20) }], Bpms: [] });
    const a = noteSpan(c.notes[0], lay(), false);
    const b = noteSpan(c.notes[0], { ...lay(), mirror: true }, false);
    const l = lay(), left = l.padX, right = l.padX + trackWidth(l);
    expect(b[0]).toBeCloseTo(left + right - a[1]);
    expect(b[1]).toBeCloseTo(left + right - a[0]);
  });

  it('尾端点用 l2/r2', () => {
    const c = parseChart({ Notes: [{ Uid: 1, just: '1', holds: ['2'], Flags: flags(1, 6, 20, 16, 30) }], Bpms: [] });
    const l = lay();
    const head = noteSpan(c.notes[0], l, false), tail = noteSpan(c.notes[0], l, true);
    expect(tail[0] - head[0]).toBeCloseTo(10 * l.lanePx);
  });

  it('宽度恒为正（含镜像与反向尾端点）', () => {
    const c = parseChart({ Notes: [{ Uid: 1, just: '1', holds: ['2'], Flags: flags(1, 20, 30, 6, 16) }], Bpms: [] });
    for (const mirror of [false, true]) {
      const [a, b] = noteSpan(c.notes[0], { ...lay(), mirror }, true);
      expect(b).toBeGreaterThan(a);
    }
  });
});

describe('瞬时音符矩形', () => {
  it('以时刻为中心、厚度不小于最小像素', () => {
    const c = parseChart({ Notes: [{ Uid: 1, just: '3', holds: [], Flags: flags(0, 29, 29) }], Bpms: [] });
    const l = lay();
    const r = instantRect(c.notes[0], l, 6);
    expect(r.h).toBe(6);
    expect(r.y + r.h / 2).toBeCloseTo(timeY(3, l));
  });

  it('宽度至少 1 像素', () => {
    const c = parseChart({ Notes: [{ Uid: 1, just: '3', holds: [], Flags: flags(0, 29, 29) }], Bpms: [] });
    expect(instantRect(c.notes[0], { ...lay(), lanePx: 0.01 }, 6).w).toBe(1);
  });
});

describe('Hold 四边形', () => {
  it('四点顺序为头排左→头排右→尾排右→尾排左', () => {
    const c = parseChart({ Notes: [{ Uid: 1, just: '1', holds: ['2'], Flags: flags(1, 6, 20) }], Bpms: [] });
    const q = holdQuad(c.notes[0], lay());
    expect(q.p).toHaveLength(4);
    // 时间向上：头（较早）在下方，故头的 y 更大。
    expect(q.p[0][1]).toBeGreaterThan(q.p[2][1]);
    expect(q.p[0][0]).toBeLessThan(q.p[1][0]);
    expect(q.p[3][0]).toBeLessThan(q.p[2][0]);
  });

  it('倾斜 Hold 的尾边与头边错开', () => {
    const c = parseChart({ Notes: [{ Uid: 1, just: '1', holds: ['2'], Flags: flags(1, 6, 10, 26, 30) }], Bpms: [] });
    const q = holdQuad(c.notes[0], lay());
    expect(q.p[2][0]).toBeGreaterThan(q.p[1][0]);
  });

  it('纵向长度等于按住时长', () => {
    const c = parseChart({ Notes: [{ Uid: 1, just: '1', holds: ['3.5'], Flags: flags(1, 6, 20) }], Bpms: [] });
    const l = lay();
    const q = holdQuad(c.notes[0], l);
    expect(q.p[0][1] - q.p[2][1]).toBeCloseTo(2.5 * l.pxPerSec);
  });
});

describe('Hold 链', () => {
  it('四边形顺序 = 源数组顺序', () => {
    const c = parseChart({
      Notes: [
        { Uid: 1, just: '1.0', holds: ['1.5'], Flags: flags(1, 30, 40, 50, 58) },
        { Uid: 2, just: '1.5', holds: ['2.0'], Flags: flags(1, 50, 58, 25, 35) },
      ], Bpms: [],
    });
    const quads = chainQuads(c.roots[0], lay());
    expect(quads).toHaveLength(2);
    // 第二个节点的头边左端接上第一个节点的尾边左端（p3 为尾排左）
    expect(quads[1].p[0][0]).toBeCloseTo(quads[0].p[3][0]);
    expect(quads[1].p[1][0]).toBeCloseTo(quads[0].p[2][0]);
  });

  it('零时长节点不进四边形列表', () => {
    const c = parseChart({
      Notes: [
        { Uid: 1, just: '1.0', holds: ['1.5'], Flags: flags(1, 10, 20) },
        { Uid: 2, just: '1.5', holds: ['1.5'], Flags: flags(1, 10, 20) },
      ], Bpms: [],
    });
    expect(chainQuads(c.roots[0], lay())).toHaveLength(1);
  });

  it('chainEnd 取链尾终点', () => {
    const c = parseChart({
      Notes: [
        { Uid: 1, just: '1.0', holds: ['1.5'], Flags: flags(1, 10, 20) },
        { Uid: 2, just: '1.5', holds: ['2.5'], Flags: flags(1, 10, 20) },
      ], Bpms: [],
    });
    expect(chainEnd(c.roots[0])).toBeCloseTo(2.5);
  });
});

describe('小节线', () => {
  const one = (bpms: unknown[], beats?: unknown[]) => parseChart({
    Notes: [{ Uid: 1, just: '1', holds: ['9'], Flags: flags(1, 1, 2) }], Bpms: bpms, ...(beats ? { Beats: beats } : {}),
  });

  it('4/4 且 120 BPM 时每 2 秒一条', () => {
    const ms = measures(one([{ Time: 0, Bpm: 120 }]));
    expect(ms[0].time).toBeCloseTo(0);
    expect(ms[1].time).toBeCloseTo(2);
    expect(ms[2].time).toBeCloseTo(4);
  });

  it('段首为强拍', () => {
    const ms = measures(one([{ Time: 0, Bpm: 120 }]));
    expect(ms[0].strong).toBe(true);
    expect(ms[1].strong).toBe(false);
  });

  it('BPM 变化后小节长度随之改变', () => {
    const ms = measures(one([{ Time: 0, Bpm: 120 }, { Time: 4, Bpm: 240 }])).filter(m => m.time >= 4);
    expect(ms[0].time).toBeCloseTo(4);
    expect(ms[1].time).toBeCloseTo(5);
  });

  it('3/4 拍号缩短小节', () => {
    const ms = measures(one([{ Time: 0, Bpm: 120 }], [{ Numerator: 3, Denominator: 4, Time: 0 }]));
    expect(ms[1].time).toBeCloseTo(1.5);
  });

  it('无 BPM 段时不出线', () => {
    expect(measures(one([]))).toHaveLength(0);
  });

  it('上限生效', () => {
    expect(measures(one([{ Time: 0, Bpm: 600 }]), 5)).toHaveLength(5);
  });
});
