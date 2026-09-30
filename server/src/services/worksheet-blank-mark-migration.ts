import type { PrismaClient } from '@prisma/client';
import type { QuestionNode } from './worksheet-questions.js';

/**
 * 题干里那个**填空域**标记串 —— 客户端那一份在 `src/lib/worksheet-prompt-marks.ts`
 * 的 `BLANK_MARK_TEXT`。⚠️ 与 `worksheet-questions.ts` 的 `FILL_BLANK_TEXT` 一样是
 * **刻意的双胞胎**（另一个包、import 不过来）。
 */
const BLANK_MARK = '{填空域}';

/**
 * 🔴 判据 2026-09-29 放宽过一次，理由是一个**在真库里撞到的**形状。
 *
 * 第一版只认「文字是一串下划线」（那正是 `migrateFillBlankToInline` 写出来的形状）。
 * 但在开发库里核的时候发现了一道题，题干是 `哈哈{填空区域}，{填空区域}`：
 * 分段**带着 `blank` 标识**（2-8 / 9-15，各 6 个字符），而文字是 `{填空区域}` ——
 * **6 个字，不是 5 个**。它同样会在下一次编辑题干时被 `recognizeBlanks` 抹掉
 *（实测：读库后空数 2、编辑后 0）。
 *
 * `git log -S'{填空区域}'` 查过：这个串**从来没在源码里出现过** —— 是教师照着
 * 帮助文案（早期文案里写的是「填空区域」）**手打的**。而它是怎么带上标识的也查清了：
 * 旧版 `handlePaste` 只做 `remapRuns`、**不做识别**，把 `域` 换成 `区域` 时新的两个字
 * 落在一个空的**内部**，按「插在空内部就属于那个空」那条规则继承了标识。
 *（那一版粘贴已经在本批改成与打字同一条识别 —— 于是「手打错」与「粘错」现在表现一致：
 *  都不算空。这是那条裁定的本意。）
 *
 * ⇒ 判据改成「**已经带着标识、但文字不是那个标记**」：
 *   · 更**准**：只碰数据里**本来就**是空的分段，正文里的下划线一概不在里面
 *     （它们的 `blank` 是空串）；
 *   · 更**全**：下划线、手打错的标记、以及将来任何一种写坏的文字，一并收口。
 *   ⚠️ 这不违反「不猜」：这里的动作是「把一个**已经是空**的分段的占位文字改成规范写法」，
 *   不是凭空造一个空出来。空的数量、先后、身份、答案下标**一个都不变**。
 */

/**
 * ★ 2026-09-29：把题干里**老形态的空**（一串下划线）统一成 `{填空域}`。
 *
 * ── 它修的是一个**实测出来的丢数据 bug** ────────────────────────────────────
 * `migrateFillBlankToInline`（2026-09-26）把空追加到题干末尾，用的占位串是
 * `'________'`（8 个下划线），而**客户端重新识别空的那条路只认 `{填空域}`**
 *（`recognizeBlanks`，教师 2026-09-27 裁定的规则①「5 个字符全」）。
 * ⇒ 教师在题干里多打一个字，`runsFromText` 就把那个空**抹掉**了：
 *   读库后空数 1、编辑题干后空数 0（2026-09-29 探针实测）。
 *   `data.answers` 还在，但学生那边已经不画输入框了 —— **全程不报错**。
 *
 * 教师这次的裁定是「填空的小括号和下划线要替换成 `{填空域}`」（粘贴导入那一批），
 * 而这一条迁移是它的**存量那一半**：不改库里的老题，那个 bug 就还在，
 * 而且**这一批新增的导入功能也没法与它共存**（同一句题干里两种形态）。
 *
 * ── 判据（刻意窄到不可能误伤）──────────────────────────────────────────────
 * 🔴 **只改「带着 `blank` 标识、且那一段文字正好是下划线」的分段。**
 *   · 题干里当普通文字用的下划线（`file_name`、`变量 _`）**不在**判据里 —— 它们不带标识；
 *   · 单空题 / 多空题 / 表格题一律不管 —— 不带标识的那些分段一个字都不动。
 * ⇒ 这条判据**本身幂等**（改完之后那一段是 `{填空域}`，不再匹配），所以照
 *   `worksheet-points-migration.ts` 那样**每次启动都能安全地跑**，不需要「只跑一次」。
 *
 * ── 不改什么（与既有那三条迁移同源的四条纪律）──────────────────────────────
 *   1. 🔴 **`data.answers` 一个字不动** —— 空的**数量与先后都没变**，答案下标照旧；
 *   2. 🔴 **空的身份（`blank` 那个标识）照原样搬** —— 换一个就等于把答案作废；
 *   3. 🔴 **其它 `data` 字段、其它题型、非字符串的题干一律不碰**（认不出就不动，不猜）；
 *   4. ⚠️ 没东西可迁的题**返回原对象**（同一个身份）—— 免得每份单都被重建一遍、
 *      也免得制造无意义的写库。
 */
export async function migrateBlankMarkText(prisma: PrismaClient): Promise<{ migrated: number }> {
  const worksheets = await prisma.worksheet.findMany({ select: { id: true, content: true } });
  let migrated = 0;

  for (const sheet of worksheets) {
    const content = sheet.content as { schemaVersion?: number; nodes?: unknown[] } | null;
    if (!content || !Array.isArray(content.nodes)) continue;

    let touched = false;

    const convert = (value: unknown): QuestionNode => {
      const node = value as QuestionNode;
      const kids = Array.isArray(node.children) ? node.children : [];
      const nextKids = kids.map(convert);
      const kidsChanged = nextKids.some((child, index) => child !== kids[index]);
      const withKids = (): QuestionNode => (kidsChanged ? { ...node, children: nextKids } : node);

      const prompt = typeof node.prompt === 'string' ? node.prompt : '';
      const data = (node.data && typeof node.data === 'object' && !Array.isArray(node.data))
        ? node.data as Record<string, unknown>
        : null;
      if (!data || prompt === '') return withKids();
      const runs = Array.isArray(data.promptRuns) ? data.promptRuns as Record<string, unknown>[] : [];
      if (runs.length === 0) return withKids();

      /**
       * 认得出的分段 —— `start` / `end` 都是数字且不反序，还带着**非空字符串**的 `blank`。
       * ⚠️ 认不出的**一条都不丢**（它们原样留在 `nextRuns` 里），这里只是挑出「可以改的那些」。
       */
      const usable = runs.map((run, index) => ({ run, index })).filter((item) => {
        const { start, end, blank } = item.run;
        return typeof start === 'number' && typeof end === 'number' && end > start
          && (end as number) <= prompt.length && Number.isInteger(start) && Number.isInteger(end)
          && typeof blank === 'string' && blank !== '';
      });
      // 从左到右改（坐标偏移是累加的）—— 库里本来就按 `start` 排，这里不信任它。
      usable.sort((a, b) => (a.run.start as number) - (b.run.start as number));
      // 🔴 **分段必须两两不重叠**才敢按坐标重建题干。重叠是坏数据（`readPromptRuns`
      // 会在读的时候把它切开），而这里没有那一层归一化 ⇒ 认不出就整道题不动（宁可不迁）。
      let seen = -1;
      for (const { run } of usable) {
        if ((run.start as number) < seen) return withKids();
        seen = run.end as number;
      }

      /** 这一条分段需不需要统一 —— **判据见文件头那段**（放宽过一次）。 */
      const needsMark = (run: Record<string, unknown>): boolean => (
        prompt.slice(run.start as number, run.end as number) !== BLANK_MARK
      );
      if (!usable.some(item => needsMark(item.run))) return withKids();

      // ① 重建题干文本（按原始坐标从左到右拼，拼的时候把老占位串换掉）。
      let nextPrompt = '';
      let cursor = 0;
      for (const { run } of usable) {
        if (!needsMark(run)) continue;
        nextPrompt += prompt.slice(cursor, run.start as number) + BLANK_MARK;
        cursor = run.end as number;
      }
      nextPrompt += prompt.slice(cursor);

      // ② 同步每一条分段的坐标（改过的那一条长度变了，它后面的全部平移）。
      let delta = 0;
      const byIndex = new Map<number, { start: number; end: number }>();
      for (const { run, index } of usable) {
        const start = (run.start as number) + delta;
        const end = needsMark(run) ? start + BLANK_MARK.length : (run.end as number) + delta;
        if (needsMark(run)) delta += BLANK_MARK.length - ((run.end as number) - (run.start as number));
        byIndex.set(index, { start, end });
      }
      const nextRuns = runs.map((run, index) => {
        const moved = byIndex.get(index);
        return moved ? { ...run, start: moved.start, end: moved.end } : run;
      });

      touched = true;
      return { ...node, prompt: nextPrompt, data: { ...data, promptRuns: nextRuns }, ...(kidsChanged ? { children: nextKids } : {}) };
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
