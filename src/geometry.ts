import type { Note } from './chart';
export const BORDER = -4.632, SPAWN = 52, Y = 4.5;
/** Base world width of one lane flag unit (HOLD_MESH default). */
export const BASE_LANE_WIDTH = 0.15;

export interface Slope { duration: number; speed: number; spawn: number; zAt: (remaining: number) => number }

/** ConfigResolver.LaneWidth = laneWidthOpt/100; world X uses base×scale. */
export function lanePitch(laneWidthOpt = 100): number {
  return BASE_LANE_WIDTH * (laneWidthOpt / 100);
}

export const worldX = (lane: number, laneWidthOpt = 100) => lanePitch(laneWidthOpt) * (lane - 29.5);

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * NoteStartZ (0..100): RefreshNoteStartZ shortens look-ahead.
 * spawn ≈ BORDER + (SPAWN−BORDER)×(1 − startZ/100).
 */
export function spawnForStartZ(noteStartZ = 0): number {
  const z = clamp(noteStartZ, 0, 100);
  return BORDER + (SPAWN - BORDER) * (1 - z / 100);
}

export function createSlope(speed: number, noteStartZ = 0): Slope {
  if (!Number.isFinite(speed) || speed <= 0 || speed > 30) throw new Error('下落速度需在 0–30 之间');
  const spawn = spawnForStartZ(noteStartZ);
  const zAt = (remaining: number) => {
    const d = remaining * speed;
    return BORDER + 3.9 * d + 0.072 * d * d * d;
  };
  let duration = 1;
  for (let i = 0; i < 100; i++) {
    const d = duration * speed;
    const next = duration - (zAt(duration) - spawn) / (3.9 * speed + 0.216 * speed * d * d);
    if (Math.abs(next - duration) < 0.01) return { duration: next, speed, spawn, zAt };
    duration = next;
  }
  throw new Error('下落曲线未收敛');
}

export function edges(n: Note, p: number, mirror: boolean): [number, number] {
  const l = n.l + (n.l2 - n.l) * p, r = n.r + (n.r2 - n.r) * p;
  return mirror ? [59 - r, 59 - l] : [l, r];
}

export function holdSegment(n: Note, now: number, s: Slope, mirror: boolean, laneWidthOpt = 100): number[] {
  const pitch = lanePitch(laneWidthOpt);
  const lane0Left = pitch * -30;
  const length = n.end - n.time, e = now - n.time + s.duration;
  const zh = Math.max(s.zAt(n.time - now), BORDER), zt = s.zAt(n.end - now);
  if (length <= 0 || zh >= s.spawn || zt <= BORDER) return [];
  const head = edges(n, clamp((now - n.time) / length, 0, 1), mirror);
  const tail = edges(n, Math.min(e / length, 1), mirror), far = Math.min(zt, s.spawn);
  const x = (lr: [number, number]) => [
    lane0Left + pitch * (lr[0] + 1),
    worldX((lr[0] + lr[1]) / 2, laneWidthOpt),
    lane0Left + pitch * lr[1],
  ];
  const h = x(head), t = x(tail);
  return [h[0], Y, zh, t[0], Y, far, h[1], Y, zh, t[1], Y, far, h[2], Y, zh, t[2], Y, far];
}
