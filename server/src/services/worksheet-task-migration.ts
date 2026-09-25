import { randomUUID } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

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
 * 3. 🔴 **幂等。** 判据是「顶层还有没有非 `task` 的节点」，而不是外部的一个完成标记 ——
 *    迁移可能中途崩过（标记没写上），而**那个判据本身就是幂等的**。
 *
 * 4. 🔴 **空学习单不造空任务。** 一个空学习单是**合法数据**，而 `VALIDATORS['task']`
 *    会把「空任务」判为**不合法** ⇒ 迁移不许把合法数据弄成不合法的。
 *    没有散题就一个任务都不建。
 *
 * ── 一个刻意的选择：已有任务**不并进**收容任务 ──────────────────────────────
 *
 * 顶层混着「已有的任务」与「散题」时（跑到一半崩过的库、或将来手工做过的库），
 * **只把散题收进一个新任务，已有的任务原样留在原位**。
 * 理由：把它们并进同一个任务会**悄悄改变已有的分组** —— 而那是教师自己做的决定。
 * 迁移只该做「把散题归拢」这一件事。
 */
export async function migrateWorksheetsToTasks(prisma: PrismaClient): Promise<{ migrated: number }> {
  const worksheets = await prisma.worksheet.findMany({ select: { id: true, content: true } });
  let migrated = 0;

  for (const sheet of worksheets) {
    const content = sheet.content as { schemaVersion?: number; nodes?: unknown[] } | null;
    if (!content || !Array.isArray(content.nodes)) continue;

    // 纪律 3：判据是「顶层还有没有非 task 的节点」—— 它本身就幂等。
    const loose = content.nodes.filter((node) => (node as { type?: string } | null)?.type !== 'task');
    if (loose.length === 0) continue; // 纪律 4：没有散题就什么都不做（含空学习单）

    // ⚠️ 只**追加**一个收容任务，已有的顶层节点（含已有的任务）**原样保持顺序与位置**。
    const wrapper = {
      id: randomUUID(),
      type: 'task',
      prompt: '任务一',
      // ⚠️ 任务是容器，没有作答控件；`inputMode` 只是 `QuestionNode` 的必填形状。
      inputMode: 'keyboard',
      data: {},
      children: loose,
    };
    const kept = content.nodes.filter((node) => (node as { type?: string } | null)?.type === 'task');

    await prisma.worksheet.update({
      where: { id: sheet.id },
      data: { content: { ...content, nodes: [...kept, wrapper] } as never },
    });
    migrated += 1;
  }

  return { migrated };
}
