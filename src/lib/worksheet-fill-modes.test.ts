import assert from 'node:assert/strict';
import test from 'node:test';

import { CHOICE_JOINER, CHOICE_SEPARATORS, blankSlots, fillSettingsFor, placedValue, sameChoiceItems, sharedPoolChoices, splitChoiceText, writeFillSettings } from './worksheet-fill-modes.ts';
import type { WorksheetQuestionNode } from './types.ts';
import { DEFAULT_PROMPT_STYLE, type PromptRun } from './worksheet-prompt-marks.ts';

const runs: PromptRun[] = [
  { start: 0, end: 4, ...DEFAULT_PROMPT_STYLE, blank: 'blank-a' },
  { start: 4, end: 8, ...DEFAULT_PROMPT_STYLE, blank: 'blank-b' },
  { start: 8, end: 12, ...DEFAULT_PROMPT_STYLE, blank: 'blank-c' },
];

function node(data: Record<string, unknown>, type: WorksheetQuestionNode['type'] = 'fill-blank'): WorksheetQuestionNode {
  return { id: 'q1', type, prompt: '____________', inputMode: 'keyboard', data, children: [] };
}

test('每个填空域按稳定 blank id 读取自己的作答方式', () => {
  const settings = fillSettingsFor(node({ fillBlankSettings: {
    'blank-a': { mode: 'text', choices: [] },
    'blank-b': { mode: 'inline', choices: ['阳光', '灯光'] },
    'blank-c': { mode: 'pool', choices: [] },
  } }), runs);
  assert.deepEqual(settings.map(item => item.mode), ['text', 'inline', 'pool']);
  assert.deepEqual(settings[1].choices, ['阳光', '灯光']);
});

test('设置写回仍以 blank id 为键，题干中插空不会让后面的设置串位', () => {
  // ⚠️ 签名带 `node` 了（★ 2026-09-28）：表格里的空不在 `runs` 里，光看分段认不出它们。
  const written = writeFillSettings(node({}), runs, [
    { mode: 'pool', choices: [] },
    { mode: 'text', choices: [] },
    { mode: 'inline', choices: ['水', '油'] },
  ]);
  assert.equal(written['blank-a'].mode, 'pool');
  assert.equal(written['blank-c'].mode, 'inline');
});

test('旧选择填空继续读取原来的共用词池与右侧两词分组', () => {
  const legacy = node({ choices: ['甲', '乙', '丙', '丁', '戊', '己'], choiceLayout: 'inline-pairs' }, 'choice-blank');
  assert.deepEqual(fillSettingsFor(legacy, runs).map(item => item.choices), [['甲', '乙'], ['丙', '丁'], ['戊', '己']]);
  assert.deepEqual(sharedPoolChoices(node({ choices: [' 甲 ', '', '乙'] }, 'choice-blank')), ['甲', '乙']);
});

// ── 单行输入那一套（★ 2026-09-28，教师）────────────────────────────────
//
// 教师原话：「这个完全没必要一行一个，太占空间了，用单行即可，词与词之间提示使用
// 常见的符号分隔即可。」⇒ 输入框从 textarea 改成单行，于是解析要认常见的分隔符。
// 🔴 **只用在输入这一侧**：读库那一侧（`fillSettingsFor` / `sharedPoolChoices`）
//    仍然走 `splitChoiceLines`（数组就是数组、字符串按行分）——
//    让**读**也按逗号切，会把库里一个含逗号的词条悄悄切成两个，而那是数据变更。

test('🔴 splitChoiceText：顿号、逗号、分号、换行都是分隔符', () => {
  assert.deepEqual(splitChoiceText('唐、宋、元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐，宋，元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐,宋,元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐；宋;元'), ['唐', '宋', '元']);
  // 换行仍然认（教师从 Excel 一列复制过来的那一列）
  assert.deepEqual(splitChoiceText('唐\n宋\n元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐、宋\n元;明'), ['唐', '宋', '元', '明']);
});

test('🔴 splitChoiceText：连续分隔符与两侧空白都不产生空词条', () => {
  assert.deepEqual(splitChoiceText('  唐 、、 宋  '), ['唐', '宋']);
  assert.deepEqual(splitChoiceText('唐、、、'), ['唐']);
  assert.deepEqual(splitChoiceText('、、'), []);
  assert.deepEqual(splitChoiceText(''), []);
  assert.deepEqual(splitChoiceText('   '), []);
});

test('🔴 splitChoiceText：词里的空格**不切**（「New York」是一个词）', () => {
  assert.deepEqual(splitChoiceText('New York、Los Angeles'), ['New York', 'Los Angeles']);
});

test('🔴 splitChoiceText：数组原样交给 splitChoiceLines（读库那一侧的口径不变）', () => {
  assert.deepEqual(splitChoiceText([' 甲 ', '', '乙']), ['甲', '乙']);
  assert.deepEqual(splitChoiceText('甲、乙'), ['甲', '乙'], '字符串才按符号切');
  assert.deepEqual(splitChoiceText(null), []);
  assert.deepEqual(splitChoiceText(42), []);
});

// ── 单行输入的分隔符集合（★ 2026-09-28，教师两轮）──────────────────────
//
// 教师第二轮看到我「待选词按标点切、答案只按分号切」之后否了：
// 「我说的是**常见符号提示都能用**，不要光是分号、顿号、逗号……」
// ⇒ 两种输入共用同一套分隔符。下面那两条**原来断言的是相反的结论**
//（「顿号与逗号是答案的一部分，不许拆」）—— 那是被教师否掉的设计，
// 现在断言的是**当下的**行为，免得下一个人把它当成 bug 改回去。

test('🔴 splitChoiceText：常见符号都算分隔符（顿号 / 逗号 / 分号 / 斜杠 / 竖线 / 换行）', () => {
  assert.deepEqual(splitChoiceText('唐、宋、元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐，宋，元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐,宋,元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐；宋;元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐/宋/元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐|宋|元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐\n宋\n元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐、宋\n元;明'), ['唐', '宋', '元', '明']);
});

test('🔴 splitChoiceText：**答案**也走同一套**（教师裁定：常见符号都能用）', () => {
  // ⚠️ 代价：本身含标点的答案会被拆开 —— 「小明、小红」变成两个可接受答案
  //（学生答「小明」也算对）。教师知情并选了这个便利，所以**提示必须写出来**
  //（见 question-card 里「标准答案」那句块说明）。
  assert.deepEqual(splitChoiceText('唐；唐代'), ['唐', '唐代']);
  assert.deepEqual(splitChoiceText('唐、唐代'), ['唐', '唐代']);
  assert.deepEqual(splitChoiceText('小明、小红'), ['小明', '小红']);
});

test('🔴 splitChoiceText：连续分隔符与两侧空白都不产生空条目', () => {
  assert.deepEqual(splitChoiceText('  唐 、、 宋  '), ['唐', '宋']);
  assert.deepEqual(splitChoiceText('唐、、、'), ['唐']);
  assert.deepEqual(splitChoiceText('、、'), []);
  assert.deepEqual(splitChoiceText(''), []);
  assert.deepEqual(splitChoiceText('   '), []);
});

test('🔴 splitChoiceText：词里的空格**不切**（「New York」是一个词）', () => {
  assert.deepEqual(splitChoiceText('New York、Los Angeles'), ['New York', 'Los Angeles']);
});

test('🔴 splitChoiceText：数组原样交给 splitChoiceLines（读库那一侧的口径不变）', () => {
  assert.deepEqual(splitChoiceText([' 甲 ', '', '乙']), ['甲', '乙']);
  assert.deepEqual(splitChoiceText('甲、乙'), ['甲', '乙'], '字符串才按符号切');
  assert.deepEqual(splitChoiceText(null), []);
  assert.deepEqual(splitChoiceText(42), []);
});

// ── 空的清单：题干里的 + 表格里的（★ 2026-09-28，教师反馈）────────────────
//
// 教师原话：「表格填空……和原来已有的题干和每个空的作答方式都完全割裂了……
// 东跳跳西跳跳」。
// 🔴 具体的一条是：`fillSettingsFor` 只认题干里的空（它遍历 `promptRuns` 的分段），
//    于是**一道表格题在「每个空的作答方式」那一块显示「题干中还没有填空域」**
//    —— 而上面明明有一张表、里面标着空。两块互相打脸。
// ⇒ 空的清单要**两种都数**，顺序与答案编号同一条规则（题干在前、表格在后）。

/**
 * 2×3 的表，**第 2 行第 3 格**是空（身份 `tb1`）。
 *
 * 🔴 空**不能落在对角线上**：`cellLabel` 的两个参数写反时，「第 2 行第 2 格」这类
 * 标签一个字都不变 ⇒ 变异检验抓不到（我在 `worksheet-table.test.ts` 里刚栽过一次，
 * 这里又栽了一次 —— 夹具自己要先立得住）。
 */
function tableFixture() {
  return {
    headerRow: true,
    rows: [
      [{ text: '姓名', blank: '' }, { text: '年龄', blank: '' }, { text: '城市', blank: '' }],
      [{ text: '张三', blank: '' }, { text: '25', blank: '' }, { text: '', blank: 'tb1' }],
    ],
  };
}

test('🔴 blankSlots：题干里的空在前、表格里的空在后，各自说清自己在哪', () => {
  const slots = blankSlots(node({ table: tableFixture() }), runs);
  assert.deepEqual(slots.map(item => [item.kind, item.label]), [
    ['text', '第 1 空'], ['text', '第 2 空'], ['text', '第 3 空'],
    ['table', '第 2 行第 3 格'],
  ]);
  assert.deepEqual(slots.map(item => item.id), ['blank-a', 'blank-b', 'blank-c', 'tb1'], '身份就是 fillBlankSettings 的键');
});

test('🔴 blankSlots：没有表格 ⇒ 与原来逐字相同（老题的清单一个字不变）', () => {
  assert.deepEqual(blankSlots(node({}), runs).map(item => item.id), ['blank-a', 'blank-b', 'blank-c']);
});

test('🔴 fillSettingsFor：**表格里的空也在清单里**（表格题不再说「还没有填空域」）', () => {
  const settings = fillSettingsFor(node({ table: tableFixture() }), runs);
  assert.equal(settings.length, 4, '三个题干空 + 一个表格空');
  assert.deepEqual(settings.map(item => item.mode), ['text', 'text', 'text', 'text'], '表格空缺省就是手工填写');
});

test('🔴 fillSettingsFor：表格空**存过的设置照读**（手改过的库 / 以后给表格开选词）', () => {
  const settings = fillSettingsFor(node({
    table: tableFixture(),
    fillBlankSettings: { tb1: { mode: 'pool', choices: [] } },
  }), runs);
  assert.equal(settings[3].mode, 'pool', '键是格子的身份，不是下标');
});

test('🔴 writeFillSettings：表格空的设置也按格子身份写回去', () => {
  const written = writeFillSettings(node({ table: tableFixture() }), runs, [
    { mode: 'text', choices: [] },
    { mode: 'inline', choices: ['甲', '乙'] },
    { mode: 'text', choices: [] },
    { mode: 'text', choices: [] },
  ]);
  assert.equal(written['blank-b'].mode, 'inline');
  assert.equal(written['tb1'].mode, 'text', '第 4 份写给了格子 tb1');
  assert.equal(Object.keys(written).length, 4);
});

test('🔴 blankSlots：标记夹在中间时，清单的顺序 = 答案的顺序（标记前 → 表格 → 标记后）', () => {
  // 题干：`{填空域}{表格域}{填空域}` —— 标记把两个文本空分开了
  const runs: PromptRun[] = [
    { start: 0, end: 5, ...DEFAULT_PROMPT_STYLE, blank: 'ba' },
    { start: 10, end: 15, ...DEFAULT_PROMPT_STYLE, blank: 'bc' },
  ];
  const node = { id: 'q1', type: 'fill-blank', prompt: '{填空域}{表格域}{填空域}', inputMode: 'keyboard' as const, data: { promptRuns: runs, table: tableFixture() }, children: [] };
  const slots = blankSlots(node, runs);
  assert.deepEqual(slots.map(item => item.label), ['第 1 空', '第 2 行第 3 格', '第 3 空']);
  assert.deepEqual(slots.map(item => item.id), ['ba', 'tb1', 'bc']);
  assert.deepEqual(slots.map(item => item.kind), ['text', 'table', 'text']);
});

test('🔴 落词写进草稿的是**判分口径**（剥掉公式定界符），否则学生点对了判错', () => {
  // 教师答案键写 `$x=2$` ⇒ 判分文本（`gradableAnswers`）是 `x=2`；
  // 而学生**点**的候选词是教师原文 `$x=2$` —— 两个口径不一样。
  // 不剥的话：点进来的值 `$x=2$` 与 `x=2` 不匹配 ⇒ **他点对了却判错**，
  // 而屏幕上「他点的词」与「正确答案」都渲染成同一个公式，看起来一模一样。
  assert.equal(placedValue('$x=2$'), 'x=2');
  // 没有公式的词一个字节都不动。
  assert.equal(placedValue('光合作用'), '光合作用');
  // 🔴 那个**不成公式**的 `$` 不许被吃掉（与判分侧同一条安全阀）：
  //    少了这一条，一个 `replace(/\$/g,'')` 式的实现也能让上面两条全绿。
  assert.equal(placedValue('这本书 $5'), '这本书 $5');
});

/**
 * ★ 2026-09-30（教师第三轮）：「几个选词之间的分隔符是怎么回事？几个地方要统一下，
 * 用户在输入的时候可以用各种常见的分隔符号，**你多想几个，都是支持的**，
 * 也不用刻意地转成某一个特别的符号。」
 * ⇒ 两条判据：**认得多**（下面第一条）、**显示统一**（`CHOICE_JOINER`）。
 */
test('🔴 splitChoiceText：**中文输入法打出来的**那几个也要认', () => {
  // 下面每一个都是「中文输入法下按对应键打出来的那一个」，而不是我凭空想的符号：
  //   · `／` —— 全角斜杠。⚠️ **这是最要紧的一个**：中文输入法里按 `/` 出来的就是它，
  //      而原来只认半角 `/` ⇒ 教师**照着提示打也切不开**，屏幕上只是**一整个**词条
  //      （不报错、不提示），他要等到学生那边选词只有一个才知道。
  //   · `\t` —— 从 Word 表格 / Excel 复制一列过来时，列与列之间是制表符不是换行。
  //   · `·` `•` `‧` `・` —— 各种间隔号 / 项目符号（从 PPT 粘过来的列表常是它）。
  //   · `﹑` —— 小顿号。
  assert.deepEqual(splitChoiceText('唐／宋／元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐\t宋\t元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐·宋·元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐•宋·元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐‧宋‧元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐・宋・元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('唐﹑宋'), ['唐', '宋']);
  // 半角与全角竖线都认（原来就有 —— 钉住，别在扩充时弄丢）。
  assert.deepEqual(splitChoiceText('唐|宋｜元'), ['唐', '宋', '元']);
  // 阳性对照：老的那几个一个都不许丢（扩充字符集时最容易顺手换掉整条正则）。
  assert.deepEqual(splitChoiceText('唐、宋，元；明'), ['唐', '宋', '元', '明']);
  assert.deepEqual(splitChoiceText('唐,宋;元'), ['唐', '宋', '元']);
  assert.deepEqual(splitChoiceText('  唐  '), ['唐'], '两侧空白仍然 trim');
});

test('🔴 splitChoiceText：**反斜杠不是分隔符** —— 否则答案里的公式会被劈成几段', () => {
  // 🔴 本次最容易踩的一个：`\` 看着像分隔符（不少老师拿它当顿号用），
  //    但「凡教师能打字处」现在包含**标准答案**，而答案可以是一条公式
  //    （`$\frac{a}{b}$`、`$x^2$`）—— 把 `\` 当分隔符会把公式劈成几段，
  //    而屏幕上什么都看不出来（判分那边只会表现为「答案对不上」）。
  assert.deepEqual(splitChoiceText('$\\frac{a}{b}$'), ['$\\frac{a}{b}$']);
  assert.deepEqual(splitChoiceText('$x^2$、$y^2$'), ['$x^2$', '$y^2$']);
  // 同理：公式里的 `{}` `^` `$` 一个都不能碰（把它们当分隔符的后果与上面同一类）。
  assert.deepEqual(splitChoiceText('$x^{2}+1$'), ['$x^{2}+1$']);
});

test('🔴 sameChoiceItems：判断「外面那一份」和「手里这份」是不是同一个列表', () => {
  // 🔴 它存在的理由：单行输入框**不再**把教师打的符号规范化掉（见 `SymbolListInput`），
  //    于是「什么时候该拿外面的值回填」需要一个判据。
  //    ⚠️ 判据必须是**逐项相等**（顺序也算），**不是**「拼出来的字符串相等」——
  //    后者会让「教师打了逗号、而外面那份用顿号拼」被判成两个不同的值，
  //    从而当场把教师的手稿改掉（那正是本次要修掉的那个毛病）。
  assert.equal(sameChoiceItems([], []), true);
  assert.equal(sameChoiceItems(['甲', '乙'], ['甲', '乙']), true);
  assert.equal(sameChoiceItems(['甲', '乙'], ['乙', '甲']), false, '顺序变了就是另一份');
  assert.equal(sameChoiceItems(['甲'], ['甲', '乙']), false);
  assert.equal(sameChoiceItems(['甲', '乙'], ['甲']), false);
  assert.equal(sameChoiceItems(['甲'], []), false);
  assert.equal(sameChoiceItems([], ['甲']), false);
  // ⚠️ 下面这两条防的是「拼成一个字符串再比」那种偷懒实现
  //（变异检验抓出来的：把实现换成 `a.join('') === b.join('')` 时，
  //  上面那几条**一条都不红** —— 而那个实现是坏的）：
  //   · `['甲乙']` 与 `['甲','乙']` 拼出来是同一个串，却**不是同一个列表**
  //     （一个是「甲乙」一个词，一个是「甲」「乙」两个）；
  //   · `['']` 与 `[]` 也拼成同一个串。
  //   混了的表现是**该回填的时候不回填** —— 外面改了答案、框里纹丝不动，
  //   而屏幕上什么都看不出来。
  assert.equal(sameChoiceItems(['甲乙'], ['甲', '乙']), false, '拼出来碰巧同串，但不是同一个列表');
  assert.equal(sameChoiceItems(['甲'], ['甲', '']), false, '空项也是项');
  assert.equal(sameChoiceItems([''], []), false);
});

test('🔴 CHOICE_JOINER：四处显示用的是**同一个**分隔符', () => {
  // 教师原话：「几个地方要统一下」。这个常量就是「统一」本身 ——
  // 原来四处各传一个（` / ` / `；` / `、` / `、`），而**参考答案那一处的占位语
  // 写的是顿号、值却用斜杠显示**（自己跟自己不一致）。
  // ⚠️ 它只管**显示**（把存下来的条目表拼成人看的一行），
  //    **不参与**解析 —— 教师打的符号不再被它改掉。
  assert.equal(CHOICE_JOINER, '、');
});

test('🔴 写回去再读回来必须**逐项无损** —— 单行输入框敢不回填就靠这一条', () => {
  // 🔴 这是 `SymbolListInput` 变更的**隐含前提**（★ 2026-09-30，教师第三轮）。
  //    它不再把教师打的符号规范化，而「什么时候该拿外面的值回填」的判据是
  //    「手里这份解析出来与外面那份**逐项相等**吗」。
  //    ⇒ 只要这几条往返无损，教师打的逗号就留得住。
  //    ⚠️ 某天哪一条变成**有损**的（多一次 trim / filter / 换形状），症状是
  //    **他刚打的字符被一个一个吃掉**，而屏幕上没有报错 —— 所以钉死在这里。
  const items = splitChoiceText('阳光,水分');       // 教师打的是逗号，不是顿号
  assert.deepEqual(items, ['阳光', '水分']);

  // ① 这一空右侧的词（写进 fillBlankSettings，按 blank id 存）
  const written = writeFillSettings(node({}), runs, [{ mode: 'inline', choices: items }]);
  const read = fillSettingsFor(node({ fillBlankSettings: written }), runs)[0].choices;
  assert.deepEqual(read, items, '选词往返丢了东西');

  // ② 共用选词（编辑页那个面板 2026-10-05 从「下方共用词池」改的名；直接存数组）
  assert.deepEqual(sharedPoolChoices(node({ fillChoicePool: items })), items, '词池往返丢了东西');

  // ③ 标准答案：写入方是 `writeFillAnswers`（= `text.split('\n')`），读出方原样返回数组。
  //    ⚠️ 这两步住在 `src/app/teacher/worksheets/edit/`，本文件引不到它们 ——
  //    这里只钉「按换行拼再按换行切」这一条**契约**（两边各自的那半由那边自己的网守着）。
  assert.deepEqual(items.join('\n').split('\n'), items, '标准答案往返丢了东西');

  // 阳性对照：真有损的话这条网必须红 —— 拿一份 trim 过的假想实现比一下。
  assert.notDeepEqual(['阳光 ', '水分'].map(item => item.trim()), ['阳光 ', '水分']);
});

test('🔴 CHOICE_SEPARATORS 与 splitChoiceText 必须是**同一套**（防漂移）', () => {
  // 🔴 这条网防的是**已经真实发生过一次**的那种漂移：分隔符集合在仓里原来有**三份拷贝**，
  //    加字符时只改了一边，而另外两处的注释还写着「与 `splitChoiceText` 同一套」——
  //    症状是 `（高兴／难过）` 在一处认得出、在另一处认不出（整个括号连词留在题面上）。
  //    现在三处都从 `CHOICE_SEPARATORS` 派生，这一条钉住「派生出来的真的管用」。
  for (const ch of CHOICE_SEPARATORS) {
    assert.deepEqual(splitChoiceText(`甲${ch}乙`), ['甲', '乙'], `${ch} 在常量里，却没被切`);
  }
  // 反面：这几个**刻意不是**分隔符。前两个是有原因的，后几个是「顺手加上去会很惨」的：
  //   · `\` —— 答案可以是一条公式（`$\frac{a}{b}$`），当分隔符会把它劈成几段；
  //   · 空格 —— 「New York」是一个词（教师说的也是「符号」）；
  //   · `$ { } ^ + ~ ：` —— 公式与数学式里到处都是，切了就是静默的数据变更。
  for (const ch of ['\\', ' ', '-', ':', '：', '$', '{', '}', '^', '+', '~', '=']) {
    assert.deepEqual(splitChoiceText(`甲${ch}乙`), [`甲${ch}乙`], `${ch} 不该是分隔符`);
  }
});
