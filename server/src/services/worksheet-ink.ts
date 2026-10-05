/**
 * 笔迹（`ink/v1` / `drawing/v1`）在**服务端**的那一份纯逻辑 —— 规格 §12 裁定 4 的后半句
 * 「**服务端也要校验**（前端拦不住手搓请求）」。
 *
 * 🔴 **与 `src/lib/worksheet-ink.ts` 是同一对常量的两份实现，不是共享。**
 * 服务端读不到 `src/`（构建产物只把 `server/` 打进运行时），所以 A1 那一份在这里**必须
 * 再写一遍**。⇒ 两处的 `INK_MAX_STROKES` / `INK_MAX_POINTS` **必须一起改**。
 *
 * ⚠️ 两处各写一份的代价是「改了一处、另一处没改」，而它**不报错**：客户端收下一幅 400 笔的画、
 * 服务端按旧上限拒绝 ⇒ 学生看到的是「提交失败」，且提示里的数字与他自己屏幕上那个不一致。
 * 所以本任务在**两份文件里互指**（`src/lib/worksheet-ink.ts` 的常量注释指向本文件）。
 */

/** 🔴 与 `src/lib/worksheet-ink.ts` 的同名常量是**同一对**字面量，两处必须一起改。 */
export const INK_MAX_STROKES = 400;
export const INK_MAX_POINTS = 2000;

/** 与前端 `worksheet-drawing-document.ts` 保持一致：一题的第三方绘图文档最大字符数。 */
export const DRAWING_DOCUMENT_MAX_CHARS = 600_000;
const DRAWING_TOOLS = ['free', 'math', 'mind-map', 'flowchart'] as const;

/** 笔迹的两个 `format` 串（规格 §12 裁定 6：一个实现、两个 format 名）。 */
export const INK_FORMATS = ['ink/v1', 'drawing/v1'] as const;
export type InkFormat = (typeof INK_FORMATS)[number];

/**
 * 这个 `format` 串是不是笔迹（`ink/v1` / `drawing/v1`）。
 *
 * ⚠️ 与 `src/lib/worksheet-ink.ts` 的 `isInkFormat` 逐字同义 —— 它是本文件唯一的判据入口，
 * 而它的**两个消费者都在拒绝以外的方向**（`judge()` 用它短路成 `null`、`findInkValueError`
 * 用它决定要不要查体积），所以它自己不是一道格式门。见 `findInkValueError` 的 🔴。
 */
export function isInkFormat(raw: unknown): raw is InkFormat {
  return typeof raw === 'string' && (INK_FORMATS as readonly string[]).includes(raw);
}

/**
 * 作答值里**笔迹**的体积与形状校验 —— 规格 §12 裁定 4 的后半句
 * 「**服务端也要校验**（前端拦不住手搓请求）」。
 *
 * 🔴 为什么必须有：`express.json({ limit: '10mb' })` 是服务器唯一的上限。
 * 一个 8MB 的笔迹值会进 `WorksheetAnswer.value` 这个 Json 列，再由**看板读端点**
 * （`GET /classroom/:classroomId/answers`，`routes/worksheets.ts` 的那个 `select` 里
 * `value: true`）整份取回、在**教师那台机器**上画出来 ⇒ 看板卡死，
 * 而**服务端不会报任何错**。
 * ⊘ 2026-09-24（终审 I1）：这一句原写「再经两条读端点**与一次广播**送到教师那台机器上」，
 *   当时把「广播那一半」判成假的。**2026-09-30 复审更正：那一半现在是真的了** ——
 *   `routes/worksheets.ts:1918` 给广播加了 `MAX_BROADCAST_VALUE_CHARS = 65536` 的闸，
 *   `:1946` 是 `value: omitted ? null : answer.value` ⇒ 广播**带 `value`**（2026-09-28 的「乙档」起）。
 *   ⇒ 教师那台机器上现在有**两条**路径（看板读端点 + 广播），而广播那条**超限时静默**
 *   （`valueOmitted`，看板那一格暂时空白、不报错）。
 *   ⚠️ 这条更正**改变了本函数上限的理由**：原来只需防「看板读端点整份取回」，
 *   现在还要防「广播把一份大值推给每一台教师机」—— 而那条路是**静默**的。
 *   （顺带：「两条读端点」也不准 —— 学生自己的 `GET /:id/answers` 也带 `value`，
 *   但它送到的是**学生那台**机器。）
 * 学生端也躲不掉：那个值要过 `localStorage` 离线队列，配额一爆 `writeQueue` 的 `catch`
 * 就是**静默降级**（这一次会话内还在、撑不过刷新）。**前端拦不住这件事** ——
 * 它只拦得住自己客户端产生的值。
 *
 * ⚠️ 只对 ink 值生效。**别把它写成一道格式门**：认不出的 `format` 一律放行 ——
 * `format` 在服务端从来不是判据（`worksheet-answer-value.ts:48-76`，那段「`format` 在服务端只被读
 * 两处、两处都不拿它当判据」立过这条：
 * 「加一道格式校验就多一道拒绝的理由，而它会让库里已有的行与旧客户端**静默不判分**」）。
 * 本函数不违反它，理由是两条：
 *   · 它**只**在 `format === 'ink/v1' | 'drawing/v1'` 时生效（M4b 才诞生的形状，
 *     库里不可能有旧行是它），其它一切值**原样放行**；
 *   · 它落在**写入口**（`PUT /:id/answers`，400 是响亮的），**不落在判分器上**。
 * ⇒ 认不出的 `format` 不返回错误、**也不被拒绝** —— 它只是「没有体积可查」。
 *
 * ⚠️ 返回值是**给学生看的那句中文**，不是给开发者看的诊断：它会原样进 400 的响应体，
 * 经学生端的提示条显示出来。所以文案里带的是「怎么办」（撤销 / 清空），不是字段路径。
 */
/**
 * ★ 2026-09-30：九个基本图形的名字。
 *
 * 🔴 **这是同一份事实的第三处拷贝**（`src/lib/worksheet-ink.ts` 的 `INK_SHAPE_KINDS`、
 *    `server/src/services/ink-path.ts` 的同名常量、以及这里）。明知重复还要写：
 *    本文件**必须零 import**（`src/lib/worksheet-ink-parity.test.ts` 靠 Node 的类型擦除
 *    直接加载它，而 `./ink-path.js` 在那种加载方式下解析不了）。
 *    ⇒ 与 `INK_FORMATS` 那三份**同一条先例**：**由对拍用例钉住逐字相同**
 *    （`worksheet-ink-parity.test.ts` 里那条「三份形状表必须逐字相同」）。
 * ⚠️ 少了它，服务端会收下一个前端读不回来的 `shape` ⇒ 学生画的图形**凭空消失**。
 */
/** ★ 第二轮：文字的两条上限（段数 / 总字数）。⚠️ 与前端 `worksheet-ink.ts` 的同名常量
 *  **必须一致**（前端拦不住手搓请求，后端也拦不住前端的 bug —— 两边各拦一道）。 */
const INK_MAX_TEXTS = 100;
const INK_MAX_TEXT_CHARS = 2000;

const SHAPE_KINDS = [
  'line', 'arrow', 'rect', 'diamond', 'ellipse', 'triangle',
  'right-triangle', 'parallelogram', 'trapezoid', 'angle',
] as const;

/** 这个值是九个形状之一吗（与 `ink-path.ts` 的 `isInkShapeKind` 同判）。 */
function isShapeKind(raw: unknown): boolean {
  return typeof raw === 'string' && (SHAPE_KINDS as readonly string[]).includes(raw);
}

/** 形状表本身（供对拍用例读；`const` 不是 export，所以另给一个 getter）。 */
export function inkShapeKinds(): readonly string[] {
  return SHAPE_KINDS;
}

export function findInkValueError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isInkFormat(row.format)) return null;
  const strokes = row.strokes;
  if (!Array.isArray(strokes)) return '笔迹的形状不对（strokes 必须是数组）';
  if (strokes.length > INK_MAX_STROKES) {
    return `笔迹太多：最多 ${INK_MAX_STROKES} 笔，请撤销几笔或清空后重画`;
  }
  let total = 0;
  for (const stroke of strokes) {
    if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)) {
      return '笔迹的形状不对（每一条笔画都必须是对象）';
    }
    // ★ 2026-09-30：`shape` 认不出就**拒**。存下来之后前端会把它**整笔丢掉**
    // （`src/lib/worksheet-ink.ts` 的 `readInkValue`：坏形状丢整笔）⇒
    // 学生画的图形在教师端**凭空消失**，而那比一个 400 难查得多。
    // ⚠️ 形状表用 `isInkShapeKind`（`ink-path.ts` 那一份，逐字镜像前端）——
    //    不在这里再抄一份：抄一份就是「同一个事实多份拷贝」。
    const shape = (stroke as Record<string, unknown>).shape;
    if (shape !== undefined && !isShapeKind(shape)) {
      return '笔迹的形状不对（认不出的图形）';
    }
    const points = (stroke as Record<string, unknown>).points;
    if (!Array.isArray(points)) return '笔迹的形状不对（每条笔画的 points 必须是数组）';
    // 🔴 **逐点校验**：这一句是「上限 2000 个点」等价于「体积上限」的**唯一**依据。
    // 少了它，`points` 里装什么都能过 —— 终审 I1 实测：`Array(2000).fill('x'.repeat(4000))`
    // 这份 **8,006,103 字节**（`JSON.stringify` 的字节数，2026-09-24 实测）的值在旧实现下
    // **原样通过**（`null`），而它照样进 Json 列、照样由看板读端点整份取回。判据与
    // `src/lib/worksheet-ink.ts` 的 `readPoint` 同一口径：**两个有限数的二元数组**。
    for (const point of points) {
      if (!isInkPoint(point)) return '笔迹的形状不对（每个点必须是两个数的数组）';
    }
    total += points.length;
  }
  if (total > INK_MAX_POINTS) {
    return `笔迹太多：最多 ${INK_MAX_POINTS} 个点，请撤销几笔或清空后重画`;
  }
  // ★ 2026-09-30 第二轮：文字也有一条**体积**上限。
  // 🔴 理由与笔画那条同源：值要进 Json 列、要被看板读端点整份取回、还要过广播那条
  //    64KiB 的静默闸（超了看板那一格空白）。文字很容易写出很长的串，
  //    而**它没有点数可以当尺子** ⇒ 单独按字符数拦。
  const texts = row.texts;
  if (texts !== undefined) {
    if (!Array.isArray(texts)) return '文字的形状不对（texts 必须是数组）';
    if (texts.length > INK_MAX_TEXTS) {
      return `文字太多：最多 ${INK_MAX_TEXTS} 段，请删掉几段`;
    }
    let chars = 0;
    for (const item of texts) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return '文字的形状不对（每一段都必须是对象）';
      const text = (item as Record<string, unknown>).text;
      if (typeof text !== 'string') return '文字的形状不对（每一段的 text 必须是字符串）';
      chars += text.length;
    }
    if (chars > INK_MAX_TEXT_CHARS) {
      return `文字太多：最多 ${INK_MAX_TEXT_CHARS} 个字，请删掉一些`;
    }
  }
  const drawing = row.drawing;
  if (drawing !== undefined) {
    if (row.format !== 'drawing/v1') return '作图文档只能用于作图题';
    if (!drawing || typeof drawing !== 'object' || Array.isArray(drawing)) {
      return '作图文档的形状不对';
    }
    const document = drawing as Record<string, unknown>;
    if (typeof document.tool !== 'string'
      || !(DRAWING_TOOLS as readonly string[]).includes(document.tool)) {
      return '作图文档使用了不支持的工具';
    }
    if (!Object.prototype.hasOwnProperty.call(document, 'data')) {
      return '作图文档缺少绘图数据';
    }
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(document.data);
    } catch {
      return '作图文档的内容无法保存';
    }
    if (serialized === undefined) return '作图文档的内容无法保存';
    if (serialized.length > DRAWING_DOCUMENT_MAX_CHARS) {
      return '作图内容太多，请删除部分图形后再提交';
    }
  }
  return null;
}

/**
 * 一个点是不是**两个有限数的二元数组** —— 与 `src/lib/worksheet-ink.ts` 的 `readPoint`
 * 同一口径，只差一处：那边把越界的数**夹到 `0..1`**，这里**不夹**。
 * ⚠️ 差这一处是刻意的：越界（`[7, -3]`）**不是拒绝的理由** —— 夹取是**读**的一侧的事，
 * 而这里若顺手判一次界，就多了一条只落在 ink 值上的拒绝路径，且它与前端不同口径
 *（前端读回来是夹过的值，再提交就「合法」了 —— 同一份数据在两端结论不同）。
 *
 * ⚠️ `length !== 2` 也拒：`[x, y, z]` 是形状不对，不是「多带了点东西」。
 * 非 `number` / `NaN` / `Infinity` 同样拒（JSON 里它们只能以字符串或 `null` 出现，
 * 而那是手搓的痕迹）。
 */
function isInkPoint(raw: unknown): boolean {
  if (!Array.isArray(raw) || raw.length !== 2) return false;
  const x = raw[0];
  const y = raw[1];
  if (typeof x !== 'number' || typeof y !== 'number') return false;
  return Number.isFinite(x) && Number.isFinite(y);
}
