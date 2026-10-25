/**
 * 楽曲レート / プレイヤーレート（4.12.0 `MusicInformation.GetRateByScore` @0x449BBF0、
 * `UserDataRepository.CalculatePlayerRate` @0x44A39E8 的逐指令实现）。
 *
 * GetRateByScore(technicalScore, difficulty)：
 * - 先按难度取 `MusicScoresRecord` 的 (Level, MaxCombo)（Normal +0x14/+0x24、Hard +0x18/+0x28、
 *   Expert +0x1C/+0x2C、Master +0x20/+0x30；跳表 @0x1AA4529，实测映射 1→Normal/2→Hard/3→Expert/4→Master）；
 *   任一 ≤0 直接返回 0。
 * - `t = technicalScore * 10000.0 / MaxCombo`（double；常量 10000.0 @0x1A5CF38）。
 * - `t <= 980000`（常量 @0x1A5D360）走浮点段：
 *   r = t/10000；r >= 95（@0x1A5D638）→ trunc(Level*10 * ((r−95)/12 + 0.75))；
 *   否则 r >= 90（@0x1A5D978）→ trunc(Level*10 * ((r−90)/20 + 0.5))（−90.0 @0x1A5CE30）；
 *   否则 trunc(Level*10 * (r/180))（180.0 @0x1A5D640，−90.0 @0x1A5CE30；先 r/180 再乘 Level*10）。
 * - `t > 980000` 走整数阶梯：x = fcvtzs(t)（向零截断），返回 Level*10 + ladder(x)；
 *   阶梯 = 0 / 1 / 2 / 3 / 4 / 5 at 981999/983999/987999/991999/995999/999999，
 *   之后每个 1000 一档 +1 到 1004999（0x449BF04 段，magic 0x10624DD3>>38），
 *   1005000 起每 600 一档 +1 到 1007999（0x449BE70 段，magic 0x1B4E81B5>>38），
 *   1008000 起每 300 一档 +1 到 1009499（0x449BF30 段，magic 0x1B4E81B5>>37），
 *   1009500 起每 100 一档 +1 且 Math.Min(25, …) 封顶（0x449BEAC 段，magic 0x51EB851F>>37）。
 *
 * CalculatePlayerRate：把全部曲目难度的 Rate 展平 → 降序 → Take(30)（`PlayerRateMusicCount`）
 * → Aggregate(seed 0, 相加)。即玩家レート = 前 30 个最高单曲 Rate 之和（不是平均）。
 *
 * 预览在本地数据库里保存每首歌 + 难度的 best technical，再按上两式算出本局 Rate / PlayerRate；
 * 原版这两个值由服务端存档提供，本地复现只依赖 masterdata（Level/MaxCombo）与历史成绩。
 */

/** `MusicInformation.GetRateByScore`。 */
export function rateByScore(technicalScore: number, level: number, maxCombo: number): number {
  if (!Number.isFinite(technicalScore) || !Number.isFinite(level) || !Number.isFinite(maxCombo)) return 0;
  if (!(level > 0) || !(maxCombo > 0)) return 0;
  const t = (technicalScore * 10000) / maxCombo;
  const base = level * 10;
  if (t <= 980000) {
    const r = t / 10000;
    if (r >= 95) return Math.trunc(base * ((r - 95) / 12 + 0.75));
    if (r >= 90) return Math.trunc(base * ((r - 90) / 20 + 0.5));
    return Math.trunc(base * (r / 180));
  }
  const x = Math.trunc(t);
  let extra: number;
  if (x <= 981999) extra = 0;
  else if (x <= 983999) extra = 1;
  else if (x <= 987999) extra = 2;
  else if (x <= 991999) extra = 3;
  else if (x <= 995999) extra = 4;
  else if (x <= 999999) extra = 5;
  else if (x <= 1004999) extra = 6 + Math.floor((x - 1000000) / 1000);
  else if (x <= 1007999) extra = 11 + Math.floor((x - 1005000) / 600);
  else if (x <= 1009499) extra = 16 + Math.floor((x - 1008000) / 300);
  else extra = Math.min(25, 21 + Math.floor((x - 1009500) / 100));
  return base + extra;
}

/** `UserDataRepository.CalculatePlayerRate`：全部单曲 Rate 的最高 30 个求和。 */
export function playerRate(rates: readonly number[]): number {
  if (rates.length === 0) return 0;
  const top = [...rates].sort((a, b) => b - a).slice(0, 30);
  let sum = 0;
  for (const rate of top) sum += rate > 0 ? rate : 0;
  return sum;
}
