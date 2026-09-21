/** sharedassets56 #92 streamed 曲线；路径 CRC 与原始 level56 层级交叉核对。 */
export function feverEntrance(age: number) {
  const t = Math.max(0, age);
  const moveEnd = 0.4166666567325592;
  const maskEnd = 0.4333333373069763;
  const leftCore = t >= moveEnd
    ? [-1.9600000381469727, 6.900000095367432, 25.799999237060547]
    : [-18.459999084472656 + 39.60000228881836 * t,
      -9.399999618530273 + 39.119998931884766 * t,
      (-2.1972657123114914e-5 * t + 61.91999816894531) * t];
  const leftMask = t >= maskEnd ? [40, 68, 1]
    : [(-958.5798950195312 * t + 623.076904296875) * t * t + 1, 156.92308044433594 * t, 1];
  const rightMask = t >= maskEnd ? [40, 68, 1]
    : [(-884.8429565429688 * t + 575.14794921875) * t * t + 4, 156.92308044433594 * t, 1];
  return {
    leftCore, rightCore: [-leftCore[0], leftCore[1], leftCore[2]], leftMask, rightMask,
    coreActive: t < 0.6333333253860474,
  };
}
