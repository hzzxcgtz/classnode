/**
 * 课堂级「逐题开放」的读写判据（★ 2026-09-30，教师）。
 *
 * 教师原话：「题目开放方式有必要再增加一个：允许教师纯手工、可按顺序的、一个一个去开启
 * 每个小题的使用权限」。
 *
 * ── 存的是什么 ────────────────────────────────────────────────────────────
 * `Classroom.worksheetOpen` 那一列 JSON：`{ [学习单 id]: [已开放的题 id…] }`。
 *   · **按学习单分键**：高级模式下各组拿的是不同的单，一份单一个进度；
 *   · 值是**一组题 id**，不是「开放到第 N 题」的游标 —— 教师中途插题 / 删题 / 调序，
 *     学生那边已开放的题不受影响（游标会跟着错位，而且不报错）；
 *   · **空数组与「键不存在」是一回事**（都表示这一份单一道都没开）⇒ 读的时候就并成一件，
 *     归一化时也把空数组**丢掉**（否则那个 JSON 会随教师的操作长出越来越多的空壳）。
 *
 * ── 为什么判据在这个文件里 ────────────────────────────────────────────────
 * 它与 `worksheet-schema.ts` 同一个处境：读写的是**库里的 JSON**，坏值（手改过的行、
 * 老版本写下的形状）只能**静默**降级，而降级的方向错了会让学生那一屏莫名其妙地少几道题。
 * 抽出来之后 `worksheet-open.test.ts` 能在纯函数层面钉住每一条。
 *
 * ⚠️ 服务端与客户端各有一份读取口径（客户端那份在 `src/lib/worksheet-answer-mode.ts` 的
 * `answerModeView` 里）：**两者都只做「这一题在不在清单里」这一件事**，没有第二套判据。
 */

/** 学习单 id → 已开放的题 id。 */
export type WorksheetOpenMap = Record<string, string[]>;

/**
 * 把库里那一列收成一个**一定可用**的映射。
 *
 * 🔴 认不出的一律当**空**（= 一道都没开放），不是「全部开放」：
 * 这一列读不出来时，学生那一屏会少几道题 —— 那是**看得见**的；反过来若当成「全开放」，
 * 老师明明设了手动静止的卷子会整个放开，而屏幕上没有任何异常。
 */
export function normalizeWorksheetOpen(raw: unknown): WorksheetOpenMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: WorksheetOpenMap = {};
  for (const [worksheetId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!worksheetId || !Array.isArray(value)) continue;
    const ids: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string' || item === '') continue;
      // 去重但**保持先后**：顺序本身没有语义（客户端按题目顺序画），
      // 可重复的 id 会让清单随每次「收回再开放」越滚越长。
      if (!ids.includes(item)) ids.push(item);
    }
    // 空的就**不写这个键**（与「没开过」同义，理由见文件头）。
    if (ids.length > 0) out[worksheetId] = ids;
  }
  return out;
}

/**
 * 某一份学习单此刻已开放的题 id。
 *
 * ⚠️ 读不出（没这个键 / 那是别的单的键）⇒ **空数组**。调用方（学生端读学习单那条路）
 * 拿它下发给客户端，而「一份空清单」在那边的含义是「还在等老师开第一题」——
 * 不是错误，所以不抛、不 500。
 */
export function openQuestionsFor(raw: unknown, worksheetId: string): string[] {
  if (typeof worksheetId !== 'string' || worksheetId === '') return [];
  return normalizeWorksheetOpen(raw)[worksheetId] ?? [];
}

/**
 * 把「某一份学习单开放哪些题」写回那一列（**整份替换**，幂等）。
 *
 * 🔴 只有这一个写入口：客户端发来的是**这一份单的完整清单**，不是增量。
 *    增量式的「加一个 / 去一个」要求服务端先读再改，而两个标签页同时点就会丢更新
 *    （教师那台机器上同时开着看板与设置是常事）。整份替换天然是后写者赢，且**幂等**。
 * ⚠️ 别的学习单的键**原样保留**：高级模式下有好几份单，动一份不许碰另一份。
 */
export function withOpenQuestions(raw: unknown, worksheetId: string, questionIds: unknown): WorksheetOpenMap {
  const next = normalizeWorksheetOpen(raw);
  if (typeof worksheetId !== 'string' || worksheetId === '') return next;
  const ids = normalizeWorksheetOpen({ [worksheetId]: questionIds })[worksheetId] ?? [];
  // 空的就**不写这个键**（与「没开过」同义，理由见文件头）。
  if (ids.length === 0) delete next[worksheetId];
  else next[worksheetId] = ids;
  return next;
}
