/** 曲终横幅不早于主数据 FinishTime；若已解码 BGM 更长，则等真实音频结束。 */
export function resultStartTime(finishTime: number | null, audioDuration: number | null): number | null {
  if (finishTime === null) return null;
  if (audioDuration === null) return finishTime;
  return Math.max(finishTime, audioDuration);
}
