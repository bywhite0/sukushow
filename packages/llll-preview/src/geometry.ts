import type { Note } from '@sukushow/chart/chart';
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

/** Mathf.Clamp01：`v < 0 ? 0 : v > 1 ? 1 : v`；NaN 预览兜底为 0（Unity 原样返回 NaN）。 */
export const unityClamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : Number.isNaN(v) ? 0 : v);

/** Mathf.Min(a, b) = `a < b ? a : b`（a 为 NaN 时返回 b，与 Math.min 不同）。 */
export const unityMin = (a: number, b: number) => (a < b ? a : b);
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
  // HoldNoteView.EmitSegment（HOLD_MESH §4）只按 zHead >= SpawnZ / zTailRaw <= BorderLine 跳过，
  // **不因 HoldLength == 0 跳过**：零长段（链中的瞬移点，holds[^1] == Just）照样出一排头、一排尾，
  // 两排同 z（零纵深、不可见），但它占住「第 2 个已发射段」的位置，缝合时第 1 段的尾排接到它的头排
  // （= 第 1 段自己的尾端 lane）。此前这里 length <= 0 直接返回 []，缝合落到瞬移之后那段的头排，
  // 第 1 段尾端被拉到下一段的 lane 上。
  if (zh >= s.spawn || zt <= BORDER) return [];
  // pHead = Mathf.Clamp01((t − just) / HoldLength)，pTail = Mathf.Min(e / HoldLength, 1)：
  // 零长时 ±x/0 = ±Inf，按 Unity 的比较式钳位。0/0（恰在该时刻）Unity 得 NaN，预览取 0 以免 NaN 进顶点缓冲（预览兜底）。
  const head = edges(n, unityClamp01((now - n.time) / length), mirror);
  const tail = edges(n, unityMin(e / length, 1), mirror), far = Math.min(zt, s.spawn);
  const x = (lr: [number, number]) => [
    lane0Left + pitch * (lr[0] + 1),
    worldX((lr[0] + lr[1]) / 2, laneWidthOpt),
    lane0Left + pitch * lr[1],
  ];
  const h = x(head), t = x(tail);
  return [h[0], Y, zh, t[0], Y, far, h[1], Y, zh, t[1], Y, far, h[2], Y, zh, t[2], Y, far];
}
