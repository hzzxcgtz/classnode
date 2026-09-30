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
