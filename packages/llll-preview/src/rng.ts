/**
 * 确定性随机数：Unity 的 RNG 序列无法复现，这里只保证「同一种子 → 同一序列」，
 * 让预览拖动与视频导出在同一时刻得到同样的粒子（Math.random 做不到）。
 */

/** FNV-1a 32 位字符串哈希。 */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 线性同余发生器，输出 [0, 1)。 */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 8) / 16777216;
  };
}

/** 把若干数（整数化后）混成一个 32 位种子。 */
export function mixSeed(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    const v = Number.isFinite(p) ? Math.round(p) | 0 : 0;
    h ^= v;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h >>> 0;
}
