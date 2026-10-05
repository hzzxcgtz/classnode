import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 卡片上「AI 评分」那一块的源码级网（问答题 / 绘图题），以及填空题那条**逐空**的路。
 *
 * ── 教师 2026-10-05 的三条批注，各对应下面一条断言 ──────────────────────
 *   ①「评分标准与下面的评分要求重复了，你把『评分标准』替换下面的『评分要求』，带图片上传。」
 *   ②「这部分是不是多余了？」（底部那张复述用的「评分说明 / 查看方式」卡）
 *   ③「加减按钮也太小了吧」→ 换成自己的按钮后，又说「点了下面空白地方也会减」
 *
 * ── 为什么这张网是源码级的 ──────────────────────────────────────────────
 * 本仓没有前端测试框架（`node --test` 加载不了 JSX），运行时也验不了
 * 「页面上有几个输入框」「点空白会触发谁」。但这几条防线**都是源码上的事实**，
 * 而它们坏掉的方式全是静默的：
 *   · 「评分标准」必须只有**一个**输入框（合并不是"再加一个"）；
 *   · 写回时必须把旧字段 `aiScoringCriteria` **一并清掉**，否则教师把内容删空后
 *     回退值会重新出现（像「删不掉」，两边都不报错）；
 *   · 底部那张卡不许回来；
 *   · 🔴 **加减按钮不许待在 `<label>` 里** —— `<label>` 的隐式关联对象是它内部
 *     **第一个可标注元素**，而 `<button>` 正是可标注元素 ⇒ 点标签文字或标签里的空白，
 *     浏览器会把点击转发给第一个按钮。教师报的原话就是「点了下面空白地方也会减」。
 * 与 `student-socket-single-source.test.ts` / `worksheet-adornment-color.test.ts` 同一路数。
 *
 * ⚠️ 服务端那一半（同一份标准在提示词里只说一遍、旧字段回退读得出来）在
 * `server/src/tests/analysis-agent.test.ts` 与 `analysis-question.test.ts` 里。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD = path.join(HERE, 'question-card.tsx');
const FILL_BODY = path.join(HERE, 'bodies', 'fill-blanks-body.tsx');
const FILL_MODES = path.resolve(HERE, '../../../../lib/worksheet-fill-modes.ts');

test('🔴 填空题的 AI 评分改由**每一空**的评分方式开启（裁定 B 之后整题那块不服务填空题）', () => {
  // ⚠️ 这一条原先是 ChatGPT 在 `1f107fa` 写的（「普通填空可开启 AI 评分，且与本地自动评分互斥」），
  //    它钉的是**整题 AI 块**里那两条互斥接线。教师 2026-10-05 的裁定 B
  //    （「评分标准已经细化到每一空（如果选了手工填写），不需要整体的评分标准」）之后，
  //    填空题不再有整题那块 ⇒ 断言换了，但**它守的能力一条都没少**：
  //    ① 空白的手工填空仍然能开 AI 评分；② 本地自动评分与 AI 评分仍然互斥（逐空结构上互斥）。
  const source = fs.readFileSync(CARD, 'utf8');

  // 🔴 反面：`supportsAiScoring` 不许再把填空算进来 —— 算进来整题那块（连图片上传）就回来了。
  assert.match(
    source,
    /supportsAiScoring\s*=\s*node\.type === 'short-answer'\s*\|\|\s*node\.type === 'drawing';/,
    '`supportsAiScoring` 又把填空算进去了 —— 填空题的整题 AI 块会跟着回来',
  );

  // ① 能力没丢：手工填写那一档必须能选「AI 评分」（判据层那一条，界面只是消费它）。
  const modes = fs.readFileSync(FILL_MODES, 'utf8');
  assert.match(
    modes,
    /mode === 'text' \? \['auto', 'ai', 'none'\] : \['auto', 'none'\]/,
    '手工填写那一档不能选 AI 评分了 —— 填空题就没有开 AI 评分的路了',
  );
  // 并且逐空的选择必须真的驱动整题那个 AI 开关（否则选了也不生效）。
  const body = fs.readFileSync(FILL_BODY, 'utf8');
  assert.match(body, /aiScoringEnabled: totals\.ai > 0/, '填空题的 AI 开关没有跟着逐空评分方式走');

  // ② 自动评分那一边仍然互斥：重新打开本地自动评分时关掉整题 AI 开关。
  assert.match(
    source,
    /enabled && node\.type === 'fill-blank' && node\.data\.aiScoringEnabled === true[\s\S]*?onDataChange\(\{ aiScoringEnabled: false \}\)/,
    '重新开启本地自动评分时，必须关掉 AI 评分',
  );
});

test('🔴 评分标准与评分要求已合并：只剩一个输入框，编辑时旧字段被清掉', () => {
  const source = fs.readFileSync(CARD, 'utf8');
  // 阳性对照：读到的确实是那张题卡。少了它，路径写错会让下面每条断言**永远绿**。
  assert.match(source, /worksheet-editor-ai-scoring/, '这不是题卡文件（路径读错了？）');

  const labels = source.match(/<span>评分标准<\/span>/g) ?? [];
  assert.equal(labels.length, 1, '「评分标准」只许有**一个**输入框 —— 两个就是要命的那次重复');
  assert.ok(!/<span>评分要求<\/span>/.test(source), '「评分要求」那个输入框已随合并删除，不许回来');

  // 显示侧：老学习单只填过「评分要求」的，教师得看得见原文（回退不许丢）。
  assert.match(source, /value=\{rubricText \|\| aiScoringCriteria\}/, '显示侧要保留旧字段回退');
  // 写回侧：必须同时清掉旧字段，否则「删不掉」。
  // ⚠️ 这里刻意**不用 `/s` 标志**：本仓 tsconfig 的 target 是 es2017，带 `s` 会让
  //    `tsc`（以及 `next build` 的类型检查）报 TS1501 —— 而客户端测试走的是 node 的
  //    类型擦除，看不见这个错。`[^}]` 与 `\s` 本来就能跨行，不需要那个标志。
  assert.match(
    source,
    /onDataChange\(\{\s*rubricText:[^}]*aiScoringCriteria:\s*undefined/,
    '🔴 写回评分标准时必须把旧字段 `aiScoringCriteria` 一并清掉 —— 只写 `rubricText` 的话，'
    + '教师把输入框删空后回退值会重新出现（看起来像「删不掉」），而两边都不会报错。',
  );

  // 底部那张卡：判据用**那句 JSX 字面量**，不是「评分说明」这个词 ——
  // 删掉它的地方留了一段注释讲为什么，用词判据会被自己的注释打红。
  assert.ok(
    !/aiScoringEnabled \? '评分说明' : '查看方式'/.test(source),
    '底部那张「评分说明 / 查看方式」卡已整块删除（教师 2026-10-05）：'
    + '它整段是复述上面两块，唯一别处没有的「不会覆盖教师评价」并进了 AI 评分块的脚注。',
  );
});

test('阳性对照：评分标准的图片上传跟着搬进了 AI 评分块（合并不等于把图丢了）', () => {
  const source = fs.readFileSync(CARD, 'utf8');
  const at = source.indexOf('worksheet-editor-ai-scoring');
  assert.ok(at > 0, '找不到 AI 评分块');
  const block = source.slice(at);
  assert.match(block, /worksheet-editor-rubric-image|worksheet-editor-rubric-upload/, '图片上传入口要跟着搬进来');
  assert.match(block, /uploadRubricImage/, '上传仍是那一个函数（不许另写第二份）');
});

test('🔴 加减按钮不许待在 `<label>` 里 —— 点标签里的空白会被转发给第一个按钮', () => {
  const source = fs.readFileSync(CARD, 'utf8');
  const at = source.indexOf('worksheet-editor-ai-scoring-field"');
  assert.ok(at > 0, '找不到「奖励总量」那一格（类名或结构变了？）');
  // 从那一格的开头，截到步进器收尾（`</div>`）：这段里只应有 label + 步进器。
  const stepperAt = source.indexOf('worksheet-editor-ai-scoring-stepper', at);
  assert.ok(stepperAt > at, '那一格里找不到步进器');
  const block = source.slice(at, source.indexOf('</div>', stepperAt));

  // 标签要用 `htmlFor` **显式**关联输入框，而不是把控件包进去。
  assert.match(block, /htmlFor=/, '标签要用 `htmlFor` 关联输入框');
  assert.match(block, /id=\{`ai-scoring-max-\$\{node\.id\}`\}/, '输入框要有配对的 id（每张卡唯一）');

  // 🔴 判据本体：`<label>` 与 `</label>` 之间**不许**出现 `<button>`。
  // 出现即复现教师那条「点了下面空白地方也会减」—— 点标签文字、点标签里的空白，
  // 浏览器都会把这次点击转发给它内部第一个可标注元素（`<button>` 就是可标注元素）。
  const labelOpen = block.indexOf('<label');
  const labelClose = block.indexOf('</label>', labelOpen);
  assert.ok(labelOpen >= 0 && labelClose > labelOpen, '找不到那个 `<label>`');
  assert.ok(
    !block.slice(labelOpen, labelClose).includes('<button'),
    '🔴 加减按钮不许放进 `<label>`：点标签文字或空白会把点击转发给第一个 `<button>` —— '
    + '教师报的「点了下面空白地方也会减」就是这个。标签只圈文字，用 `htmlFor` 关联输入框。',
  );
});
