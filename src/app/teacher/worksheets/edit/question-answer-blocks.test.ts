/**
 * ★ 2026-09-30：两个题型的「答案那一块」摆在哪里、以及主观题判不判分。
 *
 * 🔴 本仓没有 jsdom、没有浏览器 ⇒「这两栏**是不是真的并排**」在本机**验不了**（那要真机看）。
 *    这一条网能回答的只有：**零件在不在、谁渲染谁**。
 *    ⚠️ 所以它**不保证**：窄屏真的叠了、两栏真的等宽、右栏没被挤破 —— 那些只能真机走查。
 *
 * ⚠️ 断言一律先**剥掉 import 行**：`OrderAnswerBody` 这种名字**本来就出现在 import 里**，
 *    不剥的话「把调用点整个删掉、只留一行 import」照样绿。
 *    这个坑 `worksheet-prompt-text.test.ts` 记着被变异检验抓出来的那一次。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD = fs.readFileSync(path.join(HERE, 'question-card.tsx'), 'utf8');
const ORDER = fs.readFileSync(path.join(HERE, 'bodies', 'order-body.tsx'), 'utf8');
const GLOBALS = path.resolve(HERE, '../../../../app/globals.css');
const QTYPES = path.resolve(HERE, '../../../../lib/worksheet-questions.ts');

/** 块注释（含 JSX 的 `{/* … *\/}`）与整行 `//` 注释。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 连 `import` 行也剥掉（理由见文件头）。⚠️ 按行剥，假设 import 都是单行。 */
function stripImports(source: string): string {
  return source.split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
}

const body = (source: string) => stripImports(stripComments(source));

test('阳性对照：这条网真的在读这几个文件（否则下面几条对空串永远绿）', () => {
  assert.ok(body(CARD).length > 1000, '剥 import 与注释之后剩下的仍是题目卡');
  assert.ok(body(ORDER).length > 500, '剥完之后剩下的仍是排序题的编辑体');
  assert.ok(fs.readFileSync(GLOBALS, 'utf8').includes('.worksheet-editor-order-columns'), 'CSS 里要真的有这个类');
});

test('★ 主观题的参考答案：有输入框、写回 data.answers，但**不判分**', () => {
  const card = body(CARD);
  const at = card.indexOf("node.type === 'short-answer'");
  assert.ok(at >= 0, '找不到主观题那一块');
  const block = card.slice(at, at + 1200);
  // 输入框走**与填空题同一个**组件（`SymbolListInput` 本来就是待选词与标准答案共用的那个）
  assert.ok(block.includes('SymbolListInput'), '主观题没有参考答案输入框');
  // 写回**nested 形状**（内核的纪律：写一律写 nested）
  assert.ok(block.includes('answers: [items]'), '参考答案没有按 nested 形状写回 data.answers');
  // 🔴 反面：主观题**不许**被判分 —— 教师 2026-09-30 明确说「主观题不需要评分」。
  //    这一条钉的是**题型表**（`graded` 是判据，决定抽屉里画不画判分那一行）。
  const types = fs.readFileSync(QTYPES, 'utf8');
  assert.match(
    types, /\{ value: 'short-answer'[^}]*graded: false/,
    '主观题被改成 graded: true 了 —— 教师明确说过它不需要评分',
  );
});

test('★ 排序题：正确顺序与选项顺序**并排**，且右栏不再住在评分卡里', () => {
  const order = body(ORDER);
  assert.ok(order.includes('worksheet-editor-order-columns'), '没有两栏容器');
  assert.ok(order.includes('<OrderAnswerBody'), 'OrderBody 里没有渲染「正确顺序」那一栏');
  // 🔴 反面：评分卡里**不许**再有一份 —— 两处并存 = 教师看到两个「正确顺序」，
  //    而且改一处另一处不动（本仓最防的那种分叉）。
  assert.ok(!body(CARD).includes('<OrderAnswerBody'), '评分卡里还留着一份 OrderAnswerBody');
});

test('★ 两栏在窄屏上下叠（媒体查询真的写了，不是靠默认换行）', () => {
  const css = fs.readFileSync(GLOBALS, 'utf8');
  const at = css.indexOf('.worksheet-editor-order-columns');
  assert.ok(at >= 0, '找不到两栏那一段');
  const block = css.slice(at, at + 900);
  assert.ok(block.includes('display: flex'), '两栏不是 flex');
  // 🔴 **必须只看媒体查询那一段**（从 `@media` 到它的结束 `}`）。
  //    变异检验抓出来的假绿：`flex-direction: column` 在 CSS 里到处都是 ——
  //    紧邻的 `.worksheet-editor-order-answer`（就在这几行之后）里也有一个，
  //    用「附近 900 字符」这种窗口去查会被**邻居规则喂饱** ⇒
  //    把媒体查询里的那一档改成 `row`，断言照样绿。
  const mediaAt = block.indexOf('@media');
  assert.ok(mediaAt >= 0, '那段附近没有媒体查询');
  const media = block.slice(mediaAt, block.indexOf('\n}', mediaAt) + 2);
  assert.ok(media.includes('flex-direction: column'), '窄屏那一档不是叠放');
  assert.match(media, /max-width/, '媒体查询不是按宽度触发的');
  // ⚠️ 它**仍然只是源码级**：真机上窄屏是不是真的叠了，只能由人看。
});
