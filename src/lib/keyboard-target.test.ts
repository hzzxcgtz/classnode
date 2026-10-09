/**
 * `keyboard-target.ts` 的单元测试 —— 纯 Node，不需要 jsdom。
 *
 * 🔴 这几条**必须**存在，因为它们是"输入框里让位给浏览器"那句话的**全部证据**。
 *   原先那句话是两份内联正则，只能断言"字符串在不在"；实测把它短路掉
 *   （`const typing = false && …`）**断言照样绿** —— 假绿。抽成纯函数之后这里能真喂形状。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isTypingTarget, isUndoShortcut } from './keyboard-target.ts';

test('正在输入的三类目标都让位：INPUT / TEXTAREA / contentEditable', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true, '输入框没有让位');
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true, '多行文本没有让位');
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true, '富文本编辑区没有让位');
});

test('大小写都要认（真实 DOM 的 tagName 是大写，但别赌这一点）', () => {
  assert.equal(isTypingTarget({ tagName: 'input' }), true, '小写 tagName 漏了');
  assert.equal(isTypingTarget({ tagName: 'TextArea' }), true, '混合大小写漏了');
});

test('不承载「打字」的东西一律不让位 —— 否则画布快捷键会莫名失灵', () => {
  assert.equal(isTypingTarget({ tagName: 'DIV' }), false, '普通元素不该让位');
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), false, '下拉框不承载打字，不该让位');
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false, '按钮不该让位');
  assert.equal(isTypingTarget({ tagName: 'CANVAS' }), false, '画布自己不该让位');
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: false }), false,
    'isContentEditable 为 false 被当成了 true');
});

test('拿不到目标时不炸、也不让位（快捷键照常工作）', () => {
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
  assert.equal(isTypingTarget({}), false, '读不到 tagName 时不该误判为正在输入');
});

test('撤销组合键：Meta 与 Ctrl 都认，z 与 Z 都认', () => {
  assert.equal(isUndoShortcut({ metaKey: true, ctrlKey: false, key: 'z' }), true, 'Cmd+Z 没认出来');
  assert.equal(isUndoShortcut({ metaKey: false, ctrlKey: true, key: 'z' }), true, 'Ctrl+Z 没认出来');
  assert.equal(isUndoShortcut({ metaKey: true, ctrlKey: false, key: 'Z' }), true, 'Shift 态的 Z 没认出来');
});

test('撤销组合键：没有修饰键、或不是 z 的，一律不是撤销', () => {
  assert.equal(isUndoShortcut({ metaKey: false, ctrlKey: false, key: 'z' }), false,
    '光按 z 就被当成撤销 ⇒ 学生打字时图形会被撤掉');
  assert.equal(isUndoShortcut({ metaKey: true, ctrlKey: false, key: 'a' }), false, 'Cmd+A 被当成了撤销');
  assert.equal(isUndoShortcut({ metaKey: true, ctrlKey: false, key: 'y' }), false, 'Cmd+Y 被当成了撤销');
  assert.equal(isUndoShortcut({ metaKey: true, ctrlKey: false, key: 'Backspace' }), false,
    'Cmd+Backspace 被当成了撤销');
});
