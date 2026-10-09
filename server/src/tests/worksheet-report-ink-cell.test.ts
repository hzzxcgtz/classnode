import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inkHasContent, type InkValue } from '../services/ink-path.js';
import { answerCellRender } from '../services/export-service.js';
import { REPORT_TEXT } from '../services/worksheet-report.js';

/**
 * ★ 2026-10-09 审计：**「只写了字」的笔迹作答在报告里丢失，且纸上印一句假话**。
 *
 * 机制（同一件事两份判据，只修了其中一份）：
 *   · **渲染层** `ink-render.ts` 的 `inkToPng` ★ 2026-09-30 第二轮已改成
 *     「笔画**和**文字都空才回 `null`」⇒ 只写了字的作答**会正常出图**。
 *   · **报表层** `export-service.ts` 的答案格判据**还是旧的**「只看 `strokes`」
 *     ⇒ 命中在先，印出「（这一题没有笔画）」并把刚渲染好的 PNG **丢掉**。
 *
 * 实测（真实函数、真实执行，不是推断）：
 *   `inkToPng({strokes:[],texts:[一句]})` → 2432 字节的 PNG，
 *   而报表层的旧判据同时判定「没有笔画」。
 *
 * 修法：把「有没有内容」抽成**一条**判据 `inkHasContent`（`ink-path.ts`），
 * 渲染层与报表层**都**用它 —— 两边从此不可能再分叉。
 */

const canvas = { w: 800, h: 600 };
/** 只写了字的笔迹：一根笔画都没有。⚠️ `InkPoint` 是 `[number, number]` 元组，不是 `{x,y}`。 */
const textOnly: InkValue = {
  format: 'ink/v1', canvas, strokes: [],
  texts: [{ text: '光合作用需要光', at: [0.1, 0.1], color: '#111111', size: 0.06 }],
};
/** 真的一笔一字都没有。 */
const empty: InkValue = { format: 'ink/v1', canvas, strokes: [], texts: [] };
const withStroke: InkValue = {
  format: 'ink/v1', canvas,
  strokes: [{ color: '#111111', width: 0.01, points: [[0.1, 0.1], [0.2, 0.2]] }],
  texts: [],
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// ---------------------------------------------------------------------------
// ① 判据本身
// ---------------------------------------------------------------------------

test('inkHasContent：只有字算有内容（这一条就是那个 bug 的根）', () => {
  assert.equal(inkHasContent(textOnly), true, '只写了字 —— 有内容');
  assert.equal(inkHasContent(withStroke), true, '有笔画 —— 有内容');
  assert.equal(inkHasContent(empty), false, '一笔一字都没有 —— 才是真没有');
  assert.equal(
    inkHasContent({ format: 'ink/v1', canvas, strokes: [] }),
    false,
    '`texts` 整个缺失（老数据）也要能判，不许抛',
  );
});

// ---------------------------------------------------------------------------
// ② 报表那一格：只写了字 ⇒ 给图，绝不印「没有笔画」
// ---------------------------------------------------------------------------

test('★ 只写了字的笔迹：报表那一格给图（从前这里是「（这一题没有笔画）」）', () => {
  const render = answerCellRender({ kind: 'ink', ink: textOnly }, PNG);
  assert.equal(render.kind, 'image', '渲染层出了图，报表层就必须用它');
  assert.equal(render.kind === 'image' && render.png, PNG);
});

test('★ 只写了字、而图确实渲染不出来（png=null）⇒ 说「渲染不出来」，不许说「没有笔画」', () => {
  const render = answerCellRender({ kind: 'ink', ink: textOnly }, null);
  assert.equal(render.kind, 'message');
  assert.notEqual(
    render.kind === 'message' && render.text, REPORT_TEXT.inkEmpty,
    '有内容却印「没有笔画」是**假话**；这时该说的是「本机渲染不出来」',
  );
  assert.equal(render.kind === 'message' && render.text, REPORT_TEXT.inkFallback);
});

test('阴性对照：真的一笔一字都没有 ⇒ 这才是「（这一题没有笔画）」', () => {
  const render = answerCellRender({ kind: 'ink', ink: empty }, null);
  assert.equal(render.kind === 'message' && render.text, REPORT_TEXT.inkEmpty);
});

test('阴性对照：有笔画的笔迹照旧给图（修法不许把这一档弄坏）', () => {
  const render = answerCellRender({ kind: 'ink', ink: withStroke }, PNG);
  assert.equal(render.kind, 'image');
});

// ---------------------------------------------------------------------------
// ③ 其余四档照旧（这几档本来就对，钉住它们是为了证明我只改了该改的那一条）
// ---------------------------------------------------------------------------

test('阴性对照：text / cleared / unanswered 三档的话没变', () => {
  const text = answerCellRender({ kind: 'text', text: '水是 H2O' }, null);
  assert.equal(text.kind === 'text' && text.text, '水是 H2O');
  const cleared = answerCellRender({ kind: 'cleared' }, null);
  assert.equal(cleared.kind === 'message' && cleared.text, REPORT_TEXT.cleared);
  const unanswered = answerCellRender({ kind: 'unanswered' }, null);
  assert.equal(unanswered.kind === 'message' && unanswered.text, REPORT_TEXT.unanswered);
});

test('image 格：有图给图，图读不出来说「读不出来」', () => {
  const ok = answerCellRender({ kind: 'image', url: '/uploads/chat/chat-1.png' }, PNG);
  assert.equal(ok.kind, 'image');
  const missing = answerCellRender({ kind: 'image', url: '/uploads/chat/chat-1.png' }, null);
  assert.equal(missing.kind === 'message' && missing.text, REPORT_TEXT.imageFallback);
});
