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
 * 一个 8MB 的笔迹值会进 `WorksheetAnswer.value` 这个 Json 列，再经两条读端点与一次广播
 * 送到**教师那台机器**上（抽屉要把它画出来）⇒ 看板卡死，而**服务端不会报任何错**。
 * 学生端也躲不掉：那个值要过 `localStorage` 离线队列，配额一爆 `writeQueue` 的 `catch`
 * 就是**静默降级**（这一次会话内还在、撑不过刷新）。**前端拦不住这件事** ——
 * 它只拦得住自己客户端产生的值。
 *
 * ⚠️ 只对 ink 值生效。**别把它写成一道格式门**：认不出的 `format` 一律放行 ——
 * `format` 在服务端从来不是判据（`worksheet-answer-value.ts:48-71`，那段「`format` 在服务端只被读
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
    const points = (stroke as Record<string, unknown>).points;
    if (!Array.isArray(points)) return '笔迹的形状不对（每条笔画的 points 必须是数组）';
    total += points.length;
  }
  if (total > INK_MAX_POINTS) {
    return `笔迹太多：最多 ${INK_MAX_POINTS} 个点，请撤销几笔或清空后重画`;
  }
  return null;
}
