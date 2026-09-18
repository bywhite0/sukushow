/** Fever window + LineBase / LineMove (TrackOutlineFever / PLAN). */

export type FeverWindow = { start: number; end: number };

/**
 * FeverResolver.Inject window from FeverSectionNo N and section times.
 * start = N==1 ? 0 : sections[N-2]
 * end = (N-1 >= 4) ? tableEnd(+0x34 / FinishTime stand-in) : sections[N-1]
 */
export function feverWindowFromSections(
  sections: number[],
  feverSectionNo: number,
  /** sectionTable.field_0x34 when N-1>=4; preview uses PlayTime/FinishTime (= chart duration). */
  tableEnd?: number,
): FeverWindow | null {
  const n = Math.trunc(feverSectionNo);
  if (!sections.length || n < 1) return null;
  const start = n === 1 ? 0 : sections[n - 2];
  const indexedEnd = sections[Math.min(n - 1, sections.length - 1)];
  const end = n - 1 >= 4
    ? (tableEnd !== undefined && Number.isFinite(tableEnd) && tableEnd > (start ?? 0)
      ? tableEnd
      : indexedEnd)
    : indexedEnd;
  if (start === undefined || end === undefined || !(end > start)) return null;
  return { start, end };
}

/** Preview fallback when chart has no Sections: mid-song window. */
export function feverWindowFallback(duration: number): FeverWindow {
  const d = Math.max(1, duration);
  return { start: d * 0.45, end: d * 0.7 };
}

export function resolveFeverWindow(
  sections: number[],
  feverSectionNo: number,
  duration: number,
  /** Optional explicit +0x34; default = duration (FinishTime stand-in). */
  tableEnd?: number,
): FeverWindow {
  const endScalar = tableEnd !== undefined && tableEnd > 0 ? tableEnd : duration;
  return feverWindowFromSections(sections, feverSectionNo, endScalar) ?? feverWindowFallback(duration);
}

export function isFeverAt(time: number, win: FeverWindow | null | undefined): boolean {
  if (!win) return false;
  return time >= win.start && time < win.end;
}

/** LineBase cycle 1.6s; hue keys from Play-mode probe (PLAN). */
export const FEVER_LINE_CYCLE = 1.6;
/** LineMove cycle 0.8s (往复). */
export const FEVER_MOVE_CYCLE = 0.8;
/** Bright bar length as fraction of outline height (0.11×2 / 5). */
export const FEVER_MOVE_LENGTH = 0.044;

const HUES = [353, 313, 206, 147, 96, 51, 23, 353];

function hueAt(u: number): number {
  const n = HUES.length - 1;
  const x = ((u % 1) + 1) % 1 * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  return HUES[i] + (HUES[i + 1] - HUES[i]) * f;
}

function alphaAt(u: number): number {
  const t = ((u % 1) + 1) % 1;
  return 0.047 + 0.952 * Math.sin(Math.PI * t) ** 2;
}

/** LineMove alpha: 0 / .47 / 1 / .47 / 0 at 0 / .2 / .5 / .8 / 1 */
function moveAlphaAt(u: number): number {
  const t = ((u % 1) + 1) % 1;
  const keys = [
    { t: 0, v: 0 },
    { t: 0.2, v: 0.4706 },
    { t: 0.5, v: 1 },
    { t: 0.8, v: 0.4706 },
    { t: 1, v: 0 },
  ];
  for (let i = 1; i < keys.length; i++) {
    if (t > keys[i].t) continue;
    const span = keys[i].t - keys[i - 1].t;
    const k = span > 0 ? (t - keys[i - 1].t) / span : 0;
    return keys[i - 1].v + (keys[i].v - keys[i - 1].v) * k;
  }
  return 0;
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

/** RGBA 0..1 for LineBase overlay; phase anchored at fever start. */
export function feverLineRgba(time: number, feverStart: number): [number, number, number, number] {
  const u = (time - feverStart) / FEVER_LINE_CYCLE;
  const [r, g, b] = hsvToRgb(hueAt(u), 0.85, 1);
  return [r, g, b, alphaAt(u)];
}

/** Ping-pong 0..1 along edge for LineMove (往复). */
export function feverMovePhase(time: number, feverStart: number): number {
  const t = ((time - feverStart) / FEVER_MOVE_CYCLE) % 2;
  const x = t < 0 ? t + 2 : t;
  return x < 1 ? x : 2 - x;
}

/**
 * Canvas localY center for LineMove (−703 … +694 over phase).
 * Outline half-height ≈ 708; bar rides the full edge.
 */
export function feverMoveLocalY(phase01: number): number {
  const u = Math.min(1, Math.max(0, phase01));
  return -703 + u * (694 - (-703));
}

/** RGBA for LineMove bright bar (same hues, narrower alpha). */
export function feverMoveRgba(time: number, feverStart: number): [number, number, number, number] {
  const u = (time - feverStart) / FEVER_MOVE_CYCLE;
  const [r, g, b] = hsvToRgb(hueAt(u), 0.9, 1);
  return [r, g, b, moveAlphaAt(u)];
}
