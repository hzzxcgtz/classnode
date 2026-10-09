import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 「正在发的那一条」要在作答链路上**留痕**，否则「清空」那一支会把它当成「从没发出去过」摘掉。
 *
 * 🔴 起因（2026-10-09 审计 §B4b，补 §B4 的网时撞出来的）：`flush` 是
 * 「取队首**快照** → `await putAnswer` → 出队」，**在途这段时间里那条仍在队列里**。
 * 学生这时把这一题删干净：`buildAnswerValue` 回 `null`、而 `lastSentRef` 里**还没有**这一题
 * ⇒ `setDraft` 走到「空的、且从没发出去过」那一支 ⇒ `dropQuestionFromQueue` 把在途的那一条
 * **一起摘掉**。可那个 PUT 照样落库 ⇒ 屏幕上是空的、库里有内容、而**队列里没有任何一条
 * 会去纠正它**（那张「看得见的那份 ≠ 交上去的那份」又反过来了）。
 *
 * 修法：`flush` 在 `await` 前把这一条记进 `inFlightRef`、`await` 后清掉；`setDraft` 那一支
 * 把「在途」作为**判据的一项**（判据本体是纯函数 `emptyEditAction`，见 `worksheet-queue.ts`）。
 *
 * ⚠️ **本文件证明的是接线**（本仓没有 jsdom，`use-worksheet-answers.ts` 引 React，跑不了）：
 * 它只回答「判据有没有被**喂到**在途这一项」。真正的行为要人工验：
 * **慢网下答一题、趁保存还在路上把它删干净 ⇒ 屏幕上空、服务端也要被清空**。
 *
 * 🔴 为什么这条网必须存在：判据抽成纯函数之后，**没人喂 `inFlight` 它就永远是 `false`** ——
 * 那一半测试全绿、bug 原样回来（本仓栽过「判据被断言 ≠ 判据被使用」，见 `false-green` 系列）。
 *
 * ```bash
 * node --test src/app/classroom/worksheet/answer-inflight-wiring.test.ts
 * ```
 */

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = stripComments(fs.readFileSync(path.join(HERE, 'use-worksheet-answers.ts'), 'utf8'));

/** 从 `from` 切到它之后第一次出现的 `to`（两个锚点都得是**代码**，注释已经被剥掉了）。 */
function slice(from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `锚点失效：找不到 ${from} —— 先修用例`);
  const end = source.indexOf(to, start);
  assert.notEqual(end, -1, `锚点失效：${from} 之后找不到 ${to} —— 先修用例`);
  return source.slice(start, end);
}

test('🔴 「正在发的那一条」要留痕：记号落在 `await` 之前、清理落在它之后', () => {
  const flush = slice('const flush = useCallback', 'const timerRef');
  const awaitAt = flush.indexOf('await putAnswer');
  assert.notEqual(awaitAt, -1, 'flush 里找不到 await putAnswer —— 先修用例');

  const mark = flush.indexOf('inFlightRef.current = next');
  const clear = flush.indexOf('inFlightRef.current = null');
  assert.notEqual(mark, -1, '发出去的那一条没有留痕 ⇒ 「清空」会把它当成从没发过、直接摘掉，而它照样落库');
  assert.notEqual(clear, -1, '发完没清 ⇒ 之后每一次空编辑都被当成「在途」，为从没存过的题发出一串「清空」');
  assert.ok(mark < awaitAt, '记号必须在 await **之前**（之后记的是「已经回来」，那正是这个 bug 的前提）');
  assert.ok(clear > awaitAt, '清理必须在 await **之后**（提前清 ⇒ 在途那一段仍然没有留痕）');
});

test('🔴 `setDraft` 的空编辑那一支要走共用的判据，并把「在途」喂进去', () => {
  const setDraft = slice('const setDraft = useCallback', 'useEffect(() => {');
  assert.match(setDraft, /emptyEditAction\(/,
    '那一支没有走共用判据 ⇒ 它仍会把在途的那一条当成「从没发出去过」摘掉');
  assert.match(setDraft, /inFlightRef\.current/,
    '判据的入参里没有「在途」这一项 ⇒ 它永远收不到 true，等于没修');
});
