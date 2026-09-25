import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * ★ 2026-09-25：**任务制迁移** —— 把现有学习单的平铺题包进一个任务容器。
 *
 * 教师裁定 ④a：「自动包一层『任务一』」。
 *
 * ── 四条纪律（spec `2026-09-25-学习单-任务制与编辑页重设计.md` §五）───────────
 *
 * 1. 🔴 **原节点一个字不动。** 只是**外面包一层**，`children` 里装的是原来那些对象**本身**
 *    ⇒ 回滚 = 把那层剥掉（`nodes[0].children`），不需要备份内容。
 *
 * 2. 🔴 **迁移不编说明。** 任务的 `prompt` 给 `'任务一'` 这个**标题**，不给任何描述性文字 ——
 *    与「有效期不猜」是同一条纪律：我们没有依据去替教师写「读下面的材料…」。
 *
 * 3. 🔴 **幂等。** 判据是「顶层有没有出现过 `task`」，而不是外部的一个完成标记 ——
 *    那个判据**本身就是幂等的**，标记（`index.ts` 里那个）只决定要不要再备份一次。
 *
 *     ⚠️ 这条判据 **2026-09-25 改过**（原写法是「顶层还有没有**非** `task` 的节点」）。
 *     原判据会把「顶层已经有任务、又混着散题」的库**再包一个**容器，而容器名是**恒定**的
 *     `'任务一'` ⇒ 同屏两个「任务一」，题号也逐字撞车（`任务一 · 1` 出现两次）。
 *     新判据的语义更贴迁移的本分：**它是一次性升级，只处理「还没有任何任务」的学习单。**
 *     顶层已经有任务 ⇒ 要么迁过了，要么是教师自己做的分组 —— 两种都不该被改写。
 *     ⚠️ 原注释给的另一条理由（「迁移可能中途崩过」）**在这份实现里不成立**：
 *     每次 `prisma.worksheet.update` 只写**一行**、是原子的，不存在「一份单迁了一半」。
 *
 * 4. 🔴 **空学习单不造空任务。** 没有散题就一个任务都不建（纪律 4 原封不动）。
 *     ⚠️ 但在 2026-09-25 之后这**不再是**为了躲开校验：教师那天裁定「**允许空任务**」，
 *     `VALIDATORS['task']` 里那条「任务里至少要有一道小题」已经删掉了。
 *     现在不造空任务纯粹是**品味**（不造一个没用的、教师也没要过的容器）。
 *
 * ── 一个刻意的选择：已有任务**不并进**收容任务 ──────────────────────────────
 *
 * 顶层混着「已有的任务」与「散题」时，**整份不动**（见上面纪律 3 的 2026-09-25 改动）。
 * 理由：把散题并进已有任务、或另起一个收容任务，都是在**悄悄改变教师自己做的分组**
 * —— 而迁移只该做「把还没有分组的散题归拢」这一件事，那种情况里顶层一个任务都没有。
 */
export async function migrateWorksheetsToTasks(prisma: PrismaClient): Promise<{ migrated: number }> {
  const worksheets = await prisma.worksheet.findMany({ select: { id: true, content: true } });
  let migrated = 0;

  for (const sheet of worksheets) {
    const content = sheet.content as { schemaVersion?: number; nodes?: unknown[] } | null;
    if (!content || !Array.isArray(content.nodes)) continue;

    // 纪律 3：顶层**出现过 task** 就整份不动 —— 它本身就幂等（见文件头那段 2026-09-25 的更正）。
    const hasTask = content.nodes.some((node) => (node as { type?: string } | null)?.type === 'task');
    if (hasTask) continue;

    const loose = content.nodes;
    if (loose.length === 0) continue; // 纪律 4：没有散题就什么都不做（含空学习单）

    // ⚠️ 只**追加**一个收容任务（此时顶层一个任务都没有，所以不会撞名）。
    const wrapper = {
      id: randomUUID(),
      type: 'task',
      prompt: '任务一',
      // ⚠️ 任务是容器，没有作答控件；`inputMode` 只是 `QuestionNode` 的必填形状。
      inputMode: 'keyboard',
      data: {},
      children: loose,
    };
    await prisma.worksheet.update({
      where: { id: sheet.id },
      data: { content: { ...content, nodes: [wrapper] } as never },
    });
    migrated += 1;
  }

  return { migrated };
}
