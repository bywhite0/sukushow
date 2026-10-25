/**
 * 结算界面（RhythmGameResultScene，level57）的数据契约。
 *
 * 数据文件 `resultScreenClip.ts` 由 `scripts/gen-result-screen-data.py` 从 4.12.0 的
 * level57 授权导出（`resultui.json`：UI 树 + 三段 clip + 粒子发射器）生成，勿手改。
 *
 * 坐标沿用 Unity RectTransform：`x/y` 是 anchoredPosition、`w/h` 是 sizeDelta、
 * `anchor` 是 anchorMin/Max、`pivot` 是轴心；`parent` 是父节点下标（根为 −1），
 * 据此还原父子层级。`rot` 为绕 Z 的弧度（导出时已从四元数换算）。
 *
 * clip 的 `host` 是曲线路径的根节点（相对路径挂在它下面）；`ClearLampRoot ({n})`
 * 里的 `{n}` 在播放时替换成当前难度对应的灯位（1..4），因为原版四个灯位共用同一控制器。
 */

/** 文本材质：对应 TMP sharedMaterial 的四种组合（B / EB / EB+阴影 / B+白描边）。 */
export type ResultTextMaterial =
  | 'NomalText'
  | 'EBDefault'
  | 'EBNomalTextWithShadow'
  | 'OutLineWhite';

export type Rgba = [number, number, number, number];

/** UI Image 的三种形态：贴图、运行时贴图（曲绘 / 背景）、ProceduralImage 圆角块。 */
export type ResultImage =
  | { kind: 'sprite'; sprite: string; preserveAspect: boolean; rgba: Rgba }
  | { kind: 'raw'; rgba: Rgba }
  | { kind: 'rounded'; rgba: Rgba; radius: number; border: number; falloff: number };

export type ResultText = {
  content: string;
  /** TMP fontSize（设计像素，1920×1080 参考分辨率）。 */
  size: number;
  font: 'B' | 'EB';
  material: ResultTextMaterial;
  /** 水平对齐：1 左、2 中、3 右、6 字形几何居中。 */
  align: 1 | 2 | 3 | 6;
  /** TMP Middle（512，字体行框）/ Geometry（4096，可见字形）垂直对齐。 */
  vertical: 512 | 4096;
  /** TMP 字距与行距，单位均为字号的百分之一。 */
  characterSpacing: number;
  lineSpacing: number;
  /** TMP enableAutoSizing：在序列化的上下限内求能放入容器的最大字号。 */
  autoSize: boolean;
  minSize: number;
  maxSize: number;
  rgba: Rgba;
};

/** TMP_FontAsset.m_FaceInfo，数值单位对应 pointSize。 */
export type ResultFontMetrics = {
  pointSize: number;
  ascent: number;
  descent: number;
  lineHeight: number;
};

/** Unity HorizontalLayoutGroup 参数（level57 的灯位 / 判定行 / Combo 数字行）。 */
export type ResultLayout = {
  spacing: number;
  /** TextAnchor 枚举：0 左上、1 上中、2 右上、3 左中、4 中、5 右中、6 左下、7 下中、8 右下。 */
  align: number;
  /** [left, right, top, bottom]。 */
  padding: [number, number, number, number];
  controlWidth: boolean;
  controlHeight: boolean;
  forceExpand: boolean;
};

export type ResultNode = {
  path: string;
  parent: number;
  active: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
  rot: number;
  anchor: [number, number, number, number];
  pivot: [number, number];
  image: ResultImage | null;
  text: ResultText | null;
  /** Unity Mask：把本节点子树裁剪到本节点矩形（圆角块）。 */
  mask: boolean;
  /** 有 HorizontalLayoutGroup 时由布局接管子节点位置。 */
  layout: ResultLayout | null;
};

/**
 * 曲线属性。`attr` 覆盖 TMP / 材质的 alpha 属性哈希（原版按 Graphic.color.a 施加），
 * 渲染时与 `a` 一样作用于不透明度；`scale.z` 不进入数据。
 */
export type ResultCurveProp =
  | 'active'
  | 'x'
  | 'y'
  | 'scale.x'
  | 'scale.y'
  | 'r'
  | 'g'
  | 'b'
  | 'a'
  | 'attr';

/** Unity AnimationCurve 关键帧：[time, c0, c1, c2, c3]（段内三次多项式）。 */
export type ResultCurveKey = readonly [number, number, number, number, number];

export type ResultCurve = {
  /** 相对 clip.host 的节点路径（空串 = host 自身）。 */
  path: string;
  prop: ResultCurveProp;
  keys: readonly ResultCurveKey[];
};

export type ResultClip = {
  name: 'sc2_ResultTitleAnimation' | 'sc2_ResultClearLampRoot_01' | 'sc2_ResultAllComboPerfect';
  dur: number;
  host: string;
  curves: readonly ResultCurve[];
};

export type ResultGradient = {
  cols: readonly (readonly [number, number, number, number])[];
  alps: readonly (readonly [number, number])[];
};

/** 粒子发射器（level57 原始 ParticleSystem 的启用模块）。 */
export type ResultEmitter = {
  /** 绝对节点路径：宿主节点激活时按 clip 的 active 曲线开播。 */
  path: string;
  count: number;
  /** burst 相对激活时刻的偏移（秒）。 */
  btime: number;
  cycles: number;
  interval: number;
  delay: readonly [number, number];
  life: readonly [number, number];
  speed: readonly [number, number];
  size: readonly [number, number];
  sizeY: readonly [number, number];
  size3D: boolean;
  shapeR: number;
  shape: {
    /** 序列化形状类型：0 Sphere、2 Cone、4 Circle、10 Box。 */
    type: 0 | 2 | 4 | 10;
    thickness: number;
    angle: number;
    position: readonly [number, number, number];
    rotation: readonly [number, number, number];
    scale: readonly [number, number, number];
  };
  startRot: readonly [number, number];
  /** RotationModule 启用时的角速度（弧度/秒）。 */
  rot: readonly [number, number];
  limit: number | null;
  dampen: number;
  start: Rgba;
  /** 尺寸随寿命的 Hermite 曲线：[time, value, inSlope, outSlope]。 */
  sizeKeys: readonly (readonly [number, number, number, number])[];
  tex: string;
  /** 粒子排序层（预览只在同一张画布内按顺序绘制）。 */
  sort: number;
  sortLayer: number;
  renderMode: 0 | 1;
  lengthScale: number;
  /** 设计像素单位：Unity scalingMode=1（Local）为 100，scalingMode=0 为 1。 */
  unit: number;
  grad: ResultGradient;
  /** TwoGradients 的 minGradient；按每粒子固定因子与 grad 连续混合。 */
  grad2: ResultGradient | null;
};
