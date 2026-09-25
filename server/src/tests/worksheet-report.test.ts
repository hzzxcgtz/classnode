/**
 * `worksheet-report.ts` 的逐条断言 —— M6a 报告**判据层**的唯一回归网。
 *
 * 跑法（服务端那一个 runner 只吃编译产物）：
 *
 * ```bash
 * pnpm build:server && node --test server/dist/tests/worksheet-report.test.js
 * ```
 *
 * ⚠️ 这些全是纯函数，**不需要临时库**。而报告真正出问题的地方（Word 打不打得开、笔迹图
 * 画得像不像）本机一条都验不了 —— 那些在 `specs/2026-09-25-m6a-acceptance.md` 里。
 *
 * 本文件管的是另一半：**纸上那句话与库里那份是不是同一件事**。那一条错了不报错，
 * 只会让教师读到一份**读起来对**的假报告。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_TEXT,
  answerCell,
  formatDuration,
  gradeLabel,
  unmappedParticipantsNotice,
  webappUsageColumnLabels,
  webappUsageLineKeys,
} from '../services/worksheet-report.js';

/* ── 1. 🔴 评分三态必须走 gradeState ─────────────────────────────────── */

test('🔴 评分三态：correct ⇒ 对、partial ⇒ 半对、incorrect ⇒ 错、null ⇒ 未判分', () => {
  assert.equal(gradeLabel({ isCorrect: true, gradeState: 'correct' }), '对');
  assert.equal(gradeLabel({ isCorrect: false, gradeState: 'partial' }), '半对');
  assert.equal(gradeLabel({ isCorrect: false, gradeState: 'incorrect' }), '错');
  assert.equal(gradeLabel({ isCorrect: null, gradeState: null }), '未判分');
});

test('★ 反证：只读 isCorrect（不管 gradeState）⇒ 半对会被印成错', () => {
  // 这就是那个更自然、也更错的写法。`isCorrect: false` **同时**覆盖「错」与「半对」（规格 §12）。
  const onlyIsCorrect = (row: { isCorrect: boolean | null }) =>
    row.isCorrect === true ? '对' : row.isCorrect === false ? '错' : '未判分';
  assert.equal(onlyIsCorrect({ isCorrect: false }), '错');
  assert.equal(gradeLabel({ isCorrect: false, gradeState: 'partial' }), '半对');
  assert.notEqual(onlyIsCorrect({ isCorrect: false }), gradeLabel({ isCorrect: false, gradeState: 'partial' }));
  // 阳性对照：三态里「对」在两种写法下**恰好相同** —— 别把这条反证读成「凡 false 都特殊」。
  assert.equal(onlyIsCorrect({ isCorrect: true }), gradeLabel({ isCorrect: true, gradeState: 'correct' }));
});

test('gradeState 认不出 / 缺失时回落到 isCorrect（旧行没有 gradeState）', () => {
  assert.equal(gradeLabel({ isCorrect: true, gradeState: null }), '对');
  assert.equal(gradeLabel({ isCorrect: false, gradeState: null }), '错');
  assert.equal(gradeLabel({ isCorrect: false, gradeState: 'nobody-knows' }), '错');
  assert.equal(gradeLabel({ isCorrect: null, gradeState: 'correct' }), '对', 'gradeState 在就信它');
});

/* ── 2. 🔴 「未作答」与「答了但清空」不是一回事 ─────────────────────── */

test('🔴 answerCell：value 为 null ⇒ 被清空；undefined ⇒ 未作答（两句不同的话）', () => {
  assert.deepEqual(answerCell(null), { kind: 'cleared' });
  assert.deepEqual(answerCell(undefined), { kind: 'unanswered' });
  assert.notEqual(REPORT_TEXT.cleared, REPORT_TEXT.unanswered, '两种情形在纸上必须是两句话');
});

/* ── 3. 八种作答值形状 ───────────────────────────────────────────────── */

test('answerCell：文字类的五种各渲染成人话', () => {
  assert.deepEqual(answerCell({ format: 'choice/v1', selected: ['B'] }), { kind: 'text', text: 'B' });
  assert.deepEqual(answerCell({ format: 'choice/v1', selected: ['A', 'C'] }), { kind: 'text', text: 'A、C' });
  assert.deepEqual(answerCell({ format: 'fill/v1', text: 'H2O' }), { kind: 'text', text: 'H2O' });
  assert.deepEqual(answerCell({ format: 'fill-multi/v1', texts: ['甲', '乙'] }), { kind: 'text', text: '甲 / 乙' });
  assert.deepEqual(answerCell({ format: 'text/v1', text: '因为光合作用' }), { kind: 'text', text: '因为光合作用' });
});

test('🔴 排序 / 连线 / 归类：**不许**说成「未作答」，也不许印裸 id', () => {
  // 独立审查发现（本批之外，但决定本函数怎么写）：教师抽屉的 `formatAnswer`
  // 只认 `text` / `fill` 两族 ⇒ 这三种作答值在抽屉里回 `null` ⇒ 屏幕显示「未作答」。
  // **报告不许把这个缺陷抄到纸上。** 但它们的值里存的是 **id**（`i3` / `l1` / `box2`），
  // 对教师不可读 ⇒ 印一句**指向性说明**，等一个真正的 id→标签解析器（那是另一批的活）。
  //
  // ⊘ **2026-09-25 更正**：**抽屉那一侧已经修好了**（同一批）—— 它现在读得出这三种。
  // 但本用例**照旧全绿、且仍然该绿**：报告这一侧给一句指向性说明是**教师本人裁定**的
  // （服务端不能 import `src/`，跟上要写第二份 id→文本解析器）。⇒ 现在两边**故意不一致**，
  // 不是「报告落后了」。要改这个判定，先决定那份解析器住在哪。
  for (const value of [
    { format: 'order/v1', order: ['i3', 'i1'] },
    { format: 'match/v1', links: [{ leftId: 'l1', rightId: 'r2' }] },
    { format: 'categorize/v1', assignment: { a: 'box1' } },
  ]) {
    const cell = answerCell(value);
    assert.equal(cell.kind, 'text', `${value.format} 应当有话说`);
    const text = cell.kind === 'text' ? cell.text : '';
    assert.notEqual(text, REPORT_TEXT.unanswered, `${value.format} 是**答过**的，不许说未作答`);
    assert.match(text, /请在系统中查看/, `${value.format} 应当指向系统，而不是印 id`);
    assert.doesNotMatch(text, /i3|l1|box1/, `${value.format} 不许把裸 id 印上去`);
  }
});

test('answerCell：笔迹原样交给渲染层（不在这一层画图）', () => {
  const ink = { format: 'ink/v1', canvas: { w: 300, h: 200 }, strokes: [{ color: '#000', width: 0.1, points: [[0.5, 0.5]] }] };
  assert.deepEqual(answerCell(ink), { kind: 'ink', ink });
});

test('🔴 answerCell 认不出的形状**不抛**，收成一句「读不出来」', () => {
  // 抛出去的后果是**整份导出失败**，而教师看到的是「导出失败」四个字 ——
  // 一道手工改过的题可以让一整节课的报告导不出来。
  for (const bad of [7, 'x', [], {}, { format: 'nobody-knows' }, { format: 'choice/v1' }]) {
    const cell = answerCell(bad);
    assert.equal(cell.kind, 'text', `${JSON.stringify(bad)} 应当收成文字`);
  }
  // 空白文字作答按「答了但内容是空」处理 —— 与「没有那一行」不同（那条走 undefined）。
  // ⚠️ 这一条是**刻意的**：原样带回、不在这一层 `trim()` 后判空，否则「答了空字符串」
  //    与「未作答」会并成一句话，而那两件事的成因完全不同。
  assert.deepEqual(answerCell({ format: 'text/v1', text: '   ' }), { kind: 'text', text: '   ' });
});

/* ── 4. 🔴 探究空间那一节：不印恒为 0 的列（GC 31）──────────────────── */

test('🔴 webappUsageLineKeys：只有有数据的两列，四列恒 0 的**一个都不许在**', () => {
  // `WebappUsage` 表里仍有 `clicks` / `inputs` / `maxDepth` / `reports`，而
  // `recordWebappSummary` 早就不再写它们 ⇒ **值恒为 0**。印出去就是印四列 0。
  assert.deepEqual([...webappUsageLineKeys()].sort(), ['durationMs', 'frameCount', 'participantName', 'webappName']);
  for (const forbidden of ['clicks', 'inputs', 'maxDepth', 'reports']) {
    assert.ok(!webappUsageLineKeys().includes(forbidden), `${forbidden} 恒为 0，不许出现在表里`);
  }
  assert.match(REPORT_TEXT.webappNoteMissingCounters, /暂不可得/);
  // ★ 渲染层调的**就是**这个表头（独立审查抓到过：清单原先一个调用点都没有）。
  assert.deepEqual(webappUsageColumnLabels(), ['网页', '参与者', '时长', '帧数']);
  assert.equal(webappUsageColumnLabels().length, webappUsageLineKeys().length, '加了列却没给表头');
});

/* ── 5. 报告里那几句固定的话（规格 §3.5）───────────────────────────── */

test('★ REPORT_TEXT：所有固定文案互不相同（两句一样 = 两种情形在纸上分不开）', () => {
  const values = Object.values(REPORT_TEXT);
  assert.equal(new Set(values).size, values.length, `有重复：${JSON.stringify(values)}`);
  assert.match(REPORT_TEXT.noWorksheet, /未使用学习单/);
  assert.match(REPORT_TEXT.noWebapp, /未使用探究空间/);
  assert.match(REPORT_TEXT.inkFallback, /手写作答/);
  assert.match(REPORT_TEXT.unreadable, /读不出来/);
});

test('unmappedParticipantsNotice：高级模式下「某组没配学习单」的那句附注', () => {
  assert.match(unmappedParticipantsNotice(3), /3/);
  assert.match(unmappedParticipantsNotice(3), /没有可作答的学习单/);
  assert.notEqual(unmappedParticipantsNotice(1), unmappedParticipantsNotice(2));
});

/* ── 6. 时长文案 ─────────────────────────────────────────────────────── */

test('formatDuration：分秒可读，0 与不足一秒各有各的话', () => {
  assert.equal(formatDuration(0), '0 秒');
  assert.equal(formatDuration(900), '不足 1 秒');
  assert.equal(formatDuration(200_000), '3 分 20 秒');
  assert.equal(formatDuration(7_200_000), '2 小时 0 分');
});
