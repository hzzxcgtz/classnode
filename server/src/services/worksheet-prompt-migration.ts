import type { PrismaClient } from '@prisma/client';
import type { QuestionNode } from './worksheet-questions.js';

/** 迁移前整段样式长什么样（老数据的形状，**只读**）。 */
interface LegacyPromptStyle {
  bold?: unknown;
  italic?: unknown;
  color?: unknown;
}

/** 老数据里 `promptStyle` 的默认色（与学生端 `DEFAULT_PROMPT_STYLE.color` 同值）。 */
const LEGACY_DEFAULT_COLOR = '#1e293b';

/**
 * ★ 2026-09-26：把**整段的** `promptStyle` 迁成**分段的** `promptRuns`。
 *
 * ── 为什么必须有这一次迁移 ──────────────────────────────────────────────────
 * 教师要求「下划线和着重号，并且可以**只选择下面的部分文字**来设置」⇒ 题干的格式从
 * 「整段一份」变成「按区间标」。第 2 步把题干的渲染并成了一处（`PromptText`，只认
 * `promptRuns`），当时为了让**已经设过格式的老题**不掉格式，那里挂了一个**临时桥**
 * （`readPromptRunsFor` 回落 `promptStyle`）。本迁移跑完之后那个桥就删掉 ——
 * 格式的来源从**两个**变成一个。
 *
 * ── 四条纪律（与 `worksheet-points-migration.ts` 逐条同源）──────────────────
 *
 * 1. 🔴 **不猜。** 写进去的是这道题**当时已经生效**的那份样式 —— `promptStyle` 里那三个
 *    字段原样搬。判据不是「新格式应该长什么样」，而是一份把「3 号字的红字」改写成
 *    「默认样式」的迁移会**静默改掉全卷的样子**，而教师看不出任何异常。
 * 2. 🔴 **幂等。** 判据是「这份单里还有没有 `promptStyle`」—— 它本身就幂等
 *    （外部那个完成标记只决定要不要再备份一次，见 `index.ts`）。
 * 3. 🔴 **没格式的题不造东西。** 整段样式本来就是默认 ⇒ **只把那个键删掉**，
 *    不写一条「全是默认」的分段：读的一侧（`readPromptRuns`）对「没有 `promptRuns`」
 *    的答案本来就是「一条默认分段」，写出来是纯噪音。
 * 4. **任务里的小题同样要迁**（2026-09-25 的迁移之后，题都在任务里）。
 *    ⚠️ 任务节点本身**没有** `promptStyle`（它的标题走的是另一个输入框，没有格式工具栏），
 *    所以这里不为它单开一条分支 —— 真出现也只是白转一次，没有任何地方读任务的分段。
 *
 * ⚠️ **颜色不做白名单校验**：老数据里的 `color` 只可能来自那 5 个色板值（或一次手改的库），
 * 而**读的一侧本来就会**把认不出的颜色落回默认（`readPromptRuns` → `isKnownColor`）。
 * 在这里再抄一份色板 = 第二份真源，而它漂移的后果是「迁移写进去的值与界面认的值不一致」，
 * 两边都不报错。
 */
export async function migrateWorksheetPromptStyle(prisma: PrismaClient): Promise<{ migrated: number }> {
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

      const data = (node.data && typeof node.data === 'object' && !Array.isArray(node.data))
        ? node.data as Record<string, unknown>
        : null;
      if (!data) return withKids();
      const style = data.promptStyle;
      // 纪律 1：认不出的形状一律**不碰**（不是猜成默认 —— 猜就是静默改写）。
      if (!style || typeof style !== 'object' || Array.isArray(style)) return withKids();

      const legacy = style as LegacyPromptStyle;
      const prompt = typeof node.prompt === 'string' ? node.prompt : '';
      const nextData: Record<string, unknown> = { ...data };
      delete nextData.promptStyle;

      // 纪律 3：全默认 ⇒ 只删键。
      const bold = legacy.bold === true;
      const italic = legacy.italic === true;
      const color = typeof legacy.color === 'string' ? legacy.color : LEGACY_DEFAULT_COLOR;
      const hasFormat = bold || italic || color !== LEGACY_DEFAULT_COLOR;
      // 题干为空时**没有位置**可以属于任何分段（写一条 0..0 的空段是坏数据）。
      if (hasFormat && prompt.length > 0) {
        nextData.promptRuns = [{
          start: 0,
          end: prompt.length,
          bold,
          italic,
          // 老数据里没有这两个字段 —— 它们本来就不存在，写 `false` 是**如实的**。
          underline: false,
          emphasis: false,
          color,
        }];
      }

      touched = true;
      return { ...node, data: nextData, ...(kidsChanged ? { children: nextKids } : {}) };
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
