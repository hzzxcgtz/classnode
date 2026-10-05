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

test('★ 那几处提示语是**同一句**（同一份事实不许有两份拷贝）', () => {
  // 原来 `question-card.tsx` 里有两句各写一遍的「顿号、逗号、分号」——
  // 扩充分隔符集合时是同一个事实，两份就是两次漂移的机会。
  const card = body(CARD);
  assert.ok(card.includes('CHOICE_SEPARATOR_HINT'), '提示语没有走那个共用的常量');
  assert.ok(!card.includes('顿号、逗号'), '还有一处把分隔符**写死**在提示语里');
});

test('★ 填空题的答案住在**每张空卡片里**（教师 2026-10-05 裁定 A），且不许有第二个入口', () => {
  // 教师原话：「填空题的答案放到这里」——箭头指着那张空卡片作答方式行**右侧的空白**。
  const bodySrc = body(BODY);
  const card = body(CARD);

  assert.match(bodySrc, /\bworksheet-editor-fill-answer-field\b/, '空卡片里没有答案格');
  assert.match(bodySrc, /writeFillAnswers\(/, '答案没有按原来那个 nested 形状写回（存储形状一个字都不该变）');

  // 🔴 反面：题目卡里那个「标准答案」网格**不许回来** —— 同一份答案两个编辑入口就是分叉，
  //    而且那一块住在 `{gradedOn && …}` 里（只有打开自动评分才看得见），
  //    而每个空都能选「AI 评分」，那种情况恰恰最需要改答案。
  assert.ok(!card.includes('FillBlanksBody'), '「标准答案」那块又回来了 —— 答案会有两个编辑入口');
  assert.ok(!card.includes('每个空可以填多个可接受答案'), '那句说明被抄回题目卡了（应当在空卡片下方那一处）');
  // 🔴 连带：那句「自动评分已关闭，正确答案暂时隐藏」对填空题不再成立（答案一直可编辑）。
  assert.match(
    card,
    /!gradedOn && isGradedQuestionType\(node\.type\) && !isBlankType/,
    '填空题又被算进「正确答案暂时隐藏」那句里了 —— 而它的答案现在一直可编辑',
  );
});

test('★ 填空题的 AI 块**只剩评分标准**（裁定 A）：没有整题开关、没有满额', () => {
  // 教师问「这部分是不是多余了？」——开关与满额确实与每个空的「评分方式 / 满额」重复；
  // 而「评分标准」全站只有这一个入口，删了就没地方写。
  const card = body(CARD);
  // ⚠️ 判据用**JSX 字面量**，不是「AI 评分」这个词 —— 注释里到处都是那个词。
  assert.match(card, /\{node\.type === 'fill-blank' \? 'AI 评分标准' : 'AI 评分'\}/, '标题没按裁定 A 分开');
  assert.match(
    card,
    /node\.type !== 'fill-blank' && !explicitFillScoring && <HeadSwitch/,
    '填空题的整题开关又回来了（与每个空的「评分方式」重复）',
  );
  assert.match(
    card,
    /node\.type !== 'fill-blank' && !explicitFillScoring && <div className="worksheet-editor-ai-scoring-field">/,
    '填空题的满额又回来了（每个空自己有一个满额）',
  );
  // 评分标准本身必须在（它是全站唯一条目），且填空题**一直显示**它 ——
  // 写标准与「评不评分」是两件事：不评分时「发给 AI 分析」照样读它。
  assert.match(card, /worksheet-editor-rubric-upload/, '评分标准的入口丢了 —— 填空题就没有标准可写了');
  assert.match(
    card,
    /supportsAiScoring && \(node\.type === 'fill-blank' \|\| !explicitFillScoring \|\| aiScoringEnabled\)/,
    '填空题那一块的显示条件被改窄了（不评分时教师就写不了标准）',
  );
});

test('★ 评分方式那一排由**作答方式**决定（手工填写三项 / 选词两项），答案标签跟着变', () => {
  // ★ 2026-10-05（教师）：「手工填写含三项评分方式，……右侧或下方选词则只有自动评分或不评分。
  // 手工填写……答案应该叫『评分标准』，右侧或下方选词则……答案就叫答案。」
  const bodySrc = body(BODY);

  // 🔴 选项**不许**写死成三项：写死了就意味着「下方选词 + AI 评分」在界面上**点得动**，
  //    而服务端那条校验（「只有手工填写时才能使用 AI 评分」）会**拒绝保存** ——
  //    教师看到的是一个点得动却存不下的组合，报错还说不到点子上。
  assert.match(bodySrc, /fillGradingModesFor\(settings\[index\]\.mode\)/, '评分方式那一排没有按作答方式取选项');
  assert.ok(!/\['ai', 'AI 评分'\]/.test(bodySrc), '评分方式的选项又被写死回来了');

  // 生效值（回退）也要看作答方式，否则选词那一空会渲染成「一个都没选中」。
  assert.match(bodySrc, /allowsAiGrading\(setting\.mode\)/, '生效评分方式的回退没看作答方式');

  // 标签：手工填写时这份文字还要给 AI 当评分依据（叫「评分标准」）；选词时它就是答案。
  assert.match(
    bodySrc,
    /\{settings\[index\]\.mode === 'text' \? '评分标准' : '答案'\}/,
    '答案格的标签没按作答方式分（手工填写该叫「评分标准」）',
  );
});
