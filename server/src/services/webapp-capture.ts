/**
 * 探究空间的**按课堂**采集设置（P2.2）。
 *
 * 存在的理由：截图对老设备的代价不小（实测桌面 55~68ms/帧，老 iPad 未知但更贵），
 * 而"这个班用不用得起"只有教师知道。所以把「要不要采、多清楚、多久一次」交给他。
 *
 * ⚠️ **归一化发生在服务端，而且只发生在服务端。**
 * 客户端拿到的必须是已经合法的值 —— 学生端不该承担「老师手滑填了 99999 会怎样」
 * 这类判断，那是把边界推给了最不该关心它的那一侧。
 */

export interface WebappCaptureConfig {
  /** 是否采集**画面**。关掉后学生端不传任何图片，只传文字档（可见性 + 滚动深度）。 */
  enabled: boolean;
  /** 缩略图目标宽度（像素）。 */
  width: number;
  /** **图墙档**的截图基准周期（毫秒）。 */
  frameIntervalMs: number;
  /**
   * ★ 2026-09-25：**详情档**周期的教师覆盖值（毫秒）。`null` = 没调过 ⇒ 按基准派生。
   *
   * ⚠️ 它**不是**一个必填档位，而是「派生值之上的覆盖」—— 见 `detailIntervalFor`。
   * 客户端拿它来把详情面板上那个 1~5 秒控件停在正确的档位上。
   */
  detailIntervalMs: number | null;
}

export const DEFAULT_WEBAPP_CAPTURE: WebappCaptureConfig = {
  enabled: true,
  width: 320,
  frameIntervalMs: 10000,
  // 没调过 ⇒ 派生（基准 10 秒 ⇒ 详情 2 秒，与 P2.2 的行为逐字相同）
  detailIntervalMs: null,
};

/**
 * 宽度的可用范围。
 *
 * 上界 640 不是随便定的：实测真实教师网页在 320 宽时是 12,463 字符，
 * 640 宽约 24K —— **占掉单条上限（32K）的 74%**。再大就要靠「超限自动降档」兜底了，
 * 而那是最后一道防线，不该是常态。
 */
export const WEBAPP_WIDTH_MIN = 160;
export const WEBAPP_WIDTH_MAX = 640;

/**
 * 周期的可用范围。
 *
 * 下界 5000：比这更密的话，学生端的截图开销会明显咬住课堂（而且网络也会变成持续负载）。
 * 上界 60000：比这更疏，"实时"就没有意义了。
 */
export const WEBAPP_INTERVAL_MIN_MS = 5000;
export const WEBAPP_INTERVAL_MAX_MS = 60000;

/**
 * **详情档**的周期：按基准的五分之一算，下界 2000。
 *
 * 为什么跟着基准走、而不是固定 2000：基准是教师按**设备能力**选的 ——
 * 一个班把基准调到 30 秒，正是因为那些设备跑不动。此时给详情档固定 2 秒，
 * 等于把教师刚刚避开的代价又加回去。基准 10 秒 ⇒ 详情 2 秒（与改动前一致）。
 */
export const WEBAPP_DETAIL_DIVISOR = 5;

/**
 * 详情档的下界。
 *
 * ⊘ 2026-09-25：由 **2000 降到 1000**（教师要求详情面板可选 1~5 秒）。
 * 🔴 降它有依据，依据是**这条档只作用于一个学生**：两处下发都判
 * `detail = watching && focused === studentId`（`socket/index.ts:780` 与 `:1205`）
 * ⇒ 1 秒档下是**一台设备**在每秒截一张，不是全班。
 * （对比 `WEBAPP_INTERVAL_MIN_MS` 那条 5000 的下界 —— 那个是**全班**每个学生都按它跑，
 *  所以两者不能一起松。）
 */
export const WEBAPP_DETAIL_MIN_MS = 1000;

/** 详情档的上界。教师面板给的是 1~5 秒；比基准还疏就没有「详情」的意义了。 */
export const WEBAPP_DETAIL_MAX_MS = 5000;

/**
 * 老师填的详情档覆盖值 → 合法值或 `null`（没调过）。
 *
 * ⚠️ 判据用 `isProvidedNumber` 而不是 `clampInt`：`clampInt(null, …)` 会先算出
 * `Number(null) === 0` 再夹成**下界**，于是「没调过」会被写成一个合法的最小档。
 * 这与 `isProvidedNumber` 上头那段注释是同一件事，只是这里多了「空」这个合法值。
 */
function normalizeDetailOverride(raw: unknown): number | null {
  if (!isProvidedNumber(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(WEBAPP_DETAIL_MAX_MS, Math.max(WEBAPP_DETAIL_MIN_MS, Math.round(n)));
}

/**
 * 详情档的最终周期。
 *
 * 两条路，**默认那条一个字没改**（P2.2 的行为）：
 *   · `overrideMs` 有值 ⇒ 就是它（教师显式调过，夹在 1000~5000）；
 *   · `overrideMs` 为 `null` ⇒ `max(1000, 基准 / 5)`。
 *
 * 🔴 保留派生这条路的理由逐字还在（见 `WEBAPP_DETAIL_DIVISOR` 那段）：基准是教师按
 * **设备能力**选的，固定一个值等于把他刚避开的代价加回去。
 * ⚠️ 副作用要说清：**教师一调过就固定了**，之后再改基准也不会带动它 —— 那是他要的
 * 「我就要 3 秒」，不是漂移。想回到跟随基准，得有个「恢复默认」的入口（今天没有）。
 */
export function detailIntervalFor(baseMs: number, overrideMs: number | null = null): number {
  const override = normalizeDetailOverride(overrideMs);
  if (override !== null) return override;
  return Math.max(WEBAPP_DETAIL_MIN_MS, Math.round(baseMs / WEBAPP_DETAIL_DIVISOR));
}

/** 按课堂读到的原始字段（Prisma 行的一部分）。允许缺字段：老库、半截对象都走默认值。 */
export interface RawCaptureFields {
  webappCaptureEnabled?: unknown;
  webappThumbnailWidth?: unknown;
  webappFrameIntervalMs?: unknown;
  /** ★ 2026-09-25：详情档覆盖值。**可空**（`null` = 没调过 ⇒ 派生）。 */
  webappDetailIntervalMs?: unknown;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * 「这次到底给没给数值」。
 *
 * 🔴 **不能用 `Number.isFinite(Number(v))` 单独判断** —— `Number(null)` 与 `Number('')`
 * 都是 **0**（有限），于是 `{ width: null }` 这种"没填"会被当成「给了数值 0」，
 * 再被夹成下界 160 写进库。**教师端一个空输入框序列化成 null，就会把这个课堂的
 * 缩略图宽度悄悄改成最小档**，而界面上看不出任何异常。
 *
 * 接受的形态：number、纯数字字符串（表单常见）。拒绝 null / undefined / '' / NaN / 其它。
 */
function isProvidedNumber(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'boolean') return false;
  return Number.isFinite(Number(value));
}

/**
 * 把数据库里的一行归一化成合法配置。
 *
 * ⚠️ `enabled` 用的是 `!== false` 而不是 `Boolean(...)`：
 * 列的默认值是 1，但**老库加列之前**、或传进来一个 `undefined` 时，
 * `Boolean(undefined)` 会把「默认开」变成「关」—— 那会让所有老课堂**静默地停止截图**，
 * 而且没有任何报错。方向必须是「认不出就当开」。
 */
export function normalizeCaptureConfig(row: RawCaptureFields | null | undefined): WebappCaptureConfig {
  if (!row) return DEFAULT_WEBAPP_CAPTURE;
  return {
    enabled: row.webappCaptureEnabled !== false,
    width: clampInt(row.webappThumbnailWidth, WEBAPP_WIDTH_MIN, WEBAPP_WIDTH_MAX, DEFAULT_WEBAPP_CAPTURE.width),
    frameIntervalMs: clampInt(
      row.webappFrameIntervalMs,
      WEBAPP_INTERVAL_MIN_MS,
      WEBAPP_INTERVAL_MAX_MS,
      DEFAULT_WEBAPP_CAPTURE.frameIntervalMs,
    ),
    detailIntervalMs: normalizeDetailOverride(row.webappDetailIntervalMs),
  };
}

/**
 * 教师提交的设置 → 可写库的列。
 *
 * 与 `normalizeCaptureConfig` 分开：那个读的是**库里的行**（可能缺字段），
 * 这个读的是**请求体**（可能带垃圾）。两者都归一化，但默认值的含义不同：
 * 读库时缺字段 = 老数据，应当沿用默认；写库时缺字段 = 这次不改它。
 */
export function captureFieldsFromInput(input: {
  enabled?: unknown;
  width?: unknown;
  frameIntervalMs?: unknown;
  detailIntervalMs?: unknown;
}): {
  webappCaptureEnabled?: boolean;
  webappThumbnailWidth?: number;
  webappFrameIntervalMs?: number;
  webappDetailIntervalMs?: number | null;
} {
  const out: {
    webappCaptureEnabled?: boolean;
    webappThumbnailWidth?: number;
    webappFrameIntervalMs?: number;
    webappDetailIntervalMs?: number | null;
  } = {};
  if (typeof input.enabled === 'boolean') out.webappCaptureEnabled = input.enabled;
  // ⚠️ 只在**确实给了数值**时才写：没给 = 这次不改，写进去会把它变成默认值（或更糟，见
  //    isProvidedNumber 的注释：null 会被当成 0 再夹成 160）。
  if (isProvidedNumber(input.width)) {
    out.webappThumbnailWidth = clampInt(input.width, WEBAPP_WIDTH_MIN, WEBAPP_WIDTH_MAX, DEFAULT_WEBAPP_CAPTURE.width);
  }
  if (isProvidedNumber(input.frameIntervalMs)) {
    out.webappFrameIntervalMs = clampInt(
      input.frameIntervalMs,
      WEBAPP_INTERVAL_MIN_MS,
      WEBAPP_INTERVAL_MAX_MS,
      DEFAULT_WEBAPP_CAPTURE.frameIntervalMs,
    );
  }
  // ★ 详情档覆盖值 —— 与上面两条**不同**：这条的 `null` 是一个**有意义的值**
  //（= 清掉覆盖、回到「跟随基准」），所以它收 `null`。
  // ⚠️ 但「压根没给这个字段」仍然是「这次不改它」：`undefined === null` 为假，
  //    所以缺字段不会掉进第一支。这正是上面那条「缺字段 ≠ 写默认值」的纪律。
  if (input.detailIntervalMs === null) out.webappDetailIntervalMs = null;
  else if (isProvidedNumber(input.detailIntervalMs)) {
    out.webappDetailIntervalMs = normalizeDetailOverride(input.detailIntervalMs);
  }
  return out;
}
