/**
 * 结算界面（RhythmGameResultScene，场景 4101 / level57）的纯格式化与数学层。
 *
 * 原版依据 = 4.12.0 客户端二进制（`libil2cpp.so` 反汇编 + `dump.cs` 字段/RVA）；
 * 每个函数的出处写在函数注释里。没有二进制核对、只沿用既有逆向记录的条目会标
 * 「依据既有 RE 记录」。参考实现是 Unity 重建工程的 ResultFormat.cs，凡与反汇编
 * 有出入的地方以二进制为准，并在注释里标「与参考实现的取舍」。
 *
 * 本文件不依赖 DOM / canvas / three，只做字符串与数值换算，供结算渲染器直接调用。
 */

/** 前导零淡色标签（CountupScore.UpdateScore @0x46E8C18、CountupTechnicalScore.UpdateScore @0x46EA5BC 的字面量）。 */
export const DIM_TAG_OPEN = '<color=#C0B8D0>';
export const DIM_TAG_CLOSE = '</color>';

/** 淡色值本身，parseRichText 复用。 */
const DIM_RGB = '#C0B8D0';

/** 非负整数化：分数 / 技术分在反汇编里由调用方保证非负，这里按预览口径把负数与非有限数当 0。 */
function toNonNegativeInt(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const n = Math.trunc(v);
  return n > 0 ? n : 0;
}

/** 十进制数字串加千分组：1234567 → "1,234,567"。 */
function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

/**
 * 分数文本：12 位零填充 + 千分组，前导零（连同前导零之间的分组逗号）包淡色标签。
 *
 * CountupScore.UpdateScore @0x46E8C18（本次反汇编核对）：
 * - 格式串字面量 '#,000000000000'（@0x46E8C98 一带），淡色标签字面量 '<color=#C0B8D0>' / '</color>'；
 * - 前缀长度由静态位数阈值表 + 除以 3 的魔数算出，等价于「全串长度 − 有效数字分组串长度」；
 * - 最后 String.Concat(淡色开标签, 前缀, 淡色闭标签, 剩余) 无条件拼接。
 *
 * 与参考实现的取舍：反汇编没有负数夹紧（调用方保证非负），这里按预览口径把负数当 0；
 * 12 位满 / 12 位以上时前缀为空串，二进制仍会拼出空的淡色标签对，这里照原版保留
 * （空标签对在 TMP / parseRichText 里不产生可见内容）。
 */
export function formatScore(v: number): string {
  const value = toNonNegativeInt(v);
  const digits = String(value);
  // 12 位以上时 padStart 不生效，长度差自然为 0（原版分数不可能达到 10^12，反汇编会越界）。
  const full = groupThousands(digits.padStart(12, '0'));
  const significant = groupThousands(digits);
  const dim = full.length - significant.length;
  if (dim <= 0) return DIM_TAG_OPEN + DIM_TAG_CLOSE + full;
  return DIM_TAG_OPEN + full.slice(0, dim) + DIM_TAG_CLOSE + full.slice(dim);
}

/**
 * 技术分文本：值 / 10000 → '000.0000' + '%'，整数部前导零包淡色标签。
 *
 * CountupTechnicalScore.UpdateScore @0x46EA5BC（本次反汇编核对）：
 * - 常量 10000.0 @0x1A5CF38（与 GoalValue 归一同一常量）；
 * - Double.ToString('000.0000')（@0x46EA5E4）后接 '%'（@0x46EA5E8）；
 * - 淡色前缀长度 = 3 − 整数位数（整数部 0..2 位时补 0，100 及以上不淡色），
 *   反汇编用截断后的整数值查静态阈值表得到同一结果。
 *
 * 与参考实现的取舍：负数按 0（原版技术分为 mental > 0 ? 技术分 : 0，不会为负）；
 * 前缀为空时同样保留空淡色标签对（见 formatScore）。
 */
export function formatTechnical(v: number): string {
  const value = toNonNegativeInt(v);
  const pct = value / 10000;
  // .NET "000.0000"：整数部至少 3 位（前补 0），小数固定 4 位；JS 侧按不变量等价的补零实现。
  const text = pct.toFixed(4).padStart(8, '0') + '%';
  const intPart = Math.trunc(pct);
  const intDigits = intPart >= 100 ? 3 : intPart >= 10 ? 2 : 1;
  const dim = 3 - intDigits;
  return DIM_TAG_OPEN + text.slice(0, dim) + DIM_TAG_CLOSE + text.slice(dim);
}

/**
 * 技术分 GoalValue：trunc((double)raw / (double)totalNoteCount × 10000.0)。
 *
 * UserRecordContent.Initialize b__0 @0x46F4868（本次反汇编核对）：
 * scvtf 把 raw 与 TotalNoteCount 转 double、fdiv、fmul 10000.0、fcvtzs 向零截断。
 * 原版分母来自 masterdata 的难度 MaxCombo，恒为正；反汇编没有判零分支，这里防御性返回 0。
 */
export function technicalGoal(raw: number, totalNoteCount: number): number {
  if (!(totalNoteCount > 0)) return 0;
  return Math.trunc((raw / totalNoteCount) * 10000);
}

/**
 * 计数动画当前值：线性 0 → goal，比例按 decimal 相乘后向零截断。
 *
 * CountupText.<DoCountupAsync>d__13.MoveNext @0x46EAFD8（本次反汇编核对）：
 * 每帧 elapsed += Time.deltaTime；t = elapsed / duration（float32 除法）；
 * t 转 decimal 后经 Math.Clamp(t, Decimal.Zero, Decimal.One)（Clamp 目标 @0x46FA084，
 * 上下界取自 System.Decimal 的静态 Zero / One），再与 goal（long→decimal）op_Multiply，
 * 最后 op_Explicit 转 long（向零截断）；elapsed ≥ duration 时跳出循环，SetGoalValue(goal)。
 * 这里的「elapsed ≥ duration → goal、elapsed ≤ 0 → 0」与 clamp 两端等价（1 × goal = goal）。
 */
export function countupValue(goal: number, elapsed: number, duration: number): number {
  // 循环条件：elapsed < duration；不满足（含 duration ≤ 0、NaN、elapsed 已到终点）即终值。
  if (!(elapsed < duration)) return goal;
  if (!(elapsed > 0)) return 0;
  // C# 里 elapsed/duration 是 float32 除法；用 fround 保留这一舍入。
  const t = Math.fround(elapsed / duration);
  return Math.trunc(goal * t);
}

/**
 * .NET 自定义整数格式的子集：'0' 必填位、'#' 可选位、数字位之间的 ',' 千分组，其余字符按字面量。
 */
function formatIntegerCustom(value: number, format: string): string {
  const v = Number.isFinite(value) ? Math.trunc(value) : 0;
  let first = -1;
  let last = -1;
  let minDigits = 0;
  for (let i = 0; i < format.length; i++) {
    const ch = format[i];
    if (ch === '0' || ch === '#') {
      if (first < 0) first = i;
      last = i;
      if (ch === '0') minDigits += 1;
    }
  }
  if (first < 0) return format;
  let digits = Math.abs(v).toString();
  // .NET：全 '#' 且值为 0 时不出数字（0.ToString("#") == ""）
  if (digits === '0' && minDigits === 0) digits = '';
  digits = digits.padStart(minDigits, '0');
  if (format.slice(first, last + 1).includes(',') && digits.length > 3) {
    digits = digits.replace(/\B(?=(\d{3})+$)/g, ',');
  }
  // .NET：负号插在第一个数字位之前（前缀字面量之后）
  const sign = v < 0 ? '-' : '';
  return format.slice(0, first) + sign + digits + format.slice(last + 1);
}

/**
 * CountupText 的 format 透传（SetGoalValue @0x46EAECC：value.ToString(format, InvariantCulture)）。
 *
 * 结算主流程实际只出现空串（判定 / 条件行 = 纯数字）与 "(+0)"（Increase 行），
 * 已由 4.12.0 level57 的 CountupText.format 序列化核实（"N0" 只出现在 GrandPrix 运营内容，不在还原范围）。
 * 空 / 缺省 format → 纯十进制数字（InvariantCulture 不改变整数输出）。
 */
export function formatCountup(v: number, format?: string | null): string {
  if (!format) return String(Number.isFinite(v) ? Math.trunc(v) : 0);
  return formatIntegerCustom(v, format);
}

/** 0..1 钳位（SlideContent 的 DOTween 插值入参；NaN 原样返回）。 */
export function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** OutQuad 缓动：1 − (1 − u)²（DoSlide 的 X 位移使用，DOTween Ease 6）。 */
export function easeOutQuad(u: number): number {
  const t = clamp01(u);
  return 1 - (1 - t) * (1 - t);
}

/** InQuad 缓动：u²（DoSlide 的 alpha / 精灵淡入使用，DOTween Ease 5）。 */
export function easeInQuad(u: number): number {
  const t = clamp01(u);
  return t * t;
}

/** SlideContent 滑入的初始横向距离（4.12.0 实证 150，DoSlide 起始位置 = goalX + 150）。 */
export const SLIDE_DISTANCE = 150;
/** SlideContent 滑入时长。 */
export const SLIDE_DURATION = 0.5;
/** 首个滑入块的延迟。 */
export const SLIDE_DELAY_FIRST = 0.1;
/** 后续滑入块的延迟步进。 */
export const SLIDE_DELAY_STEP = 0.1;

/**
 * 滑入的横向偏移（相对目标位置 goalX）：distance × (1 − OutQuad(u))。
 *
 * SlideContent.DoSlide @0x46E033C（本次反汇编核对）：先把 localPosition.x 置到 goalX + distance、
 * canvasGroup.alpha 置 0，再 DOLocalMoveX(goalX, duration).SetEase(6=OutQuad)，
 * canvasGroup / 精灵 DOFade(1, duration).SetEase(5=InQuad)。
 * u = 0 → distance，u = 1 → 0；alpha 用 easeInQuad(u)。
 */
export function slideOffset(u: number, distance = SLIDE_DISTANCE): number {
  return distance * (1 - easeOutQuad(u));
}

/**
 * 滑入阶段总等待：首个延迟 + 步进 × 块数 + 滑入时长（= 0.6 + 0.1n 秒）。
 *
 * UserRecordContent.PlaySkippableAsync d__40 @0x46F648C（依据既有 RE 记录）：
 * 第 i 块 delay = 0.1 + 0.1i、duration = 0.5，全部滑入后再 Delay((0.1 + 0.1n) + 0.5) 秒。
 */
export function slideTotalWait(slideCount: number): number {
  return SLIDE_DELAY_FIRST + SLIDE_DELAY_STEP * slideCount + SLIDE_DURATION;
}

/**
 * Rank 文本：0/None → 'D'，1..4 → 'C'/'B'/'A'/'S'，越界空串。
 *
 * ChangeAchievementStatusToText @0x4233258：按 rank 查跳表 @0x8B7F948（字面量 'D' 'C' 'B' 'A' 'S'），
 * 无符号比较 rank < 5 才用跳表，否则取类静态字段（既有 RE 记录口径：越界空串）。
 */
export function rankText(rank: number): string {
  switch (rank) {
    case 0:
      return 'D';
    case 1:
      return 'C';
    case 2:
      return 'B';
    case 3:
      return 'A';
    case 4:
      return 'S';
    default:
      return '';
  }
}

/** 颜色分量 0..1（材质序列化的 sRGB 值，绘制时 ×255 取整即 8 位色）。 */
export type RankColor = readonly [number, number, number];

/**
 * RhythmGameColor_ScoreRank_{D,C,B,A,S} 的 _LeftColor，下标同 rank（0 = None/D）。
 *
 * 值来自 4.12.0 材质序列化（依据既有 RE 记录，见 RESULT_SCREEN.md §6）；
 * 与 HUD 侧 ScoreRankIcon 的 rgb 取整值一致（如 D = rgb(133,150,208)）。
 * D/C/B/A 是纯色材质（左右同色），只有 S 是左紫右青的横向渐变。
 */
export const RANK_LEFT: readonly RankColor[] = [
  [0.522, 0.588, 0.816], // D / None
  [0.212, 0.843, 0.882], // C
  [0.118, 0.769, 0.655], // B
  [0.992, 0.357, 0.569], // A
  [0.694, 0.576, 0.796], // S 左端
];

/** RhythmGameColor_ScoreRank_S 的 _RightColor（S 右端青色；其余等级左右同色，故不单列）。 */
export const RANK_S_RIGHT: RankColor = [0.376, 0.894, 0.871];

/** MusicScoreClearLamp：0 None / 1 Clear / 2 FullCombo / 3 AllPerfect。 */
export type ClearLampValue = 0 | 1 | 2 | 3;

/**
 * 清曲灯目标的预览推断口径。
 *
 * 原版灯值由服务端 ClearStatus（MusicScoreClearLamp）决定，单机拿不到；这里用本局
 * ComboFlags（AllPerfect = bit0 / FullCombo = bit1，GetComboFlags 位域）与剩余 mental 推同一枚举：
 * AP → 3、FC → 2、存活清曲 → 1、死亡 → 0。注意这不是原版输入，只是预览的等效推断。
 */
export function clearLampOf(comboFlags: number, remainMental: number): ClearLampValue {
  if ((comboFlags & 1) !== 0) return 3;
  if ((comboFlags & 2) !== 0) return 2;
  return remainMental > 0 ? 1 : 0;
}

/**
 * CountupCombo 的各位数字，顺序低位 → 高位（索引 0 = 个位）。
 *
 * CountupCombo.UpdateCombo @0x46E8390（本次反汇编核对）：
 * - v < 1 时直接走 SetZero：个位 sprite 设为 0（sprite 表第 0 项），其余位隐藏；
 * - 否则从个位起：sprite[rest % 10]（反汇编用无符号除以 10 的魔数求余），
 *   然后 rest = trunc(rest × 0.1)（fmul 0.1 + fcvtzs），高位 rest ≤ 0 时隐藏。
 * 返回值里的 null 对应精灵隐藏；rest 只在显示过该位后才递推。
 */
export function comboDigits(v: number, slots: number): (number | null)[] {
  const count = Math.max(0, Math.trunc(slots));
  const out: (number | null)[] = [];
  let rest = Number.isFinite(v) ? Math.trunc(v) : 0;
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      out.push(rest > 0 ? rest % 10 : 0);
      if (rest > 0) rest = Math.trunc(rest * 0.1);
      continue;
    }
    if (rest <= 0) {
      out.push(null);
      continue;
    }
    out.push(rest % 10);
    rest = Math.trunc(rest * 0.1);
  }
  return out;
}

/** 富文本绘制段：dim = 用前导零淡色绘制。 */
export type RichTextRun = { text: string; dim: boolean };

/**
 * 把 formatScore / formatTechnical 产出的 TMP 富文本拆成绘制段。
 *
 * 只有淡色 #C0B8D0 记 dim = true；其他颜色标签按普通文本处理（标签剥离、内容不淡色，
 * 结算文本实际不出现其他颜色）。空段（12 位满 / 技术分 ≥ 100% 时 formatScore /
 * formatTechnical 会拼出空淡色标签对）直接跳过；相邻同色段合并。
 */
export function parseRichText(text: string): RichTextRun[] {
  const runs: RichTextRun[] = [];
  const stack: string[] = [];
  const push = (chunk: string): void => {
    if (!chunk) return;
    const dim = stack.length > 0 && stack[stack.length - 1] === DIM_RGB;
    const prev = runs[runs.length - 1];
    if (prev !== undefined && prev.dim === dim) prev.text += chunk;
    else runs.push({ text: chunk, dim });
  };
  const re = /<color=#([0-9a-fA-F]{6})>|<\/color>/g;
  let last = 0;
  for (;;) {
    const m = re.exec(text);
    if (m === null) break;
    push(text.slice(last, m.index));
    if (m[1] !== undefined) stack.push('#' + m[1].toUpperCase());
    else stack.pop();
    last = re.lastIndex;
  }
  push(text.slice(last));
  return runs;
}
