import type { PrismaClient } from '@prisma/client';
import { DEFAULT_POINTS, isUsableFullPointValue, normalizePointValue, type QuestionNode, type QuestionPoints } from './worksheet-questions.js';
// ⚠️ `TASK_TYPE` 在**零 import 的镜像**里（`worksheet-heading.ts`）—— 服务端的
// `worksheet-questions.ts` 用的是 `QUESTION_TYPES` 里那个字面量，没有单独导出它。
import { TASK_TYPE } from './worksheet-heading.js';

/**
 * 读一份学习单的**那两个档**（`settings.rewardStep` / `halfStep`）—— 逐题留空时继承的就是它们。
 *
 * ★ 2026-09-26：**本函数从 `worksheet-questions.ts` 搬到这里** —— 教师裁定之后
 * 「学习单级的默认给分」不再参与判分（判分只读逐题分值），它**唯一的用途**就是本迁移
 * 用来算「这道题当时继承到的那个值」。留在判分那个文件里会让人以为判分还在读它。
 *
 * ⚠️ 容错口径与判分一致：坏值 / 缺字段一律回落 `DEFAULT_POINTS`
 *（`full` 用 `isUsableFullPointValue` —— 它的域比 `half` 多一条「不能是 0」）。
 */
export function pointsFromSettings(settings: unknown): QuestionPoints {
  const source = (settings && typeof settings === 'object' && !Array.isArray(settings))
    ? settings as Record<string, unknown> : {};
  return {
    full: isUsableFullPointValue(source.rewardStep)
      ? normalizePointValue(source.rewardStep, DEFAULT_POINTS.full)
      : DEFAULT_POINTS.full,
    half: normalizePointValue(source.halfStep, DEFAULT_POINTS.half),
  };
}

/**
 * ★ 2026-09-26：**把逐题分值钉住** —— 教师裁定「学习单设置里的默认给分就不要了，
 * 已经在每小题中设置了」。
 *
 * ── 为什么不能只删界面 ──────────────────────────────────────────────
 *
 * `settings.rewardStep` / `halfStep` 今天**仍然**在决定一部分题的分：`points` 为空的题
 * 由 `resolvePoints(node, pointsFromSettings(settings))` 回落到它们 ——
 * 那才是判分真正读的那条路。只删界面 ⇒ 库里留一个**看不见却仍然生效**的旋钮。
 * 所以先钉住，再一路拆掉那条回落，让分值的来源从**两个**变成一个。
 *
 * ── 四条纪律 ────────────────────────────────────────────────────────
 *
 * 1. 🔴 **不猜。** 写进去的是**这道题当时继承到的那个值**（`pointsFromSettings(settings)`），
 *    不是 `DEFAULT_POINTS`。一份把 3/2 改写成 1/0 的迁移会**静默改掉全卷的分**，
 *    而教师看不出任何异常 —— 他只会觉得「分数怎么不对」。
 * 2. 🔴 **幂等。** 判据是「这份单里还有没有 `points` 为空的题」——
 *    它本身就幂等（外部那个完成标记只决定要不要再备份一次，见 `index.ts`）。
 * 3. 🔴 **逐题已填的一个字不动**：它早就脱离学习单级了（规格 §12 裁定 4）。
 * 4. **任务里的小题同样要钉**（2026-09-25 的迁移之后，题都在任务里）；
 *    🔴 而**任务自己**反过来 —— 它**不该有** `points`（裁定 ①a：任务不能作答），
 *    本迁移顺手把已有的清掉（第一版没排除它，真库上见过「任务带着 `2/1`」那种噪音）。
 */
export async function migrateWorksheetPoints(prisma: PrismaClient): Promise<{ migrated: number }> {
  const worksheets = await prisma.worksheet.findMany({ select: { id: true, content: true, settings: true } });
  let migrated = 0;

  for (const sheet of worksheets) {
    const content = sheet.content as { schemaVersion?: number; nodes?: unknown[] } | null;
    if (!content || !Array.isArray(content.nodes)) continue;

    const inherited = pointsFromSettings(sheet.settings);
    let touched = false;

    /** 递归钉：没变就**返回原对象**（免得每份单都被重建一遍、也免得制造无意义的写库）。 */
    const pin = (value: unknown): QuestionNode => {
      const node = value as QuestionNode;
      const kids = Array.isArray(node.children) ? node.children : [];
      const nextKids = kids.map(pin);
      const kidsChanged = nextKids.some((child, index) => child !== kids[index]);

      // 🔴 **任务不该有 `points`**（教师裁定 ①a：任务只是分组 + 一段说明，**不能作答**）。
      // 它没有任何地方读这个字段（判分/看板/导出/抽屉全都只看「可作答的题」），
      // 钉上去是**噪音**：库里看着像「任务有分」。已在真库上见过一次（第一版没排除它）。
      if (node.type === TASK_TYPE) {
        if (node.points === undefined) return kidsChanged ? { ...node, children: nextKids } : node;
        const cleaned: QuestionNode = { ...node, children: nextKids };
        delete cleaned.points;
        touched = true;
        return cleaned;
      }

      if (node.points !== undefined) {
        return kidsChanged ? { ...node, children: nextKids } : node;
      }
      touched = true;
      return { ...node, points: { ...inherited }, ...(kidsChanged ? { children: nextKids } : {}) };
    };

    const nodes = content.nodes.map(pin);
    // 纪律 2：没有空着的题就什么都不做（含空学习单）。
    if (!touched) continue;

    await prisma.worksheet.update({
      where: { id: sheet.id },
      // ⚠️ `as never`：`content` 是 Prisma 的 `Json` 列，窄化要走 unknown（与既有的三处同形）。
      data: { content: { ...content, nodes } as never },
    });
    migrated += 1;
  }

  return { migrated };
}
