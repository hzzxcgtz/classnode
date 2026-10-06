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
const CHOICE = fs.readFileSync(path.join(HERE, 'bodies', 'choice-options.tsx'), 'utf8');
const MATCH = fs.readFileSync(path.join(HERE, 'bodies', 'match-body.tsx'), 'utf8');
const CATEGORIZE = fs.readFileSync(path.join(HERE, 'bodies', 'categorize-body.tsx'), 'utf8');
const FILL = fs.readFileSync(path.join(HERE, 'bodies', 'fill-blanks-body.tsx'), 'utf8');
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
  // 这里要从真正渲染参考答案的 JSX 条件开始找。题卡顶部还有
  // `supportsAiScoring` 的题型判定，只找第一个 `short-answer` 会截错代码块。
  const at = card.indexOf("{(node.type === 'short-answer' || node.type === 'drawing') && (");
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

test('★ 排序题：正确顺序与选项顺序**并排**，且右栏不再住在评分卡里', () => {  const order = body(ORDER);
  assert.ok(order.includes('worksheet-editor-order-columns'), '没有两栏容器');
  assert.ok(order.includes('<OrderAnswerBody'), 'OrderBody 里没有渲染「正确顺序」那一栏');
  // 🔴 反面：评分卡里**不许**再有一份 —— 两处并存 = 教师看到两个「正确顺序」，
  //    而且改一处另一处不动（本仓最防的那种分叉）。
  assert.ok(!body(CARD).includes('<OrderAnswerBody'), '评分卡里还留着一份 OrderAnswerBody');
});

test('★ 两栏在窄屏上下叠（媒体查询真的写了，不是靠默认换行）', () => {
  const css = fs.readFileSync(GLOBALS, 'utf8');
  // 🔴 **按「哪条媒体查询管这两栏」找，不按字符窗口找**。
  //    原来这里是 `css.slice(at, at + 900)` —— 一个**固定长度的窗口**：
  //    只要在这段 CSS 附近多写几行注释，`@media` 就被挤出窗口，
  //    症状是这条用例**红**（还算好）；更糟的是窗口里正好有**邻居规则**时它会**绿**
  //    （这文件里已经为同类假绿改过一次：旁边 `.worksheet-editor-order-answer` 的
  //     `flex-direction: column` 曾经把这个窗口喂饱，把媒体查询里那一档改成 `row` 照样绿）。
  //    ⇒ 现在直接在**媒体查询块**里找，窗口长度不再参与判据。
  const mediaBlocks = [...css.matchAll(/@media[^{]*\{[\s\S]*?\n\}/g)].map((m) => m[0]);
  const mine = mediaBlocks.filter((block) => block.includes('.worksheet-editor-order-columns'));
  assert.equal(mine.length, 1, `管这两栏的媒体查询应当只有一条，实际 ${mine.length} 条`);
  const media = mine[0];
  assert.ok(media.includes('flex-direction: column'), '窄屏那一档不是叠放');
  assert.match(media, /max-width/, '媒体查询不是按宽度触发的');
  // ⚠️ 它**仍然只是源码级**：真机上窄屏是不是真的叠了，只能由人看。
});

test('★ 右栏的标题要和左栏**同一个类**（换行标签，不是 h4 + 一段说明）', () => {
  const order = body(ORDER);
  assert.ok(order.includes('export function OrderAnswerBody'), '找不到 OrderAnswerBody');
  // 🔴 **两栏各一个**、且是**同一个类**。⚠️ 数个数而不是分别切两段：
  //    `OrderBody` 在文件里排在 `OrderAnswerBody` **之后**，按位置切很容易切反
  //    （第一版就切反了，报的是「左栏的标题类变了」）。
  const labels = order.match(/worksheet-editor-block-label/g) ?? [];
  assert.equal(labels.length, 2, `两栏的标题应当各是一个单行标签，实际找到 ${labels.length} 个`);
  // 🔴 反面：`<h4>` + 一整段 `<p>` 正是把右栏的行推下去 ~52px 的东西。
  assert.ok(!order.includes('<h4>'), '这一栏里还挂着一个 h4 —— 那正是「错位」的来源');
  // ⚠️ 只挡 `<h4>` 是不够的（变异检验抓出来的洞）：**只挂一段 `<p>` 同样会把行推下去**。
  //    而这一栏里 `worksheet-editor-hint` / `worksheet-editor-warn-hint` 那两段 `<p>`
  //    是**条件渲染**的（只在空态 / 对不上时出现），不能一概禁掉。
  //    ⇒ 判据是**位置**：「正确顺序」那个标签后面必须**紧接着**列表/空态那一句。
  assert.match(
    order,
    /<span className="worksheet-editor-block-label"><EditorIcon[^>]*\/>正确顺序<\/span>\s*\n\s*\{correctOrder\.length === 0 \? \(/,
    '「正确顺序」标签后面又插了一整段说明 —— 那正是把右栏的行推下去的 ~52px',
  );
});

test('🔴 「加一行 / 新建题」的输入框都必须有**灰色占位提示**（数据层留空之后，那一格只剩它可看）', () => {
  // ★ 2026-10-05（教师）：「编辑题目时，这些类似的输入框，默认只给灰色的提示文字，
  //   鼠标点击后可以让用户直接输入自己的文字。」
  // 🔴 数据层已经把这些格子的文字改成空串（`createEmptyQuestion` / `matchAddLeft` …）。
  //    ⇒ **placeholder 成了那一格唯一能看见的东西**：它一旦丢掉（改名、漏写、被顺手删掉），
  //      教师看到的是一排**什么都没有的空框**，而构建、类型、既有用例全绿。
  //    ⚠️ 这是 `editor-classes.test.ts`（守「类名有没有样式」）的同一族：**屏幕上少了一样东西**，
  //      而没有任何东西会红 ⇒ 只能靠源码级的网钉住。
  // ⚠️ 断言用的是**剥过 import/注释**的活代码（写在注释里不算数）。
  assert.match(body(MATCH), /placeholder=\{`左项 \$\{index \+ 1\}`\}/, '连线题左项那一格没有灰色提示');
  assert.match(body(MATCH), /placeholder=\{`右项 \$\{index \+ 1\}`\}/, '连线题右项那一格没有灰色提示');
  assert.match(body(ORDER), /placeholder=\{`条目 \$\{index \+ 1\}`\}/, '排序题条目那一格没有灰色提示');
  assert.match(body(CATEGORIZE), /placeholder=\{`框 \$\{index \+ 1\}`\}/, '归类题的框名那一格没有灰色提示');
  assert.match(body(CATEGORIZE), /placeholder=\{`条目 \$\{index \+ 1\}`\}/, '归类题的条目那一格没有灰色提示');
  assert.match(body(CHOICE), /placeholder=\{`选项 \$\{option\.key\}`\}/, '选项那一格没有灰色提示');
  // 填空题的答案 / 评分标准 / 选词那几格（同一个 `SymbolListInput`）。
  for (const hint of ['本空的答案', '这一空的评分标准', '例如：唐、宋、元', '例如：阳光、水分、空气']) {
    assert.ok(body(FILL).includes(hint), `填空题少了一处灰色提示：${hint}`);
  }
});

test('★ 排序题用栏标题区分学生顺序与正确顺序', () => {
  // 两栏的语义由紧邻内容的标题直接表达，不再额外常驻一段说明。
  const order = body(ORDER);
  assert.ok(order.includes('学生看到'), '左栏没有点明学生看到的顺序');
  assert.ok(order.includes('正确顺序'), '右栏没有点明正确顺序');
  assert.ok(!body(CARD).includes('学生看不到'), '排序题又恢复了重复长说明');
});

test('★ 两栏的行高统一（不然每行再差一点，四行下来照样歪）', () => {
  const css = fs.readFileSync(GLOBALS, 'utf8');
  const at = css.indexOf('.worksheet-editor-order-edit-row,\n.worksheet-editor-order-row {');
  assert.ok(at >= 0, '找不到两栏共用的那条行样式');
  const block = css.slice(at, css.indexOf('}', at));
  // 🔴 少了它：左行的高度由里头的 `<input>` 决定、右行由 28px 的箭头按钮决定
  //    ⇒ 两栏的行高天生不同，而屏幕上只是「看着歪」，没有任何报错。
  assert.ok(block.includes('min-height'), '两栏的行没有统一的最小高度（左行跟着输入框、右行跟着按钮）');
});

test('🔴 并排的两栏必须**按权重压过**「上下两块之间的分隔线」那条通用规则', () => {
  // ★ 2026-09-30（教师）：「还是不对」→「你看」。真凶**不在这一屏的代码里**：
  //
  //   .worksheet-editor-block + .worksheet-editor-block {
  //     margin-top: 16px; padding-top: 16px; border-top: 1px solid #eef2f6;
  //   }
  //
  //   它本意是给**上下叠着**的两块之间加分隔线。而右栏恰好是左栏的**相邻兄弟**
  //   ⇒ `+` 选得中它 ⇒ 右栏被推下去 32px、头上还多一条横线。
  //
  // 🔴 **只查「有没有那三行」是不够的 —— 我第一版就栽在这里**：
  //    我把它挂在 `…-order-columns > *`（**一个**类）上，而通用规则是**两个**类
  //    ⇒ 通用规则永远赢，补丁**压根没生效**，而这条用例照样绿。
  //    ⇒ 现在下面同时断言**内容**与**权重**。
  const css = fs.readFileSync(GLOBALS, 'utf8');
  const SEL = '.worksheet-editor-order-columns > .worksheet-editor-block + .worksheet-editor-block';
  const at = css.indexOf(SEL);
  assert.ok(at >= 0, '找不到针对右栏的那条重置（选择器得写全，`> *` 压不过通用规则）');
  const block = css.slice(at, css.indexOf('}', at));
  assert.match(block, /margin-top:\s*0/, '右栏仍会被推下去 16px');
  assert.match(block, /padding-top:\s*0/, '还要再推 16px');
  assert.match(block, /border-top:\s*none/, '还会在右栏头上画一条横线');
  // 🔴 **权重**：通用规则是「两个类」，这条必须**至少三个类**才压得过它。
  const classes = (SEL.match(/\.[a-zA-Z-]+/g) ?? []).length;
  assert.ok(classes >= 3, `这条重置只有 ${classes} 个类选择器，压不过通用规则的两个类`);
});

test('🔴 填空题**没有**「得分方式 + 分值」这两行了（教师 2026-10-05 最终裁定：删掉）', () => {
  // 教师原话：「我觉得应该删掉，因为现在总开关只需要负责是否自动评分（含 AI 评分），
  // 打开后每题单独设置单独给分，**已经不涉及按整题给的问题**。」
  //
  // 🔴 这一条是**能力**上的反面断言，不是「这行字没了」：
  //    它的坏法是把整题口径的开关又接回填空题 —— 于是同一道填空题同时有两个分值来源
  //    （题目级 `points` 与逐空 `maxScore`），屏幕上两个数不一致而两边都不报错。
  const card = body(CARD);
  // 那两行的调用点必须且只能出现在 `node.type === 'choice-blank'` 那一支里。
  const methodAt = card.indexOf('<FillScoringMethodRow');
  const pointsAt = card.indexOf('<FillPointsRow');
  assert.ok(methodAt > 0 && pointsAt > methodAt, '两行本身还在（它们仍服务选择填空）');
  const gate = card.lastIndexOf("node.type === 'choice-blank' && (", methodAt);
  assert.ok(gate > 0 && methodAt - gate < 120, '这两行没有收在选择填空那一支里 —— 填空题又会有整题口径的开关');
  // ⚠️ 填空题**不能**再出现这一行（它由 `FillScoringMethodRow` 画；★ 2026-10-06 起
  //    行首标签与逐空那一排同名，都叫「评分方式」）。
  assert.ok(
    !/worksheet-editor-flat-label">评分方式/.test(card.slice(0, gate)),
    '填空题那一块里又出现了整题口径的「评分方式」行',
  );
  // 「本题满分」徽章仍要在（它现在取逐空合计）。
  assert.match(card, /本题满分/, '满分徽章被一起删掉了 —— 那道题在屏幕上就没有分数了');
  // 两个大卡与内层卡片（「每空得分」）都不许回来（它们就是被删掉的那两层卡中卡）。
  assert.ok(!/worksheet-editor-scoring-options/.test(card), '「得分方式」又用回了两个大卡');
  assert.ok(!card.includes('每空得分'), '内层卡片那个标题又回来了（它就是"卡中卡"那一层）');
});

test('★ 选择填空仍留着「得分方式 + 分值」是**一块两行**（判分口径还没收口到逐空）', () => {
  // ★ 2026-10-05（教师）：「这里一层套一层有点怪啊，更看不懂了。」
  // 原来是三层：卡 →「得分方式」（标题+说明+两个大卡）→「得分规则」（标题+说明+内层卡片），
  // 而且两处还说同一件事。裁定：并成一块两行。
  // 🔴 这一块**只服务选择填空**了 —— 判分的逐空那一支服务端写死了 `fill-blank`，
  //    删了它选择填空就一个分值入口都没有。
  const card = body(CARD);
  const methodAt = card.indexOf('<FillScoringMethodRow');
  const pointsAt = card.indexOf('<FillPointsRow');
  assert.ok(methodAt > 0, '找不到「得分方式」那一行');
  assert.ok(pointsAt > methodAt, '「分值」那一行不在「得分方式」之后（顺序变了？）');

  // 🔴 两者之间不许再出现**块级容器** —— 出现就是又拆成两块（多一条分隔线、多一层卡）。
  assert.ok(
    !/worksheet-editor-block/.test(card.slice(methodAt, pointsAt)),
    '两行之间又插了一个块容器 —— 「一块两行」被拆回两块了',
  );
  // 平铺行那两个类必须用上（样式另有 `editor-classes` 那张网守着"有没有定义"）。
  // ⚠️ 类名断言一律带词边界：本仓已经栽过三次「加个后缀前缀还在 ⇒ 断言是瞎的」
  //    （`includes('.x')` 对 `.xXX` 照样绿）。`editor-classes.test.ts` 另有一张网守"类名有没有定义"。
  assert.match(card, /\bworksheet-editor-flat-row\b/, '没有用平铺行');
  assert.match(card, /\bworksheet-editor-flat-label\b/, '行首那个小标签不见了');
});

test('★ 填空题的「自动评分」始终是逐空评分的总开关', () => {
  const card = body(CARD);
  assert.doesNotMatch(card, /\{!explicitFillScoring && <HeadSwitch/, '逐空评分仍在隐藏总开关');
  assert.match(card, /<HeadSwitch\s+checked=\{gradedOn\}/, '自动评分总开关没有直接绑定题目级状态');
  assert.match(
    card,
    /\{gradedOn && \(<>/,
    '评分设置没有受总开关控制',
  );
  assert.match(
    card,
    /\{gradedOn && <span className="worksheet-editor-points-badge"/,
    '满分徽章没有受总开关控制',
  );
});

test('★ 选项行：答案设置（圆点/勾选框）在**行尾**，字母留在行首，文案跟着说「右侧」', () => {
  // ★ 2026-10-05（教师）：「答案的设置统一移动到最右侧」。
  // 这一条钉两件事，它们坏掉的方式**不一样**：
  //   ① 控件位置 —— 坏的后果是「与其它题型又不一致了」（看得见，但不一定有人报）；
  //   ② 提示文案 —— 🔴 **控件挪回左边而文案还说「右侧」，屏幕上就是一句谎话**，
  //      且没有任何东西会红。所以位置与文案必须一起断言。
  const choice = body(CHOICE);
  const contentAt = choice.indexOf('worksheet-editor-option-content');
  const answerAt = choice.indexOf('worksheet-editor-option-answer');
  assert.ok(contentAt > 0, '选项行里找不到选项文字那一块');
  assert.ok(answerAt > 0, '选项行里找不到答案控件');
  assert.ok(answerAt > contentAt, '答案控件又跑回选项文字前面了 —— 教师要求「统一移动到最右侧」');

  // 行首那个字母盒不能丢：关掉自动评分时它是唯一能区分四个选项的东西。
  assert.ok(choice.includes('worksheet-editor-option-correct is-readonly'), '行首的字母盒（A/B/C/D）不见了');

  assert.match(body(CARD), /点右侧圆点设置答案/, '卡片上的提示没有点明行尾答案控件');
  // ★ 2026-10-06：「点右侧圆点 / 方框」这件事**只由卡片那句讲一次**（同一屏里不说两遍）——
  //    警告条现在只留结论。
  assert.match(choice, /尚未设置正确答案/, '警告条丢了结论');
  assert.ok(!choice.includes('请点击选项右侧的圆点'), '警告条又把「点右侧圆点」讲了一遍');
  assert.ok(!choice.includes('请勾选选项右侧的方框'), '警告条又把「勾右侧方框」讲了一遍');

  // 选中态由 React 算类名 —— `:has(input:checked)` 在 globals.css 里被兼容闸门禁用。
  assert.match(choice, /' is-on' : ''/, '选中态类名不见了');

  const css = fs.readFileSync(GLOBALS, 'utf8');
  assert.ok(css.includes('.worksheet-editor-option-answer.is-on'), 'CSS 里没有选中态那一条（整块不会亮）');

  // ★ 同日第二条：「大小要一致」—— 右边三个盒（答案 / 配图 / 删除）必须是**同一个 28×28**。
  //   三个数写在三条不同的规则里 ⇒ 只改其中一个，屏幕上就是「有一个大了一圈」，
  //   而 tsc / eslint / 构建一个都不会红 ⇒ 三个都要钉。
  const boxOf = (selector: string, span = 400) => {
    const at = css.indexOf(selector);
    assert.ok(at >= 0, `CSS 里找不到 ${selector}`);
    return css.slice(at, at + span);
  };
  assert.match(boxOf('.worksheet-editor-option-answer {'), /width:\s*28px;[\s\S]*?height:\s*28px;/, '答案盒不是 28×28');
  assert.match(boxOf('.worksheet-editor-icon-button {', 300), /width:\s*28px;[\s\S]*?height:\s*28px;/, '删除按钮不是 28×28');
  assert.match(
    boxOf('.worksheet-editor-option-image-action label,', 700),
    /width:\s*28px;[\s\S]*?height:\s*28px;/,
    '配图按钮不是 28×28（它是 padding 撑出来的，最容易漂）',
  );

  // ★ 同日第三条：「答案选择的上面要有提示文字」。
  assert.match(choice, /worksheet-editor-options-head-label/, '答案列上方的表头不见了');
  assert.match(choice, />正确答案</, '表头文字要写「正确答案」');
  // 🔴 表头**只占右边三列**：靠一条 `flex: 1` 的空白把它顶到与行内同一列。
  //    少了那条空白（或它丢了 `flex: 1`），表头就会跟左边（把手 / 字母 / 选项文字）对齐
  //    而不是跟答案那一列 —— 看着「就差一点」却没有任何东西会红；而左边宽度随内容变，抄不出来。
  //    ⚠️ 这条断言原来只 `includes('.…-head-gap')`：**变异检验当场证伪** —— 把类名改成
  //       `…-head-gapXX`，那个 `includes` 照样绿（前缀还在）。所以现在查**声明**，
  //       并且 TSX 与 CSS 两边都要在（只留一边 = 要么表头不顶到右边、要么这条规则是死的）。
  assert.match(choice, /\bworksheet-editor-options-head-gap\b/, 'TSX 里没有那条表头空白');
  const gapCss = css.slice(css.indexOf('.worksheet-editor-options-head-gap'));
  assert.match(
    gapCss.slice(0, 200),
    /flex:\s*1/,
    '表头那条空白丢了 `flex: 1` —— 表头会跟左边对齐，而不是跟答案那一列',
  );
});

test('★ 2026-10-06（教师）：判断题的正确答案块摆在**题干后面**（不再压在最下面）', () => {
  const live = stripImports(stripComments(CARD));
  // ⚠️ 判据用**这一块的标题**，不要用 `node.type === 'true-false'`：那个条件在卡片靠上处
  //    （摘要/只读预览那条路）也出现过，第一次出现的位置比题干还早 ⇒ 拿它当判据会假红。
  const stem = live.search(/<h4><EditorIcon[^>]*\/>题干<\/h4>/);
  const answer = live.search(/<h4><EditorIcon[^>]*\/>正确答案<\/h4>/);
  assert.ok(stem !== -1 && answer !== -1, '题干或判断题的正确答案块不见了');
  assert.ok(answer > stem, '判断题的正确答案没有排在题干之后');
  // 而且必须在**判分设置**之前 —— 不许又被挪回最下面。
  // ⚠️ 同样别用「AI 评分」当判据：它在卡片靠上处的题型说明里也出现过。
  const grader = live.indexOf('评分方式');
  assert.ok(grader !== -1 && answer < grader, '判断题的正确答案又跑到判分设置后面去了');
  // 搬动最怕留下两份：两份都会渲染、都不报错。
  assert.equal((live.match(/<h4><EditorIcon[^>]*\/>正确答案<\/h4>/g) ?? []).length, 1, '「正确答案」块不止一处');
});

/** 从 `{` 起**配平大括号**取出整段。⚠️ 不用固定长度窗口：加几行注释就会把它挤出窗口
 *  （绿得冤枉或红得冤枉 —— 本文件已经为一类固定窗口改过一次，见「两栏窄屏」那一条）。 */
function braceBlock(code: string, openAt: number): string {
  let depth = 0;
  for (let i = openAt; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(openAt, i + 1);
    }
  }
  return '';
}

test('② `QUESTION_EDITOR_COPY` 里的五种死文案已删，兜底仍在（含反面对照）', () => {
  // ★ 2026-10-06：这张表**唯一**的读取点是 `answerBlock` 的兜底那一支，而
  //   single-choice / multi-choice / true-false / fill-blank / choice-blank 五种题型
  //   在 `answerBlock` 里**各自先被分派了标题**（on the way 到不了兜底）——
  //   那五条于是永远渲染不到，是「屏幕上不存在的一段文案」。
  const code = body(CARD);
  const declAt = code.indexOf('QUESTION_EDITOR_COPY');
  assert.ok(declAt > 0, '找不到 QUESTION_EDITOR_COPY（这不是题卡文件？）');
  const eqAt = code.indexOf('= {', declAt);
  assert.ok(eqAt > declAt, '找不到那张表的对象字面量');
  const table = braceBlock(code, eqAt + 2);
  assert.ok(table.length > 100, '取出来的表是空的 —— 下面两条会对空串假绿');

  // 阳性对照：今天**真的**会走兜底那五种题型的标题必须还在
  // （⚠️ 这五个键都不带连字符，源码里是不加引号的 `order:` ⇒ 两种写法都要认）。
  for (const key of ['order', 'match', 'categorize', 'short-answer', 'drawing']) {
    assert.match(table, new RegExp(`'?${key}'?:`), `兜底要用的 ${key} 那一行不见了`);
  }
  // 🔴 反面：这五种题型各有自己的分支 ⇒ 副本必须删掉（留着 = 一段永远到不了的文案）。
  for (const key of ['single-choice', 'multi-choice', 'true-false', 'fill-blank', 'choice-blank']) {
    assert.ok(
      !new RegExp(`'${key}':`).test(table),
      `${key} 的副本又回来了 —— 它永远渲染不到（唯一读取点是 answerBlock 那一支兜底）`,
    );
  }
  // 兜底的另一半：类型收成 `Partial`（索引签名不再谎报「一定取得到」），读取点自己给一份。
  assert.match(code, /QUESTION_EDITOR_COPY\s*:\s*Partial</, '这张表没有收成 Partial');
  assert.match(
    code,
    /\?\?\s*\{\s*title:\s*'[^']*',\s*description:\s*''\s*,?\s*\}/,
    '🔴 读取点的兜底不见了 —— 删掉那五条之后，走到兜底那一支的题型会渲染出**空标题**',
  );

  // 🔴 删得掉的前提（反面对照）：`answerBlock` 先给那五种题型分派了各自的标题；
  //    这三支少一支，删掉的那几条就会真的变成「没有标题」。
  const answerAt = code.indexOf('const answerBlock');
  assert.ok(answerAt > 0, '找不到 answerBlock');
  const answer = code.slice(answerAt, code.indexOf('const shownPoints', answerAt));
  assert.match(answer, /\bnull\b/, '判断题那一支（答案是 null）不见了');
  assert.match(answer, /'选项'/, '选择题那一支（标题「选项」）不见了');
  assert.match(answer, /isBlankType/, '填空类那一支（标题「填空设置」）不见了');
});

test('③ 选项文字也接了「粘贴去格式」：onPaste 接管 + onBlur 再收一次（不碰 onChange）', () => {
  // ★ 2026-10-06（教师）：「这里复制进来的文本，格式要去掉」—— 与题目卡「评分标准」那个
  //   textarea **同一种接法**（`normalizePastedText`，`onPaste` 接管 + `onBlur` 再收一次）。
  const choice = body(CHOICE);
  const at = choice.indexOf('worksheet-editor-option-content');
  assert.ok(at > 0, '找不到选项文字那一块');
  const inputAt = choice.indexOf('<input', at);
  assert.ok(inputAt > at, '选项文字那一格不是 `<input>`（换控件了？）');
  const input = choice.slice(inputAt, choice.indexOf('/>', inputAt));
  assert.match(input, /placeholder=\{`选项 \$\{option\.key\}`\}/, '这一格不是「选项文字」那一格（读错地方了？）');

  assert.match(input, /onPaste=\{/, '选项那一格没有接管粘贴');
  assert.match(input, /onBlur=\{/, '选项那一格没有在失焦时再收一次');
  assert.match(choice, /normalizePastedText/, '选项那一格没有走那个纯函数（自己写一套去格式 = 第二份真源）');

  // 🔴 反面：打字那条路（`onChange`）不许被这次改动碰 —— 老师每敲一个字符都被归一化是不可接受的。
  assert.match(input, /onChange=\{/, '`onChange` 不见了 —— 打字那条路被弄坏了');
  assert.ok(
    !/onChange=\{[\s\S]*normalizePastedText/.test(input),
    '`onChange` 里夹带了归一化 —— 会打扰老师打字（本次只接 onPaste + onBlur）',
  );
});
