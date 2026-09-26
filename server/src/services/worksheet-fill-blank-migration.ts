import type { PrismaClient } from '@prisma/client';
import type { QuestionNode } from './worksheet-questions.js';
import { TASK_TYPE } from './worksheet-heading.js';

/**
 * 追加到题干末尾的那段占位。
 *
 * ⚠️ 客户端那个「填空区域」按钮用的是**同一个字符串**（`prompt-editor.tsx` 里的
 * `FILL_BLANK_TEXT`）。两处不一致的后果只是「迁移出来的空比新插的宽一点」——
 * **纯外观**，教师随手重插一个就一样了。所以这里不搞跨项目常量那一套（值这份收益）。
 */
const BLANK_PLACEHOLDER = '________';

/**
 * ★ 2026-09-26：把填空题的**空**从「题干外面一排输入框」迁成「题干文字中间的空」。
 *
 * ── 为什么必须有这一次迁移 ──────────────────────────────────────────────────
 * 教师裁定：「填空是在**题目文字中间**输入，一道题可以包含多个填空区域。」
 * 而老填空题的题干里**一个空都没有** —— 空是 `data.blanks` 那个**数量**，
 * 答题框画在题干外面（`fill-body.tsx` 按那个数画）。两种形状并存是本仓最防的分叉
 *（渲染 / 判分 / 校验 / 导出 / 看板都要分叉，而它们漂移时两边都不报错）
 * ⇒ 教师选了「把空**追加到题干末尾**」，让库里只留**一种**形状。
 *
 * ── 数据形状 ────────────────────────────────────────────────────────────────
 * 空 = `data.promptRuns` 里**带 `blank` 标识的那一条分段**（`blank` 与那五个样式字段
 * 不是一类东西：那五个是样式，这个说的是「这一段属于哪个空」）。
 * 🔴 **标识是每题唯一的字符串，不是「第几个空」的编号**（施工时的 ruling，见 ledger）：
 *   没有标识就分不开「三个空挨着排」与「一个空被切开」——
 *   而**本迁移的输出正好是前者**（`'________'.repeat(n)`，三个空连着追加）。
 *   答案序号是「从左到右排第几」（`blankRuns` 的顺序推），标识只回答「是不是同一个空」。
 *
 * ── 四条纪律（与 `worksheet-points-migration.ts` 同源）──────────────────────
 *
 * 1. 🔴 **不猜。** 空的数量**照原样推出来**：多空 = `data.blanks.length`、单空 = 1
 *    （判据与 `judgeFillBlank` 逐字一致：`Array.isArray(data.blanks)` 在不在）。
 *    编一个数出来会让一道题凭空多出或少掉几格，而屏幕上只是一排框的数量变了。
 * 2. 🔴 **答案必须一条不丢地搬过去，而且形状会变。** 多空形状里答案住在
 *    `data.blanks[i].answers`（**不是**另一个 `data.answers`）—— 删 `blanks` 之前先把它们搬出来。
 *    这里统一成**每空一份可接受答案**（`string[][]`）：多空的 `blanks[i].answers` 原样搬、
 *    单空的平铺 `answers` 包一层。⚠️ **这一步会改变单空题的 `data.answers` 形状** ⇒
 *    它必须与「编辑器认新形状」（spec 第 4 步）**同一批上线**，否则中间那段时间里
 *    编辑器读单空题的答案是错的。
 * 3. 🔴 **手写作答改回键盘**（同批裁定 ③）：题干内输入与手写天然冲突。
 *    ⚠️ `inputMode` 在**节点上**（不在 `data` 里）—— 写错地方等于没改。
 * 4. ⚠️ **这一次迁移与前两条不同：它必须只跑一次**（由 `index.ts` 的完成标记把门）。
 *    理由是它的幂等判据**认不出**「一道刚建好、题干写了但还没插空的新填空题」与
 *    「一道老填空题」—— 两者都是「没有空」。前两条迁移的判据（「还有没有空着的
 *    `points`」「还有没有 `promptStyle`」）本身幂等，所以它们每次启动都能安全地跑；
 *    这一条不能。**判据不可靠时，唯一安全的就是只跑一次。**
 */
export async function migrateFillBlankToInline(prisma: PrismaClient): Promise<{ migrated: number }> {
  const worksheets = await prisma.worksheet.findMany({ select: { id: true, content: true } });
  let migrated = 0;

  for (const sheet of worksheets) {
    const content = sheet.content as { schemaVersion?: number; nodes?: unknown[] } | null;
    if (!content || !Array.isArray(content.nodes)) continue;

    let touched = false;

    /** 递归转：没变就**返回原对象**（免得每份单都被重建一遍、也免得制造无意义的写库）。 */
    const convert = (value: unknown): QuestionNode => {
      const node = value as QuestionNode;
      const kids = Array.isArray(node.children) ? node.children : [];
      const nextKids = kids.map(convert);
      const kidsChanged = nextKids.some((child, index) => child !== kids[index]);
      const withKids = (): QuestionNode => (kidsChanged ? { ...node, children: nextKids } : node);

      // 任务不是一道题（它没有作答控件），也不带 `data.blanks` ⇒ 连同别的题型一起跳过。
      if (node.type === TASK_TYPE || node.type !== 'fill-blank') return withKids();

      const data = (node.data && typeof node.data === 'object' && !Array.isArray(node.data))
        ? node.data as Record<string, unknown>
        : null;
      if (!data) return withKids();

      const runs = Array.isArray(data.promptRuns) ? data.promptRuns as Record<string, unknown>[] : [];
      // ⚠️ 标识是**非空字符串**（不是 `true`）—— 判据必须与写出去的那一份同形。
      // （改形状时我漏了这一行、只改了注释，幂等用例当场变红：第二次跑又追加了一个空。）
      const hasInlineBlank = runs.some(run => (
        run && typeof run === 'object' && typeof (run as Record<string, unknown>).blank === 'string'
        && (run as Record<string, unknown>).blank !== ''
      ));
      // ⚠️ 手写那一档要单独看：一道**已经有空**的题也可能是手写的（教师先插了空、
      // 再把它切成手写）—— 那种题不追加空，但 `inputMode` 仍要改。
      const needsKeyboard = node.inputMode === 'handwriting';
      if (hasInlineBlank) {
        if (!needsKeyboard) return withKids();
        touched = true;
        return { ...node, inputMode: 'keyboard', ...(kidsChanged ? { children: nextKids } : {}) };
      }

      // 纪律 1：空的数量照原样推出来。**认不出的形状一律不动**（不是猜成 1 个空）。
      const legacyBlanks = data.blanks;
      if (legacyBlanks !== undefined && !Array.isArray(legacyBlanks)) return withKids();
      const count = Array.isArray(legacyBlanks) ? legacyBlanks.length : 1;
      // 一个空都没有的多空题（教师建了但一个都没填）⇒ 不追加（`blanks: []` 就是 0 个空，
      // 那是**如实的** —— 编一个空出来会让它变成一个教师没要求过的填空题）。
      if (count === 0) return withKids();

      const prompt = typeof node.prompt === 'string' ? node.prompt : '';
      const appended = Array.from({ length: count }, () => BLANK_PLACEHOLDER).join('');
      const nextPrompt = prompt + appended;
      const nextData: Record<string, unknown> = { ...data };
      // 🔴🔴 **答案在 `blanks` 里面**（多空形状是 `blanks[i].answers`）——
      // 把它们搬出来**再**删 `blanks`。少了这一步就是**一次静默的数据丢失**：
      // 空还在（题干里多了几个），而每空的答案一个不剩 ⇒ 全班判错。
      // ⚠️ 第一版就是这么写的（`delete nextData.blanks` 之前**没有**搬答案），
      // 而用例**没抓到** —— 因为我**编了**数据形状（另外写了一个 `data.answers`），
      // 而不是照 `VALIDATORS` / `judgeFillBlank` 读真形状。**用例的数据也必须是真的。**
      //
      // 统一成**每空一份可接受答案**（`string[][]`）：
      //   · 多空：`blanks[i].answers` 原样搬（它本来就是一份可接受答案的数组）；
      //   · 单空：`data.answers` 是**平铺**的一份可接受答案 ⇒ 包一层变成「第一个空的」。
      // 于是「空 i 的答案」在两个形状下都是 `answers[i]`，判分只有一条路。
      nextData.answers = Array.isArray(legacyBlanks)
        ? legacyBlanks.map((blank) => (
          blank && typeof blank === 'object' && !Array.isArray(blank)
            ? ((blank as Record<string, unknown>).answers ?? [])
            : []
        ))
        : [Array.isArray(data.answers) ? data.answers : []];
      delete nextData.blanks;
      // ⚠️ **只写空那几条**，不补 [0, prompt.length) 那一段：
      // 读的一侧（`readPromptRuns`）本来就会把空隙补成默认样式 —— 那是它的职责，
      // 在这里再补一份就是第二处会算错的地方（补错了会让题干掉格式）。
      const blankStart = prompt.length;
      nextData.promptRuns = [
        ...runs,
        ...Array.from({ length: count }, (_, index) => ({
          start: blankStart + index * BLANK_PLACEHOLDER.length,
          end: blankStart + (index + 1) * BLANK_PLACEHOLDER.length,
          bold: false,
          italic: false,
          underline: false,
          emphasis: false,
          color: '#1e293b',
          // 每题唯一的标识（与客户端 `insertBlank` 里那个同一套语义）。
          blank: `blank_${index + 1}`,
        })),
      ];

      touched = true;
      return {
        ...node,
        prompt: nextPrompt,
        inputMode: 'keyboard',
        data: nextData,
        ...(kidsChanged ? { children: nextKids } : {}),
      };
    };

    const nodes = content.nodes.map(convert);
    if (!touched) continue;

    await prisma.worksheet.update({
      where: { id: sheet.id },
      // ⚠️ `as never`：`content` 是 Prisma 的 `Json` 列，窄化要走 unknown（与既有的几处同形）。
      data: { content: { ...content, nodes } as never },
    });
    migrated += 1;
  }

  return { migrated };
}
