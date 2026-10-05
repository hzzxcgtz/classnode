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
    /<span className="worksheet-editor-block-label">正确顺序<\/span>\s*\n\s*\{correctOrder\.length === 0 \? \(/,
    '「正确顺序」标签后面又插了一整段说明 —— 那正是把右栏的行推下去的 ~52px',
  );
});

test('★ 那两句说明搬进了卡片顶部那句话里（不许丢）', () => {
  // 「学生看不到这个顺序；它是判分的依据」是**必须留着**的信息 ——
  // 它是教师判断「我改的这一栏会不会影响学生」的唯一依据。
  // ⚠️ 断言用的是**活代码**（剥过注释）：写进注释里不算数。
  const card = body(CARD);
  assert.ok(card.includes('学生看不到'), '「学生看不到」这句丢了');
  assert.ok(card.includes('判分'), '「判分的依据」这句丢了');
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

test('★ 填空题设过逐空评分方式后**不显示**逐题「自动评分」开关（裁定 A）', () => {
  // 教师 2026-10-05 问「这个开关到底控制什么」→ 查实它对填空题**已经不通电**
  //（服务端 `grade()` 见到逐空设置就走逐空那条分支，不看 `node.autoGrade`；
  //  而看板/矩阵/抽屉仍然看它 ⇒ 会出现「库里有分、教师卡上写着教师查看」）。
  // ⇒ 裁定 A：设过逐空评分方式之后不画这个开关；卡片保留为**逐空设置的合计**。
  const card = body(CARD);
  assert.match(card, /\{!explicitFillScoring && <HeadSwitch/, '开关没有挂在「未设逐空评分方式」这个条件上');
  assert.match(
    card,
    /\{\(gradedOn \|\| explicitFillScoring\) && \(<>/,
    '卡片内容还挂在 gradedOn 上 —— 开关都没了，autoGrade 可能是旧值（新题默认 false），内容会整块消失',
  );
  assert.match(
    card,
    /\(gradedOn \|\| explicitFillScoring\) && <span className="worksheet-editor-points-badge"/,
    '徽章条件没跟着改（无开关时那张卡会连「最高 N」都没有）',
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

  assert.match(body(CARD), /正确答案点选项右侧的圆点/, '卡片上的提示仍写着「左侧」');
  assert.match(choice, /请点击选项右侧的圆点/, '「尚未设置正确答案」那句仍写着「左侧」');
  assert.match(choice, /请勾选选项右侧的方框/, '多选那句仍写着「左侧」');

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
