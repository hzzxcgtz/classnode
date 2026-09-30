/**
 * ★ 跨工程对拍：题面公式的切分在仓里有**两份**实现
 *（`src/lib/worksheet-math.ts` 与 `server/src/services/worksheet-math.ts`），
 * 同一批刁钻输入喂给两边，结果必须**逐字相同**。
 *
 * 🔴 为什么需要它：服务端读不到 `src/`，所以这两份是**有意**的重复
 *（仓里的先例：`worksheet-ink.ts` ↔ `ink-path.ts`）。而同一件事多份实现正是本项目
 * 反复被咬的那类分叉 —— 前端把 `$` 认成公式、服务端不认，症状是「纸上印着源码、
 * 屏幕上画着公式」，两边都不报错。
 *
 * ⚠️ 它**住在前端测试目录**，因为只有这一个 runner 能同时看见两边
 *（根目录的 `node --test` 扫 `src/` 下的全部 `*.test.ts`；服务端那个只吃编译产物）。
 * ⚠️ 被加载的服务端那份文件**没有任何 import** ⇒ Node 的类型擦除加载得起来。
 * ⚠️ 注释里**不要写 glob**（`*` 加斜杠会提前终止块注释 ⇒ ERR_INVALID_TYPESCRIPT_SYNTAX，
 *    `worksheet-ink-parity.test.ts` 的第一次就是这么挂的）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMath as front, mathText as frontText } from './worksheet-math.ts';
import { splitMath as back, mathText as backText } from '../../server/src/services/worksheet-math.ts';

/** 一批刻意刁钻的输入：裸 `$` / 没闭合 / 跨行 / `$$` / 空 / 相邻公式 / 边界字符。 */
const INPUTS = [
  '计算 $x^2+1=10$ 中 x 的值。',
  '这本书 $5，另一本 $8',
  '价格 $5，另一本$8',
  '$$x^2$$ 的展开',
  '求 $\\frac{1}{2}$ 与 $\\sqrt{y}$',
  '全班 $ 元的班费',
  '只有一半的 $x^2 公式',
  '3*5=15 和 $a_1$',
  '第一行 $x$\n第二行 $y$',
  '跨行的 $x\n+1$ 不该成公式',
  '$a$$b$', '$$', '$$$$', '$', '', '没有公式', '结尾是 $', '$ x$', '$x $',
  '$x$', '$1$', '$a b$', '$\n$',
];

test('★ 对拍：同一批输入 ⇒ 两边的切分与剥定界符结果逐字相同', () => {
  for (const input of INPUTS) {
    assert.deepEqual(back(input), front(input), `切分不一致：${JSON.stringify(input)}`);
    assert.equal(backText(back(input)), frontText(front(input)), `mathText 不一致：${JSON.stringify(input)}`);
  }
});

test('阳性对照：这条网真的在读服务端那份文件（否则两边都是 undefined 也可能「相等」）', () => {
  // 🔴 没有这一条时，若服务端的 import 静默拿到 undefined，`back(...)` 会抛
  //    「not a function」—— 那还算好。真正的风险是两份都被换成同一个空实现。
  assert.equal(typeof back, 'function', '服务端那份没被加载起来');
  assert.equal(typeof backText, 'function', '服务端那份没被加载起来');
  // 刁钻输入里必须真的有公式被切出来（否则「两边都是原样返回」也能逐字相同）。
  // ⚠️ `'光$x^2$'` 切出来是 **2** 段（文字 + 公式），不是 3 —— 这个数写错时
  //    失败的是**阳性对照自己**，而那正是它该做的事（它证明自己有牙齿）。
  const withFormula = front('光$x^2$');
  assert.equal(withFormula.length, 2, '阳性对照本身失效：夹具里那个公式没被切出来');
  assert.equal(withFormula[1].kind, 'math', '阳性对照本身失效：第二段不是公式');
});
