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

test('阳性对照：这条网真的在读这两个文件（否则上面那条对空串永远绿）', () => {
  assert.ok(SOURCE.includes('export function PromptText'), '题干渲染器要真的被读到了');
  assert.ok(MARK_SOURCE.includes('export function WrongMark'), '标记那一份也要真的被读到');
  assert.ok(stripComments(SOURCE).length > 500, '剥注释之后剩下的仍是这个组件，不是一段空壳');
  // 那个叉两处都还在画（槽 + 输入框）—— 少了任何一处，上面那条会因为「没有定位」而更绿。
  // ★ 2026-09-28：**槽搬去了 `worksheet-blank-slot.tsx`**（表格里的空现在也能是槽，
  //    两处必须长得一样）⇒ 数叉要**两个文件一起数**。少了这一条，槽那一份的定位
  //    就没人守了（而它正是「叉压住字」那件事的现场）。
  const slotSource = fs.readFileSync(path.join(HERE, 'worksheet-blank-slot.tsx'), 'utf8');
  assert.equal((SOURCE.match(/<WrongMark \/>/g) ?? []).length, 1, '输入框那一处');
  assert.equal((slotSource.match(/<WrongMark \/>/g) ?? []).length, 1, '槽那一处（在共用组件里）');
  // ★ 2026-09-27：标记本身搬去共用组件了 ⇒ 这里只是引用它（选择题的选项也用同一枚）。
  assert.ok(SOURCE.includes("from '@/components/worksheet-wrong-mark'"), '标记从共用组件来');
});
