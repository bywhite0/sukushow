/** 输入为按时间升序排列的 Fever 前音符；与 native 的 70% 阈值一致。 */
export function feverChargeStart(times: readonly number[]): number {
  return times.length ? times[Math.ceil(times.length * 0.7) - 1] : -1
}
