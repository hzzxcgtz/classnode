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
/**
 * 画板的**默认分支标注**那一份真源（`DECISION_BRANCH_LABELS`）。
 * ⚠️ 只读**这一个常量**、只为了对「模板里那个标注写法」—— 不去读画板别的实现
 *    （那有它自己的网，见 `drawing-surfaces/surface-lifecycle.test.ts`）。
 */
const CANVAS_FLOWCHART = path.resolve(
  HERE, '../../../classroom/worksheet/questions/drawing-surfaces/flowchart-drawing.tsx',
);

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

  // ② 自动评分与 AI 评分仍然互斥 —— 只是**位置变了**。整题那块随裁定 B 删除之后，
  //    这段接线（原来钉的 `enabled && node.type === 'fill-blank' && …aiScoringEnabled === true`）
  //    在 `question-card.tsx` 里**已经不存在** ⇒ 从那次删除起这条断言就是**永久红**的
  //    （2026-10-05 实测：`git stash` 到 HEAD 也红）。红网比没有网更坏：真回归时没人再看它。
  //    ⇒ 互斥现在由**逐空结构**保证（`bodies/fill-blanks-body.tsx`），断言跟着搬过去，
  //      能力一条都没少：① 选词那两档关掉这一空的 AI；② 选 AI 时把作答方式拉回手工填写。
  assert.match(
    body,
    /mode !== 'text' && setting\.gradingMode === 'ai' \? \{ gradingMode: 'auto' as const \}/,
    '选词那两档没有关掉这一空的 AI 评分 —— 那个组合服务端会拒绝保存',
  );
  assert.match(
    body,
    /gradingMode === 'ai' \? \{ mode: 'text' as const \}/,
    '选「AI 评分」时没有把作答方式拉回「手工填写」',
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
  assert.ok(at > 0, '找不到「分值 / 奖励数量」那一格（类名或结构变了？）');
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

/** 块注释（含 JSX 的 `{/* … *\/}`）与整行 `//` 注释。判据必须落在**活代码**上 —— 注释里写着不算。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 那段要点就是**进提示词的那一句**（教师要求逐字），所以只有它逐字钉；常量名/类名一律不钉。 */
const STRUCTURE_POINTS_TEMPLATE_TEXT =
  '判断框必须有两分出边并标注 是/否；循环必须有一条回到判断框的线；每个框的文字要说清一步操作；流程要有明确的开始与结束。';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('① 结构要点模板：常量在、按钮只服务流程图、点击是**追加**（不是覆盖）', () => {
  // ★ 2026-10-06（教师，信息科技课的流程图作业）：「这个面向中小学信息科技课画标准流程图，
  //   作业常判**结构**而不是画得好不好」⇒ AI 评分那一块给一颗「插入结构要点模板」。
  const code = stripComments(fs.readFileSync(CARD, 'utf8'));
  // 判据一律落在**剥过注释**的活代码上：上面那段说明里逐字写着 `readDrawingTool(node) === 'flowchart'`，
  // 不剥注释的话，把源码里的那个条件删掉，注释会替它把这条断言喂绿。
  assert.match(code, /worksheet-editor-ai-scoring-fields/, '这不是题卡文件（路径读错了？）');

  // ① 命名常量：由**模板文本**反查常量名（改名不影响判据）。
  const decl = code.match(new RegExp(
    `const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*'${escapeRegExp(STRUCTURE_POINTS_TEMPLATE_TEXT)}'`,
  ));
  assert.ok(decl, '结构要点模板常量不见了（或那段文字被改写了）—— 它就是进提示词的那一份');
  const templateName = decl![1];
  const declEnd = decl!.index! + decl![0].length;

  // ② 它必须真的被按钮用上（光有常量 = 教师按不到，文字永远进不了 rubricText）。
  const useAt = code.indexOf(templateName, declEnd);
  assert.ok(useAt > declEnd, '模板常量声明了却没有人用 —— 那颗按钮不见了');

  // ③ 出现条件：收在「作图工具是流程图」那一支里。
  //    🔴 改成恒真（`{true && (` 或删掉这一支）⇒ 数学作图 / 思维导图 / 基础绘图的题也会看到
  //       「判断框要两分出边」这种它们根本没有的结构要求。
  const guardAt = code.lastIndexOf('readDrawingTool', useAt);
  assert.ok(
    guardAt > 0 && useAt - guardAt < 600,
    '这颗按钮没有收在「作图工具」那一支里（改成恒真 / 挪出这一支了？）',
  );
  assert.match(code.slice(guardAt, useAt), /===\s*'flowchart'/, '出现条件不再是「作图工具是流程图」');

  // ④ 点击 ⇒ **追加**（已有内容时前面补一个换行），不是覆盖。
  //    判据：写回值 = 「当前那一份标准」+ `\n` + 模板（`${当前}\n${模板}`）。
  const handler = code.slice(useAt - 320, useAt + 220);
  assert.match(
    handler,
    new RegExp(`\\$\\{[^}]+\\}\\\\n\\$\\{${templateName}\\}`),
    '🔴 模板必须是**追加**：“当前那一份标准” + 换行 + 模板。覆盖式写入会把教师写了一半的那段吞掉。',
  );
  // ⑤ 写回沿用现有那条路：旧字段 `aiScoringCriteria` 一并清掉（不清的话删空后回退值会重新出现）。
  assert.match(
    handler,
    /aiScoringCriteria:\s*undefined/,
    '写回时没有清掉旧字段 `aiScoringCriteria` —— 教师把框删空后那段旧标准会重新出现（像「删不掉」）',
  );
});

/**
 * 上面那条断言把模板钉成**逐字**（教师要求进提示词的就是那一句）—— 这是「文案逐字」的语义，
 * 逐字钉是对的。但**光有逐字钉不住「它与画板说的是同一件事」**：模板、画板默认标注、快照三处
 * 只要有一处单独改（今天就是画板默认从 `Y/N` 改成 `是 / 否`），逐字断言只会跟着一起改，
 * 矛盾照样留在教师与 AI 看见的文案里，而**两边都不报错**（本仓最防的那一类）。
 * ⇒ 这里再加一条**语义**的：模板里那个标注写法必须是**画板真正用的默认标注**，且不许再出现 `Y/N`。
 */
test('★ 结构要点模板里那个标注写法 = 画板的默认分支标注（不许再写 Y/N）', () => {
  const code = stripComments(fs.readFileSync(CARD, 'utf8'));
  // 模板文本从源码里**现读**（不是把常量再抄一遍 —— 抄一份就又成了「各写各的」）。
  const template = (code.match(/const\s+[A-Za-z_$][\w$]*\s*=\s*'([^']*两分出边[^']*)'/) ?? [])[1];
  assert.ok(template, '从题卡源码里读不到结构要点模板那段文字 —— 先修这条判据');

  // 画板的默认分支标注（`DECISION_BRANCH_LABELS = ['是', '否']`）—— 那才是「画板默认」的真源。
  const canvas = stripComments(fs.readFileSync(CANVAS_FLOWCHART, 'utf8'));
  const branchRaw = (canvas.match(/const\s+DECISION_BRANCH_LABELS\s*=\s*\[([^\]]*)\]/) ?? [])[1];
  assert.ok(branchRaw !== undefined, '画板里没有 `DECISION_BRANCH_LABELS` —— 判据的靶子没了');
  const branches = [...branchRaw.matchAll(/'([^']*)'/g)].map((match) => match[1]);
  assert.deepEqual(branches, ['是', '否'], `画板默认分支标注不是「是 / 否」（读到 ${JSON.stringify(branches)}）`);

  const wording = `${branches[0]}/${branches[1]}`; // 「是/否」
  assert.ok(template.includes(`标注 ${wording}`),
    `结构要点模板里的标注写法与画板默认（${wording}）对不上 —— 学生照模板写，画板给的是另一样，两边都不报错`);
  assert.ok(!/Y\s*\/\s*N/i.test(template),
    '结构要点模板里还写着 `Y/N`（画板默认已经是「是 / 否」—— 文案与画板自相矛盾）');
});
