/**
 * ★ 2026-09-27（教师）：「填写题的手工输入域如果有错，叉叉打上后原来的字会最淡。」
 *
 * 🔴 **那不是配色问题，是红叉压在字上。** 那个叉原来绝对定位在输入框的右上角
 *（`WRONG_MARK_ANCHOR = { position: 'absolute', top: 1, right: 2 }`），而输入框是
 * 「按内容算宽 + 2ch 富裕」的 ⇒ 学生的答案一长，叉就盖掉字的一角。
 * 待选区那种槽更早改过一次同一个毛病（`820abfc`：从贴盒角改成贴文字）。
 *
 * ⇒ 立的规矩：**这个文件里一个定位都不许有。** 标记一律走布局 ——
 *   槽里靠 flex 的 `alignSelf`，输入框那边就是紧跟其后的一个内联兄弟。
 *   这条规矩是「标记不许盖住内容」的**可检验说法**：只要还有 `position: absolute`，
 *   就又能写出「叉浮在字上面」那种版面，而它在屏幕上**不会报任何错**。
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

/** 块注释（含 JSX 的 `{/* … *\/}`）与整行 `//` 注释。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('🔴 `worksheet-prompt-text.tsx` 里一个定位都没有（标记不许浮到内容上面）', () => {
  const code = stripComments(SOURCE);
  const found = [...code.matchAll(/position:\s*'([a-zA-Z]+)'/g)].map((match) => match[1]);
  assert.deepEqual(
    found, [],
    `这里出现了定位（${found.join(' / ')}）⇒ 答错标记又能被绝对定位到框角上、压住学生写的字。`
    + ' 位置请交给布局：槽里用 flex 的 alignSelf，输入框那边用紧随其后的内联兄弟。',
  );
});

test('阳性对照：这条网真的在读这个文件（否则上面那条对空串永远绿）', () => {
  assert.ok(SOURCE.includes('function WrongMark'), '文件要真的被读到了');
  assert.ok(stripComments(SOURCE).length > 500, '剥注释之后剩下的仍是这个组件，不是一段空壳');
  // 那个叉**两处都还在画**（槽 + 输入框）—— 少了任何一处，上面那条会因为「没有定位」而更绿。
  assert.equal((SOURCE.match(/<WrongMark \/>/g) ?? []).length, 2, '槽与输入框各一处');
});
