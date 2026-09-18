/** Fever window + LineBase rainbow (preview approx from TrackOutlineFever / PLAN). */

export type FeverWindow = { start: number; end: number };

/**
 * FeverResolver.Inject window from FeverSectionNo N and section times.
 * start = N==1 ? 0 : sections[N-2]; end = sections[N-1] (preview: no +0x34 branch).
 */
export function feverWindowFromSections(
  sections: number[],
  feverSectionNo: number,
): FeverWindow | null {
  const n = Math.trunc(feverSectionNo);
  if (!sections.length || n < 1) return null;
  const start = n === 1 ? 0 : sections[n - 2];
  const end = sections[Math.min(n - 1, sections.length - 1)];
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
): FeverWindow {
  return feverWindowFromSections(sections, feverSectionNo) ?? feverWindowFallback(duration);
}

export function isFeverAt(time: number, win: FeverWindow | null | undefined): boolean {
  if (!win) return false;
  return time >= win.start && time < win.end;
}

/** LineBase cycle 1.6s; hue keys from Play-mode probe (PLAN). */
const FEVER_CYCLE = 1.6;
const HUES = [353, 313, 206, 147, 96, 51, 23, 353];

function hueAt(u: number): number {
  const n = HUES.length - 1;
  const x = ((u % 1) + 1) % 1 * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  return HUES[i] + (HUES[i + 1] - HUES[i]) * f;
}

/** Alpha pulse ~0.05..1 over cycle (approx). */
function alphaAt(u: number): number {
  const t = ((u % 1) + 1) % 1;
  return 0.047 + 0.952 * Math.sin(Math.PI * t) ** 2;
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
  const u = (time - feverStart) / FEVER_CYCLE;
  const [r, g, b] = hsvToRgb(hueAt(u), 0.85, 1);
  return [r, g, b, alphaAt(u)];
}

export const FEVER_LINE_CYCLE = FEVER_CYCLE;
