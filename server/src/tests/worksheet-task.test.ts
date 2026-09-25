/**
 * 「任务」容器**自己的**规矩 —— 校验器与判分器两层。
 *
 * 🔴 为什么单独成文件：任务在**判分、校验、选项、题号**四处都必须被表态（spec §一），
 * 而这四条里今天只有「题号」那一条有网（`src/lib/worksheet-heading-parity.test.ts`）。
 * 另外三条漏掉的表现都是**静默**的：
 *   · 判分器返回 `null`（= 没判过）⇒ 「任务被当成一道题」一路滑到界面：看板多一格、
 *     抽屉多一行、统计分母悄悄变大，**全程无报错**；
 *   · 校验器漏一支 ⇒ 一个空任务/嵌套任务存进库，学生端渲染出一段只有标题、没东西可答的内容。
 *
 * ── 两条 2026-09-25 的裁定（教师）──────────────────────────────────────
 *   · **允许空任务**（原第 1 步的裁定「任务里至少要有一道小题」**已被推翻**）：
 *     教师在编辑页点「+ 添加任务」之后、还没放小题时保存，不该撞上 400。
 *   · **任务的标题允许留空**：任务只是分组 + 一段说明（裁定 ①a），「纯分组」是合法数据。
 *     ⚠️ 这一条原先**只有注释这么说**，实际被 `validateQuestion` 的公共那句
 *     「题干不能为空」挡住了 —— 三处说一套、代码做另一套。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, validateQuestion, DEFAULT_POINTS, type QuestionNode } from '../services/worksheet-questions.js';
import { isAnalyzableType } from '../services/analysis-gate.js';

function task(over: Partial<QuestionNode> = {}): QuestionNode {
  return {
    id: 't_1',
    type: 'task',
    prompt: '任务一',
    inputMode: 'keyboard',
    data: {},
    children: [],
    ...over,
  };
}

/** 一道最小合法的小题（放进任务里用）。 */
function child(id: string): QuestionNode {
  return {
    id,
    type: 'single-choice',
    prompt: '光合作用的产物是？',
    inputMode: 'keyboard',
    data: { options: [{ key: 'A', text: '氧气' }, { key: 'B', text: '二氧化碳' }], correctKeys: ['A'] },
    children: [],
  };
}

/* ── 校验器 ─────────────────────────────────────────────────────────── */

test('🔴 空任务是**合法**的（教师 2026-09-25 裁定：点「+ 添加任务」之后还没放小题时不许撞 400）', () => {
  assert.deepEqual(validateQuestion(task({ children: [] })), []);
});

test('🔴 任务的标题允许留空 —— 「纯分组」是合法数据（裁定 ①a）', () => {
  // ⚠️ 这条曾经是红的：`validateQuestion` 的公共那句「题干不能为空」对任务一样生效，
  // 而报错用的词是「题干」—— 教师改的是任务名，却收到一句说「题干」的话。
  assert.deepEqual(validateQuestion(task({ prompt: '   ' })), []);
});

test('🔴 任务里不能再嵌套任务（题号会变成三级，「重复」的优势立刻消失）', () => {
  const errors = validateQuestion(task({ children: [task({ id: 't_2' })] }));
  assert.ok(errors.some((message) => message.includes('嵌套')), `应当拦下嵌套任务，实际：${JSON.stringify(errors)}`);
});

test('任务里装正常小题 ⇒ 通过（阳性对照：上面几条不是因为「任务一律报错」而绿的）', () => {
  assert.deepEqual(validateQuestion(task({ children: [child('q_1'), child('q_2')] })), []);
});

test('题干的非空校验**对普通题型仍然生效**（别为了任务把它一起放掉）', () => {
  const blank = child('q_1');
  assert.deepEqual(validateQuestion({ ...blank, prompt: '  ' }), ['题干不能为空']);
});

/* ── 判分器 ─────────────────────────────────────────────────────────── */

test('🔴 任务**永远不该被判分** —— 走到那里必须抛，不是静默返回 null', () => {
  // 返回 `null` 的语义是「这一题没判过」（主观题、还没提交、关了自动判分都是它），
  // 于是「任务被当成一道题」会一路滑到界面上，而**没有任何一处报错**。
  // 抛出去的代价是当场暴露，且暴露在**服务端日志**里 —— 那里才是能查的地方。
  assert.throws(
    () => grade(task({ children: [child('q_1')] }), { format: 'choice/v1', selected: ['A'] }, DEFAULT_POINTS),
    (error: unknown) => error instanceof Error,
  );
});

test('🔴 任务**两边都不属于**：既不判分，也不送去 AI 分析', () => {
  // 「每个题型，要么判分、要么送去分析」是本仓的一条二分法（`analysis-gate.test.ts` 那几条
  // 遍历测的就是它）。任务**两边都不是** —— 它没有作答值。把它漏进任何一侧都会静默出错：
  // 进了判分侧 ⇒ 「任务被当成一道题」滑到界面；进了分析侧 ⇒ 教师能在任务上点「分析」，
  // 而后端拿不到任何作答值，只会得到一段编造的解读。
  // ⚠️ 这条用例是终审 I2 补的：原先两个文件都写着「下面另有一条用例专门钉住」，
  //    而全仓**没有**那一条。
  assert.equal(isAnalyzableType('task'), false);
  assert.throws(() => grade(task({ children: [child('q_1')] }), null, DEFAULT_POINTS));
});
