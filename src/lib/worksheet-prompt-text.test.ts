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
const MARK_SOURCE = fs.readFileSync(path.resolve(HERE, '../components/worksheet-wrong-mark.tsx'), 'utf8');

/** 块注释（含 JSX 的 `{/* … *\/}`）与整行 `//` 注释。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('🔴 题干渲染器与答错标记里一个定位都没有（标记不许浮到内容上面）', () => {
  // ★ 2026-09-28：槽的画法搬去了 `worksheet-blank-slot.tsx` ⇒ **它也要进这条网**。
  const SLOT_SOURCE = fs.readFileSync(path.join(HERE, 'worksheet-blank-slot.tsx'), 'utf8');
  for (const [name, source] of [['worksheet-prompt-text.tsx', SOURCE], ['worksheet-blank-slot.tsx', SLOT_SOURCE], ['worksheet-wrong-mark.tsx', MARK_SOURCE]]) {
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
  assert.ok(MARK_SOURCE.includes('export function WrongMark'), '标记那一份也要真的被读到');
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
  // 那枚叉本身仍然只有一处定义，而且**还有人用**（选择题的选项 —— 教师这次只说了填空题，
  // 那处分叉是有意的：✗ 标的是教师写的选项，删除线在别人写的字上是另一种读法）。
  const choiceSource = fs.readFileSync(
    path.resolve(HERE, '../app/classroom/worksheet/questions/choice-body.tsx'), 'utf8',
  );
  assert.equal((choiceSource.match(/<WrongMark \/>/g) ?? []).length, 1, '选择题的选项还在用它');
});
