/**
 * ★ 2026-09-30（教师第三轮）：单行「符号分隔列表」输入框的**两条纪律**。
 *
 * 教师原话：「几个选词之间的分隔符是怎么回事？几个地方要统一下，用户在输入的时候可以用
 * 各种常见的分隔符号，**你多想几个，都是支持的**，也**不用刻意地转成某一个特别的符号**。」
 *
 * 🔴 本仓没有 jsdom、没有浏览器 ⇒「打字的时候那个逗号会不会被吃掉」在本机**验不了**。
 *    这一条网能回答的只有：**那两行代码在不在、用的是哪个判据**。
 *    ⚠️ 真机走查要看的：在「标准答案」里打 `阳光,水分`，**别失焦、别停**，
 *       看那个逗号是不是留着的（改之前它会在失焦的瞬间变成顿号）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BODY = fs.readFileSync(path.join(HERE, 'fill-blanks-body.tsx'), 'utf8');
const CARD = fs.readFileSync(path.join(HERE, '..', 'question-card.tsx'), 'utf8');
// ⚠️ 本文件在 `bodies/` 里，比 `edit/` 深一级 ⇒ 少一个 `app/` 段（`../../../../globals.css` = src/app/globals.css）。
const GLOBALS = path.resolve(HERE, '../../../../globals.css');
// ⚠️ 跨工程读服务端那一份校验（本仓有先例：`analysis-gate-parity.test.ts` / `worksheet-heading-parity.test.ts`）。
// ⚠️ 层级要数清（本文件在 `bodies/` 里，比 `edit/` 深一级）：
//    bodies → edit → worksheets → teacher → app → src → 仓根，所以是**六个** `..`。
//    （同一个坑我在这个文件里踩了两次：先是 GLOBALS 少一层，再是这一行少一层。）
const SERVER_QUESTIONS = path.resolve(HERE, '../../../../../../server/src/services/worksheet-questions.ts');

/** 块注释（含 JSX 的 `{/* … *\/}`）与整行 `//` 注释。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 连 `import` 行也剥掉（那些名字**本来就出现在 import 里**，不剥的话删掉调用点照样绿）。 */
function stripImports(source: string): string {
  return source.split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
}

const body = (source: string) => stripImports(stripComments(source));

test('★ 输入框**不再**把教师打的符号规范化掉（教师原话：不用刻意转成某一个特别的符号）', () => {
  const source = body(BODY);
  // 阳性对照：剥完之后剩下的仍是这个组件，不是一段空壳（否则下面几句对空串永远绿）。
  assert.ok(source.length > 1000, '剥 import 与注释之后剩下的仍是这个文件');
  // 🔴 反面：`onBlur` 那次「规范化」不许回来。它原来干的是
  //    `setDraft(split(draft).join(joinWith))` —— 教师打 `阳光,水分`、一失焦就变
  //    `阳光、水分`，而屏幕上看起来像是输入法在捣乱。
  //    ⚠️ 这个写法**看起来很像一次无害的清理**，所以必须有一条网拦着。
  assert.ok(!source.includes('onBlur'), 'onBlur 又回来了 —— 那会把教师刚打的符号改掉');
  // 🔴 回填的判据必须是 `sameChoiceItems`（逐项相等），**不是**拼成字符串再比：
  //    后者会把「他打逗号、外面用顿号拼」当成两个不同的值 ⇒ 当场改掉他的稿子，
  //    而那正是本次要修掉的毛病。
  assert.ok(source.includes('sameChoiceItems('), '回填没有用 sameChoiceItems 判「是不是同一个列表」');
  assert.ok(!/join\(CHOICE_JOINER\)\s*===\s*values\.join/.test(source),
    '回填的判据退化成了「拼出来的字符串相等」—— 那正是本次修掉的那个毛病');
  // 显示那一侧仍然要用**统一**的那个常量（四处一处都不许再自己传）。
  assert.ok(source.includes('CHOICE_JOINER'), '显示没有用统一的那个分隔符常量');
});

test('★ 那个「显示分隔符」的 prop 已经拆了（四处统一成一个常量）', () => {
  // 🔴 教师原话：「几个地方要统一下」。`joinWith` 这个 prop 在的时候，四个调用点
  //    各传一个（` / ` / `；` / `、` / `、`），而主观题「参考答案」那处的占位语写的是
  //    顿号、值却用斜杠显示 —— 自己跟自己就不一致。
  //    ⇒ 拆掉这个 prop 就是「统一」本身：**编译期**就不允许再各传各的。
  assert.ok(!body(BODY).includes('joinWith'), '`joinWith` 这个 prop 又回来了（那就有地方能各传各的）');
  assert.ok(!body(CARD).includes('joinWith'), '调用点又在自己传显示分隔符');
});

test('★ 编辑卡不再重复解释选词分隔符', () => {
  // 分隔符的实际解析仍由 fill-blanks-body 中的单一常量负责；
  // 编辑卡不再常驻一段「顿号、逗号、分号」说明，避免把操作界面撑长。
  const card = body(CARD);
  assert.ok(!card.includes('CHOICE_SEPARATOR_HINT'), '编辑卡又引入了长分隔符提示');
  assert.ok(!card.includes('顿号、逗号'), '还有一处把分隔符**写死**在提示语里');
});

test('★ 填空题的答案住在每张空卡片里，并受题目级自动评分总开关控制', () => {
  const bodySrc = body(BODY);
  const card = body(CARD);

  assert.match(bodySrc, /\bworksheet-editor-fill-answer-field\b/, '空卡片里没有答案格');
  assert.match(bodySrc, /writeFillAnswers\(/, '答案没有按原来那个 nested 形状写回（存储形状一个字都不该变）');
  assert.match(bodySrc, /\{gradingEnabled && <div className="worksheet-editor-fill-answer-field">/, '答案行没有受总开关控制');
  // ★ 2026-10-09：「评分方式」那一排随两档一起删了，总开关现在管的是**作答方式 + 答案**两行。
  assert.ok(!/worksheet-editor-fill-grading-row/.test(bodySrc), '「评分方式」那一排又回来了');

  // 🔴 反面：题目卡里那个「标准答案」网格**不许回来** —— 同一份答案两个编辑入口就是分叉，
  //    而且那一块住在 `{gradedOn && …}` 里（只有打开自动评分才看得见），
  //    而每个空都能选「AI 评分」，那种情况恰恰最需要改答案。
  assert.ok(!card.includes('FillBlanksBody'), '「标准答案」那块又回来了 —— 答案会有两个编辑入口');
  assert.ok(!card.includes('每个空可以填多个可接受答案'), '那句说明被抄回题目卡了（应当在空卡片下方那一处）');
  // 题目卡上的统一说明仍由总开关区域承担，不再在各空下方重复。
  assert.match(
    card,
    /!gradedOn && isGradedQuestionType\(node\.type\) && !isBlankType/,
    '填空题又被算进额外的答案隐藏提示，页面会重复说明总开关状态',
  );
});

test('★ 逐空设置是**两行**：作答方式 → 答案，分值带学习单奖励单位', () => {
  // ★ 2026-10-09（教师裁定）：中间那一行「评分方式」随 AI / 不算分两档一起删了
  //（只剩一档的选择器是装饰）。顺序仍是「先选怎么答、再写答案」。
  const bodySrc = body(BODY);
  const modeAt = bodySrc.indexOf('worksheet-editor-fill-mode-head');
  const answerAt = bodySrc.indexOf('worksheet-editor-fill-answer-field');
  const scoreAt = bodySrc.indexOf('worksheet-editor-fill-answer-score');

  assert.ok(modeAt >= 0 && answerAt > modeAt, '两行的渲染顺序不对');
  assert.ok(scoreAt > answerAt, '分值输入必须挨着答案行，不能另起一行');
  assert.match(bodySrc, /pointsUnit === '分' \? '分值' : '奖励数量'/, '分数档与图标奖励档没有使用合适的名称');
  assert.match(bodySrc, /<b>\{pointsUnit\}<\/b>/, '分值输入框后没有显示「分 / 座奖杯」等单位');
});

test('★ 只剩一排胶囊：作答方式（分段胶囊）；评分方式那一排连同它的样式一起删了', () => {
  // ★ 2026-10-09（教师裁定）：填空题只剩「每空有答案键、都算分」一条路 ⇒ 那一排单选没有
  //    存在的理由。★ 2026-10-05 那版是为了与作答方式**区分**才给它做了描边胶囊变体；
  //    现在整排删掉，那段 CSS 也一并删 —— 留着就是一段没有任何消费者的样式
  //   （`.worksheet-editor-mode-tabs.is-scoring-pills`，本类名的定义只服务过这一处）。
  const bodySrc = body(BODY);

  assert.equal(
    (bodySrc.match(/className="worksheet-editor-mode-tabs"/g) ?? []).length, 1,
    '作答方式那一排应当仍是**独占**药丸样式的那一个',
  );
  assert.ok(!/is-scoring-pills/.test(bodySrc), '评分方式那一排回来了（它只剩一档，是装饰）');

  // ⚠️ 判据读**声明**、不读「文本里出现过这个词」：globals.css 里留了一句注释记着这段
  //    样式为什么被删（本仓的规矩），不剥注释的话那句话会替死样式把这条断言喂红。
  const css = stripComments(fs.readFileSync(GLOBALS, 'utf8'));
  assert.ok(!/\.worksheet-editor-mode-tabs\.is-scoring-pills\s*\{/.test(css),
    '那段描边胶囊的样式已经没有消费者了，删掉它');
});

test('★ 服务端那条「请填写标准答案」不再点名任何一档（逐空只剩一档，点名就是在指空气）', () => {
  // 这一条的历史：★ 2026-10-05 教师把逐空那一档从「自动评分」改名成「本地评分」，
  // 而服务端有一条**会拒绝保存**的校验里也点着那一档的名字 ⇒ 两处必须同一个词。
  // ★ 2026-10-09（教师裁定）：那两档一起删了 ⇒ **屏幕上不再有任何一档的名字**，
  // 报错里也就不该再点名（否则又是指着一个不存在的东西）。
  // ⚠️ 剥注释：那边留了一句注释记着「从前点名的是『本地评分』」（本仓的规矩），
  //    不剥的话那句话会替真正的文案把这条断言喂红。
  const server = stripComments(fs.readFileSync(SERVER_QUESTIONS, 'utf8'));
  assert.match(server, /填空题第 \$\{index \+ 1\} 空请填写标准答案/, '服务端那条报错不见了或改了形状');
  assert.ok(!server.includes('本地评分'), '服务端还在点名「本地评分」那一档');
  assert.ok(!server.includes('AI 评分'), '服务端还在点名「AI 评分」那一档');
  assert.ok(!body(BODY).includes('本地评分'), '界面上还有「本地评分」这个名字');
});

test('★ 填空题**没有**整题 AI 块（裁定 B）：标准只在每一空，整块只服务问答 / 绘图', () => {
  // ★ 2026-10-05（教师裁定 B）：「评分标准已经细化到每一空（如果选了手工填写），不需要整体的
  // 评分标准。……为了简化，填空题的评分标准不需要上传图片。」
  // ⇒ 上一版（裁定 A）把这块缩成「AI 评分标准」还留着；教师看到之后否掉了整块。
  const card = body(CARD);

  // 🔴 ★ 2026-10-09：判据搬进了 `lib/worksheet-questions.ts` 的 `supportsAiScoring`
  //    （题卡与教师看板共用一份），所以这里钉**调用点**、判据本体在 `worksheet-questions.test.ts`
  //    （那一条逐题型断言填空题不在里面）。两边任一被改回去，必有一条红。
  assert.match(card, /supportsAiScoring\(node\)/, '题卡没有走共用的题型判据');
  assert.match(card, /\{aiSupported && \(/, 'AI 那一块没有按题型判据收口');
  // 那一块里不许再出现「按题型分叉」的痕迹（它现在只服务问答 / 绘图，一个分叉都没有）。
  assert.ok(!card.includes("'AI 评分标准'"), '「AI 评分标准」那个分叉标题又回来了');

  // 但整块的开关 / 满额 / 评分标准对**问答与绘图**必须还在 —— 那是它们唯一的入口。
  assert.match(card, /worksheet-editor-ai-scoring-stepper/, '问答 / 绘图那个满额步进器丢了');
  assert.match(card, /worksheet-editor-rubric-upload/, '问答 / 绘图的评分标准图片上传丢了');
});

test('★ 评分方式那一排由**作答方式**决定（手工填写三项 / 选词两项），答案标签跟着变', () => {
  // ★ 2026-10-05（教师）：「手工填写含三项评分方式，……右侧或下方选词则只有自动评分或不评分。
  // 手工填写……答案应该叫『评分标准』，右侧或下方选词则……答案就叫答案。」
  const bodySrc = body(BODY);

  // ★ 2026-10-09（教师裁定）：「填空题简化 ⇒ 删 `'ai'` 与 `'none'` 两档，一律『每空有答案键、
  //    都算分』。」⇒ **那一排单选整个没有了**（只剩一档的选择器是装饰），答案格恒叫「答案」。
  // 🔴 判据落在**活代码**上（`bodySrc` 已经剥过注释）：把那一排加回来，这条立刻红。
  assert.ok(!/fillGradingModesFor/.test(bodySrc), '评分方式那一排又回来了 —— 只剩一档的选择器是装饰');
  assert.ok(!/setGradingMode/.test(bodySrc), '评分方式的 setter 还在');
  assert.ok(!/FILL_GRADING_LABELS/.test(bodySrc), '「本地评分 / AI 评分 / 不算分」那三个标签还在');
  assert.match(bodySrc, /<span>答案<\/span>/, '答案格的标签恒是「答案」（不再有「评分标准」那一档）');
  assert.ok(!/评分标准/.test(bodySrc), '「评分标准」那一档已经删了 —— 填空题只剩答案键');

  // 老数据里 `gradingMode: 'ai' / 'none'` 的空必须**逐空提示教师改**（教师裁定的原话），
  // 而不是静默地把它们当一个普通空画出来 —— 否则教师看不出这一空为什么不计分。
  assert.match(bodySrc, /isLegacyFillGrading\(/, '历史上那两个评分方式没有任何提示，教师看不出它为什么不计分');
});

test('★ 「分值」那一格只在**真的有人读它**的地方画（选择填空上那一格是死控件）', () => {
  // ★ 2026-10-05（教师）：「在填空题里，这两个选项是不是就不需要了？」
  // ⇒ 顺着这句话翻出两处**屏幕上与判分不是同一个数**的地方，这是第一处：
  //   判分只有填空题走逐空那一支（服务端写死了 `node.type === 'fill-blank'`，
  //   AI 评分同样只认填空题）⇒ 选择填空的空卡片上那一格填进去**没有任何人读**，
  //   它的成绩仍按题目级「得分方式 + 分值」发。
  const bodySrc = body(BODY);
  assert.match(bodySrc, /const perBlankScoreShown = node\.type === 'fill-blank'/, '那一格又没有按题型收口');
  // ★ 2026-10-09：`&& gradingModeOf(...) !== 'none'` 那半随「不算分」那一档一起删了 ——
  //    今天每个空都算分（有答案键才存得下），所以「分值」跟着 `perBlankScoreShown` 走就够。
  assert.match(
    bodySrc,
    /\{perBlankScoreShown && \(/,
    '「分值」那一格没有受 perBlankScoreShown 控制',
  );
  // 🔴 收口的依据是**服务端那一行**：它一改，界面的这条判据就失效（两处必须同一个口径）。
  const server = fs.readFileSync(SERVER_QUESTIONS, 'utf8');
  assert.match(
    server,
    /const mixedFill = node\.type === 'fill-blank' \? explicitFillGrading\(data\) : \[\];/,
    '服务端的逐空判分不再限定填空题 —— 界面的收口依据跟着失效',
  );
  // ★ 2026-10-09：AI 评分那条路**没有填空题分支了**（逐空 AI 档已删）——
  //    所以「逐空那一套只服务填空题」这条收口，今天只剩服务端判分那一处依据。
  // ⚠️ 剥注释再判（那边的注释里逐字写着 `fillParts` 这个被删掉的名字，不剥会自己把自己扫红）。
  const serverScoring = stripComments(fs.readFileSync(path.resolve(HERE, '../../../../../../server/src/services/analysis-scoring.ts'), 'utf8'));
  assert.ok(!/fillParts/.test(serverScoring),
    'AI 评分里又出现了填空题的分支 —— 逐空 AI 那一档已经删了（教师 2026-10-09 裁定）');
});

test('★ 旧口径下「分值」显示的是**生效的那个数**，不是写死的 1', () => {
  // ★ 2026-10-05：第二处。旧口径（按空给分）下服务端算的是 `命中空数 × 题目级满分`
  //    ⇒ 每一空的生效值就是**题目级分值**，而屏幕上一直写着 1（题级 3 分时屏幕在说谎）。
  const bodySrc = body(BODY);
  assert.ok(!bodySrc.includes('maxScore ?? 1'), '那一格又写死显示 1 了（实际按题目级分值发分）');
  assert.match(bodySrc, /value=\{settings\[index\]\.maxScore \?\? ''\}/, '「留空 = 跟随」没有落到输入框上');
  assert.match(bodySrc, /placeholder=\{String\(inheritScore\)\}/, '灰字提示的不是那个生效值');
  assert.match(
    bodySrc,
    /const inheritScore = fullPoints > 0 \? fullPoints : 1;/,
    '缺省值不是「题目级分值」（`worksheet-points-migration.ts` 纪律 1：写它当时实际用的那个数）',
  );
  // 🔴 接管逐空评分那一步也**不许**把分值静默改成 1（同一件事的写入侧）。
  assert.match(bodySrc, /maxScore: setting\.maxScore \?\? inheritScore/, '接管时又会把分值静默改成 1');
});

test('★「每个空 X × N 空」那句只在**旧口径**下说（接管逐空之后由逐空构成说明 + 徽章说）', () => {
  // 接管之后每个空的分值可能各不相同，这句话还按题目级分值报一个合计数 ⇒
  // 同一张卡里会出现两个互相打架的数。
  // ★ 2026-10-06：逐空那一侧的总数复述（原来那句「本题合计 N 分：…」）已删 ——
  //    总数由题目卡右上角那个「本题满分」徽章说，构成说明只说本地 / AI 各占多少。
  const bodySrc = body(BODY);
  assert.match(
    bodySrc,
    /\{!explicitGrading && node\.data\.fillScoring === 'per-blank' && fullPoints > 0 && \(/,
    '「逐空给分…全对最多」没有随逐空设置一起收起',
  );
});

test('🔴 旧口径「整题给分」的老题：照实说明 + 一个**明确的**转换按钮（不替教师猜一个数）', () => {
  // ★ 2026-10-05（教师裁定）：「总开关只需要负责是否自动评分……已经不涉及按整题给的问题」。
  // 那两个选项已从界面上删掉，但库里还躺着 `fillScoring: 'whole'` 的老题 —— 它们**仍然按
  // 「全对才给一份分」在给学生发分**。这里钉的是处置方式：
  //   · **不猜**（`worksheet-points-migration.ts` 纪律 1）：不替教师把整题那一份分摊到每个空上
  //     —— 摊成几份就凭空改了整题的分，而屏幕上没有任何东西会红；
  //   · 转化必须由教师按一下按钮**明确**触发，且按钮上写的是「改成逐空给分」。
  const bodySrc = body(BODY);
  assert.match(bodySrc, /\{node\.type === 'fill-blank' && !explicitGrading && node\.data\.fillScoring !== 'per-blank' && \(/, '旧口径「整题给分」那一句没有判据（且必须挡住选择填空 —— 它的整题给分是今天合法的口径）');
  assert.match(bodySrc, /worksheet-editor-fill-legacy-note/, '那一句没有用上带按钮的那个类');
  assert.match(bodySrc, /所有空都答对才得 \{inheritScore\}/, '那句话没有说清旧口径是什么');
  assert.match(
    bodySrc,
    /onClick=\{\(\) => updateSettings\(explicitSettings\(\)\)\}/,
    '转换按钮没有走 `explicitSettings()`（那才是把逐空分值一次写全的那一处）',
  );
  assert.match(bodySrc, />\s*改成逐空给分\s*</, '按钮文案变了 —— 它得说清按下去会发生什么');
  // ⚠️ 转换写进去的必须是 `inheritScore`（题目级分值），不是 1 —— 与上面那条同一件事的写入侧。
  assert.match(bodySrc, /maxScore: setting\.maxScore \?\? inheritScore/, '转换会把分值写成 1');
});

test('★ 「共用选词」在所有空设置的**下面**（单列），且逐空那一档叫「本地评分」', () => {
  // ★ 2026-10-05（教师）：「共用选词还是移到所有空的设置的下面。」
 //    它同一天早些时候被移到了**右列**（与填空清单左右分栏），教师看过之后改了主意：
  //    词池是整道题共用的一份，摆右侧会让人以为它只属于最上面那一空。
  const css = fs.readFileSync(GLOBALS, 'utf8');
  const at = css.indexOf('.worksheet-editor-choice-blank-setup {');
  assert.ok(at > 0, 'CSS 里找不到填空设置那个容器');
  assert.match(
    css.slice(at, at + 320),
    /grid-template-columns:\s*minmax\(0, 1fr\)/,
    '容器不是单列 —— 「共用选词」会回到右列（教师刚说不要那样）',
  );

  // ★ 2026-10-09（教师裁定）：逐空那一档只剩一档，**三个标签整张表都删了** ——
  //    没有任何地方还需要「本地评分 / AI 评分 / 不评分」这三个词。
  const bodySrc = body(BODY);
  assert.ok(!/FILL_GRADING_LABELS/.test(bodySrc), '评分方式那三个标签又回来了');
  assert.ok(!/'本地评分'/.test(bodySrc), '逐空那一档的标签还在（只剩一档，不再需要）');
});

test('③ 每空答案 / 参考答案共用的那个列表输入已接「粘贴去格式」（**只接 onPaste**）', () => {
  // ★ 2026-10-06（教师）：「这里复制进来的文本，格式要去掉」—— 与题目卡里「评分标准」那个
  //   textarea 的 `onPaste` **同一种接法**（`normalizePastedText`，纯函数）。
  //
  // 🔴 这一格是**多处共用**的那一个单行列表输入（主观题参考答案 / 参考要点、每一空的答案与
  //    评分标准、待选词、共用选词）⇒ 接线接在组件上，几处一起拿到同一个行为。
  // 🔴 **只接 `onPaste`**：本文件里 `onBlur` 被上面第一条既有判据整个禁掉（教师 2026-09-30
  //    要求「不用刻意地转成某一个特别的符号」）；而对这个列表输入，失焦再收一次本来也没有
  //    第二份东西可收 —— `data` 里存的从来就是 `split` 解析好的词表，排版从没进过数据。
  const source = body(BODY);
  const fnAt = source.indexOf('export function SymbolListInput');
  assert.ok(fnAt > 0, '找不到那个单行列表输入组件');
  const nextFnAt = source.indexOf('export function ', fnAt + 10);
  const fn = source.slice(fnAt, nextFnAt > 0 ? nextFnAt : undefined);
  assert.ok(fn.length > 200, '切出来的组件区域是空的 —— 下面几条会对空串假绿');

  const inputAt = fn.indexOf('<input');
  assert.ok(inputAt > 0, '组件里那个单行输入不见了');
  const input = fn.slice(inputAt, fn.indexOf('/>', inputAt));
  assert.match(input, /onPaste=\{/, '这一格没有接管粘贴 —— 从 Word 粘进来的排版会留在答案里');
  assert.match(fn, /normalizePastedText/, '没有走那个纯函数（自己写一套去格式 = 第二份真源）');
  // 粘贴是**接管**（`preventDefault` + 自己写回），不是「先让浏览器粘进去再清理」——
  // 少了它，屏幕上会闪一下脏文本，而且那一下会占掉一格撤销栈。
  assert.match(fn, /event\.preventDefault\(\)/, '`onPaste` 没有接管（`preventDefault`）—— 会「先脏后清」闪一下');
  // 🔴 制表符 / 换行是 `split` 认的分隔符，而 `normalizePastedText` 会把制表符换成**空格**
  //    （空格不是分隔符）⇒ 必须先换成显示分隔符再去格式，否则从表格里粘一列词会粘成**一个词**。
  assert.match(
    fn,
    /\[\\t\\r\\n\]\+/,
    '粘贴时没有先保住制表符 / 换行这两个分隔符 —— 从表格里粘进来的一列词会粘成一个词',
  );
  assert.match(fn, /replace\([^)]*CHOICE_JOINER\)/, '那两个分隔符没有换成显示分隔符（屏幕上会看不见分界）');

  // 🔴 反面一：`onBlur` 不许出现在这个组件（上面第一条网钉着整个文件；这里就近再钉一次，
  //    免得将来把组件搬走时那条网跟着失效）。
  assert.ok(!/\bonBlur\b/.test(fn), '这个组件又挂了 `onBlur` —— 会在失焦时动教师打的字');
  // 🔴 反面二：打字那条路（`onChange`）不许被碰。
  const onChangeAt = input.indexOf('onChange=');
  assert.ok(onChangeAt > 0, '`onChange` 不见了 —— 打字那条路被弄坏了');
  assert.ok(
    !input.slice(onChangeAt).includes('normalizePastedText'),
    '`onChange` 里夹带了归一化 —— 会打扰老师打字（本次只接 onPaste）',
  );

  // 接的是**哪两处**：每空答案那一格、以及主观题的「参考答案 / 参考要点」—— 两处用的都是这一个组件。
  const answerAt = source.indexOf('worksheet-editor-fill-answer-editor');
  assert.ok(answerAt > 0, '找不到每空答案那一格');
  assert.match(source.slice(answerAt, answerAt + 700), /<SymbolListInput/, '每空答案那一格换控件了 —— 粘贴去格式接不到它');
  const card = body(CARD);
  const referenceAt = card.indexOf('worksheet-editor-reference-block');
  assert.ok(referenceAt > 0, '找不到主观题「参考答案 / 参考要点」那一块');
  assert.match(card.slice(referenceAt, referenceAt + 1200), /<SymbolListInput/, '参考答案那一格换控件了 —— 粘贴去格式接不到它');
});
