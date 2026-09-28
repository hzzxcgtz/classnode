import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishWorksheetClear, resetWorksheetClearBusForTest, subscribeWorksheetClear } from './worksheet-clear-bus.ts';

/**
 * 教师「清除这名学生在这份学习单上的作答」这条**命令**的投递。
 *
 * 它被抽出来是因为前面两版都把这条路径搞坏了，而两次的成因都**不在被投递的东西上**：
 *   ① 挂在错的 socket 上（学生端不用教师端那个单例）⇒ 收不到，两边不报错；
 *   ② 用会话层 state 传 ⇒ 每次投递让整棵会话树重渲染，教师报学生端假死。
 * ⇒ 现在它是一段**没有任何 React 的纯逻辑**，于是可以被 `node --test` 直接钉住 ——
 *   这是它前两版都做不到的（一个在 socket 里、一个在 React 状态里，都测不了）。
 *
 * ⚠️ 每条用例开头都要 `resetWorksheetClearBusForTest()`：模块级单例在同一个进程里
 * 跨用例存活，不清的话上一条的监听器会收到下一条的投递（而那条用例断言的是「没收到」）。
 */

test('★ 投递：订阅者收到指令，且 token 单调递增（两次清除不会撞成同一个值）', () => {
  resetWorksheetClearBusForTest();
  const got: Array<{ token: number; questionId: string | null }> = [];
  const off = subscribeWorksheetClear((command) => got.push({ token: command.token, questionId: command.questionId }));
  try {
    publishWorksheetClear({ classroomId: 'c1', participantId: 'p1', worksheetId: 'w1', questionId: 'q3' });
    publishWorksheetClear({ classroomId: 'c1', participantId: 'p1', worksheetId: 'w1', questionId: 'q3' });
    assert.equal(got.length, 2);
    assert.deepEqual(got.map((item) => item.questionId), ['q3', 'q3']);
    // 🔴 **同一毫秒内的两次清除必须有两个不同的 token** —— 用 `Date.now()` 当 token 时
    // 这两条会相等，而那时第二次不会被处置（`token <= seen` 直接返回），两边都不报错。
    assert.notEqual(got[0].token, got[1].token, 'token 必须单调递增，不许用 Date.now()');
    assert.ok(got[1].token > got[0].token);
  } finally {
    off();
  }
});

test('★ 整张清除时 `questionId` 是 null（缺省与显式 null 都要落成 null）', () => {
  resetWorksheetClearBusForTest();
  const got: Array<string | null> = [];
  const off = subscribeWorksheetClear((command) => got.push(command.questionId));
  try {
    publishWorksheetClear({ classroomId: 'c1', participantId: 'p1', worksheetId: 'w1' });
    publishWorksheetClear({ classroomId: 'c1', participantId: 'p1', worksheetId: 'w1', questionId: null });
  } finally {
    off();
  }
  assert.deepEqual(got, [null, null], '两种写法都必须落成 null（不是 undefined —— 判据用的是 === null）');
});

test('★ 退订之后不再收到（面板卸载）', () => {
  resetWorksheetClearBusForTest();
  let count = 0;
  const off = subscribeWorksheetClear(() => { count += 1; });
  publishWorksheetClear({ classroomId: 'c1', participantId: 'p1', worksheetId: 'w1' });
  off();
  publishWorksheetClear({ classroomId: 'c1', participantId: 'p1', worksheetId: 'w1' });
  assert.equal(count, 1, '退订之后那一条不该到');
});

/**
 * 🔴 **订阅之前发出的指令不补发。** 这是**要的**，不是漏了：
 * 换身份再切回来时学习单面板会重挂，而重放一条十几分钟前的清除指令会把学生
 * **在那之后重新答的**内容抹掉。旧版靠一个 `seenClearTokenRef` 手工挡这件事，
 * 现在是结构性的 —— 这条用例钉的就是「结构性」这三个字。
 */
test('🔴 订阅之前发出的指令**不补发**（换身份重挂时不该被十几分钟前的指令抹掉新作答）', () => {
  resetWorksheetClearBusForTest();
  publishWorksheetClear({ classroomId: 'c1', participantId: 'p1', worksheetId: 'w1', questionId: 'q3' });

  let count = 0;
  const off = subscribeWorksheetClear(() => { count += 1; });
  try {
    assert.equal(count, 0, '订阅之前的那一条不许追着送过来');
    publishWorksheetClear({ classroomId: 'c1', participantId: 'p1', worksheetId: 'w1', questionId: 'q3' });
    assert.equal(count, 1, '阳性对照：订阅之后的那一条必须到');
  } finally {
    off();
  }
});

/**
 * 🔴 **投递途中新订阅的监听器，不许收到这一条。**
 *
 * 这是「不补发」那条性质的一个推论，也是 `[...listeners]` 那份副本真正防的东西 ——
 * `Set` 的迭代规范保证**新增**的元素会被访问到，所以直接遍历 `Set` 时，一个在处置里
 * 挂上来的监听器会收到**它订阅之前**发出的那一条。
 *
 * ⚠️ 这个测试第一版断言的是「A 退订自己之后 B 仍须收到」—— **那条断言是错的**
 * （靠 mutation 检查抓出来的：把副本去掉，它照样绿）。`Set` 的迭代规范保证「删掉**当前**
 * 元素不影响后续」，所以自退订在直接遍历下本来就安全。断言一件不成立的事，
 * 比没有测试更坏：它让人以为这里被保护着。
 */
test('🔴 投递途中新订阅的监听器不许收到这一条（`Set` 直接遍历会访问到新增的）', () => {
  resetWorksheetClearBusForTest();
  const got: string[] = [];
  const offA = subscribeWorksheetClear(() => {
    got.push('A');
    // 处置途中挂一个上来 —— 它不该收到**这一条**（那是「补发」，本文件明确不做）。
    subscribeWorksheetClear(() => { got.push('晚到的'); });
  });
  try {
    publishWorksheetClear({ classroomId: 'c1', participantId: 'p1', worksheetId: 'w1' });
    assert.deepEqual(got, ['A'], '投递途中新订阅的监听器收到了它订阅之前的那一条');
  } finally {
    offA();
    resetWorksheetClearBusForTest();
  }
});
