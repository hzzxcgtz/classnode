/**
 * ★ 2026-09-27（教师）：「填写题的手工输入域如果有错，叉叉打上后原来的字会最淡。」
 *
 * 🔴 **那不是配色问题，是红叉压在字上。** 那个叉原来绝对定位在输入框的右上角
 *（`WRONG_MARK_ANCHOR = { position: 'absolute', top: 1, right: 2 }`），而输入框是
 * 「按内容算宽 + 2ch 富裕」的 ⇒ 学生的答案一长，叉就盖掉字的一角。
 * 待选区那种槽更早改过一次同一个毛病（`820abfc`：从贴盒角改成贴文字）。
 *
 * ⇒ 立的规矩：**这几个文件里一个定位都不许有。** 这条规矩是「标记不许盖住内容」的
 *   **可检验说法**：只要还有 `position: absolute`，就又能写出「标记浮在字上面」那种版面，
 *   而它在屏幕上**不会报任何错**。
 *
 * ★ 2026-09-29（教师）：「在错误的边上加一个红色的叉叉符号对学生的体验不是很好，
 *   所以我决定还是使用**暗红色文字加删除线**这种方式。」⇒ 答错标记从**旁边多一个节点**
 *   变成**那个值自己的样式**（`blankValueStyle`），于是那两个文件里**一个标记节点都没有了**。
 *   🔴 这条网因此跟着改了一次，改法本身是有讲究的：见下面阳性对照那一条的注释 ——
 *   「把 1 改成 0」是不够的（那样「顺手把标记整个删掉」也会让它更绿）。
 *
 * ⚠️ 只读文本、不渲染任何东西 ⇒ 本机（无 jsdom、无浏览器）跑得起来。
 * ⚠️ 它**不查好不好看** —— 叉与字的高低关系（`vertical-align` 那一档）只能在真机上看。
 *    它只回答一个问题：**这个文件里有没有人能把东西浮到内容上面去。**
 *
 * ⚠️ 必须在**剥掉注释之后**再查：本文件与源码的注释里都**讨论**过 `position: absolute`
 *    （记的就是它为什么被删），不剥的话这条网会被自己的说明文字喂饱、永远绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, 'worksheet-prompt-text.tsx'), 'utf8');
/**
 * ★ 2026-09-27：答错标记搬去了 `src/components/worksheet-wrong-mark.tsx`（选择题的选项现在
 * 也画它）。**那一份也在网里** —— 否则「不许定位」只守住了调用方，而那枚标记自己
 * 加一个 `position: absolute` 就又能浮起来。
 */
// ⊘ ★ 2026-09-29：那枚红叉（`@/components/worksheet-wrong-mark`）的**最后一个使用者**
//（选择题的选项）也改成了「暗红 + 删除线」⇒ 那个文件删掉了，本网不再读它。
// ⚠️ 它带着的教训没有丢：文件头「标记不许盖住内容」那一段说的就是它（那个叉曾绝对定位在
// 填空框右上角，答案一长就压住字）。

/** 块注释（含 JSX 的 `{/* … *\/}`）与整行 `//` 注释。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('🔴 题干渲染器与答错标记里一个定位都没有（标记不许浮到内容上面）', () => {
  // ★ 2026-09-28：槽的画法搬去了 `worksheet-blank-slot.tsx` ⇒ **它也要进这条网**。
  const SLOT_SOURCE = fs.readFileSync(path.join(HERE, 'worksheet-blank-slot.tsx'), 'utf8');
  for (const [name, source] of [['worksheet-prompt-text.tsx', SOURCE], ['worksheet-blank-slot.tsx', SLOT_SOURCE]]) {
    const found = [...stripComments(source).matchAll(/position:\s*'([a-zA-Z]+)'/g)].map((match) => match[1]);
    assert.deepEqual(
      found, [],
      `${name} 里出现了定位（${found.join(' / ')}）⇒ 答错标记又能被绝对定位到框角上、`
      + '压住学生写的字。位置请交给布局：槽里用 flex 的 alignSelf，输入框那边用紧随其后的内联兄弟。',
    );
  }
});

/**
 * 连 `import` 行也剥掉。
 *
 * 🔴 这一层是**变异检验抓出来的**：第一版断言写的是「源码里出现过 `blankValueStyle`」，
 * 而那个名字**还留在 import 行里** ⇒ 把调用点整个删掉、只留一行 import，断言照样绿。
 * ⇒ 「名字出现过」不等于「那件事被做了」，所以先把 import 行剥掉再查。
 * ⚠️ 按行剥，假设这几个文件的 import 都是**单行**（今天都是；换了写法这条要跟着改）。
 */
function stripImports(source: string): string {
  return source.split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
}

test('阳性对照：这条网真的在读这两个文件（否则上面那条对空串永远绿）', () => {
  assert.ok(SOURCE.includes('export function PromptText'), '题干渲染器要真的被读到了');
  assert.ok(stripComments(SOURCE).length > 500, '剥注释之后剩下的仍是这个组件，不是一段空壳');
  const slotSource = fs.readFileSync(path.join(HERE, 'worksheet-blank-slot.tsx'), 'utf8');
  const stripped = (source: string) => stripComments(source);
  // ★ 2026-09-29：这两个文件**不再画那枚叉**（答错改成了「那个值的字变暗红 + 删除线」）。
  // 🔴 **但这条断言不能只是把 `1` 改成 `0`** —— 「有几个叉」那个数原来是
  //    「这里真的有东西可守」的证据；改成 0 之后就什么也证明不了了，而且
  //    「哪天有人顺手把标记整个删掉」会让上面那条（不许定位）**变得更绿**。
  //    ⇒ 补上真正承重的那一句：**标记仍然在，只是换成了样式**。
  assert.equal((SOURCE.match(/<WrongMark/g) ?? []).length, 0, '输入框那一处不再画叉');
  assert.equal((slotSource.match(/<WrongMark/g) ?? []).length, 0, '槽那一处也不再画叉');
  assert.ok(stripImports(stripped(SOURCE)).includes('blankValueStyle'), '答错必须仍然被标出来（换成样式了）');
  assert.ok(stripImports(stripped(slotSource)).includes('blankValueStyle'), '槽那一处同样');
  assert.ok(
    !/color\s*:\s*pending\s*&&\s*!filled\s*\?[^:]+:\s*undefined/.test(stripComments(slotSource)),
    '未预览候选词时不能用 color: undefined 覆盖 blankValueStyle 的暗红色',
  );
  assert.ok(stripImports(stripped(SOURCE)).includes('blankAriaLabel'), '删除线对读屏无声 ⇒ 那一格的名字要跟着走');
  const choiceSource = fs.readFileSync(
    path.resolve(HERE, '../app/classroom/worksheet/questions/choice-body.tsx'), 'utf8',
  );
  assert.ok(stripImports(stripped(choiceSource)).includes('WRONG_ANSWER_STYLE'),
    '选择题那一处必须仍然标出答错（与填空同一条规则，换成样式了）');
  // ⊘ ★ 2026-09-29：最后一处（选择题的选项）也改成了样式 ⇒ 那一枚**一个使用者都没有了**，
  // 组件随之删除。这里改成断言**它确实改用样式**（而不是「不许用那枚叉」——
  // 那种断言在组件删掉之后恒真，等于没有网）。
});

/**
 * ★ 2026-09-30：公式渲染接在 `PromptText` 里。
 *
 * 🔴 **断言必须剥掉 import 行**（用上面那个 `stripImports`）：`splitMath` 与 `MathSpan`
 *    这两个名字**本来就出现在 import 行里** ⇒ 不剥的话「把调用点整个删掉、只留一行
 *    import」这条断言照样绿。这个坑本文件已经踩过一次（见 `stripImports` 的注释：
 *    第一版就是这么假绿的）。
 */
test('★ 公式渲染接在 PromptText 里（三个调用方自动获得，不许各自实现一遍）', () => {
  const body = stripImports(stripComments(SOURCE));
  // 阳性对照：剥完之后剩下的仍是这个组件，不是空壳（否则下面几句对空串永远绿）。
  assert.ok(body.length > 300, '剥 import 与注释之后剩下的仍是这个组件，不是一段空壳');
  assert.ok(body.includes('splitMath'), 'PromptText 没有接公式切分（只在 import 行里出现不算）');
  assert.ok(body.includes('MathSpan'), 'PromptText 没有画公式（只在 import 行里出现不算）');
  // 🔴 **「函数定义了」不等于「它被接上了」。** 上面两句查的是「名字出现过」——
  //    一个没人调用的 `renderInline` 里也有这两个名字 ⇒ 把三处调用点全部删掉，
  //    上面两句**照样绿**。所以这里数**调用点**：1 处定义 + 3 处调用（chunk / head / tail）。
  //    ⚠️ 变异检验抓出来的：只查名字时，把 `renderInline(chunk, run)` 换回
  //    `<span>{chunk}</span>` 这条网一声不吭。
  const calls = (body.match(/renderInline\(/g) ?? []).length;
  assert.equal(calls, 4,
    `renderInline 出现了 ${calls} 次（应为 1 处定义 + 3 处调用：chunk / head / tail）`
    + ' —— 是不是有渲染点没接上公式？');
  // 🔴 反面：这个文件里不许出现第二套 KaTeX 调用 —— 那意味着有人又实现了一遍，
  //    而两块渲染一旦分叉，症状是「这里画得出来、那里画不出来」，且两边都不报错。
  assert.equal((body.match(/katex\.renderToString/g) ?? []).length, 0,
    'PromptText 里直接调了 KaTeX —— 应该走 MathSpan');
});
