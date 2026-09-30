/**
 * 服务端那份 `splitMath` 的判据（★ 2026-09-30）。
 *
 * ⚠️ 这份文件与 `src/lib/worksheet-math.test.ts` 的**用例逐字相同**（只换了 import 路径）——
 *    明知重复还要写，是因为两条网跑在**两个 runner** 里：
 *      · `src/lib/worksheet-math-parity.test.ts`（前端 runner）保证**两份实现一致**；
 *      · 本文件（服务端 runner，吃 `dist/`）保证**服务端那一份自己是对的**。
 *    哪天对拍那条被误删，服务端这边仍然有一条网。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitMath, mathText, mathMarkup } from '../services/worksheet-math.js';

/** 渲染成人眼可读的一行：公式用【】框起来。 */
function render(text: string): string {
  return splitMath(text).map((p) => (p.kind === 'math' ? `【${p.tex}】` : p.text)).join('');
}

test('🔴 正常公式：行内、多个、以及 `$$` 双层', () => {
  assert.equal(render('计算 $x^2+1=10$ 中 x 的值。'), '计算 【x^2+1=10】 中 x 的值。');
  assert.equal(render('求 $\\frac{1}{2}$ 与 $\\sqrt{y}$'), '求 【\\frac{1}{2}】 与 【\\sqrt{y}】');
  assert.equal(render('$$x^2$$ 的展开'), '【x^2】 的展开');
});

test('🔴 安全阀：裸 `$`（价格）一律原样，不许吞掉中间那段', () => {
  // 闭 `$` 前是空白 ⇒ 不成公式
  assert.equal(render('这本书 $5，另一本 $8'), '这本书 $5，另一本 $8');
  // 闭 `$` 后是数字 ⇒ 不成公式
  assert.equal(render('价格 $5，另一本$8'), '价格 $5，另一本$8');
  // 开 `$` 后是空白 ⇒ 不成公式
  assert.equal(render('全班 $ 元的班费'), '全班 $ 元的班费');
});

test('🔴 安全阀：没闭合 / 跨行 / 空的，一律原样', () => {
  assert.equal(render('只有一半的 $x^2 公式'), '只有一半的 $x^2 公式');
  assert.equal(render('跨行的 $x\n+1$ 不该成公式'), '跨行的 $x\n+1$ 不该成公式');
  assert.equal(render('$$'), '$$');
  assert.equal(render('$$$$'), '$$$$');
  assert.equal(render('$ x$'), '$ x$');
  assert.equal(render('$x $'), '$x $');
});

test('🔴 不丢字符：各段接回去必须等于原文（对任意输入）', () => {
  const inputs = [
    '计算 $x^2$ 的值', '这本书 $5，另一本 $8', '$$x$$', '$$', 'a$b$c$$d$$e',
    '没有公式', '', '$\n$', '$a$ $b$', '结尾是 $',
  ];
  for (const input of inputs) {
    // ⚠️ 用字符串拼接而不是模板串：`` `$${p.tex}$$` `` 在模板串里会被解析成
    //    `$` + 插值 + `$$`（`$$` 只有紧挨 `${` 的那一个才让位给插值），多出一个 `$`
    //    —— 本仓的计划稿里就是这么写的，实测在这里挂了一次。
    const back = splitMath(input).map((p) => (p.kind === 'math' ? '$' + p.tex + '$' : p.text)).join('');
    // ⚠️ 这一条对 `$$` 写法不成立（剥了一层），所以只对**行内**那一批逐字断言。
    if (!input.includes('$$')) assert.equal(back, input, `切完接不回原文：${JSON.stringify(input)}`);
  }
});

test('🔴 `mathText` = 剥掉定界符（判分那一侧要的），与渲染那一侧不是一回事', () => {
  assert.equal(mathText(splitMath('$x=5$')), 'x=5');
  assert.equal(mathText(splitMath('答案是 $x=5$ 或 $x=-5$ 哦')), '答案是 x=5 或 x=-5 哦');
  // 裸 `$` 不动它（它不是公式）
  assert.equal(mathText(splitMath('这本书 $5')), '这本书 $5');
});

test('不跨行：两行各自成公式，但一行里的 `$` 不能跨到下一行去找闭合', () => {
  assert.equal(render('第一行 $x$\n第二行 $y$'), '第一行 【x】\n第二行 【y】');
});
/**
 * ★ 2026-09-30（教师裁定）：公式弹窗的「复制」放上剪贴板的**就是这一串**。
 *
 * 🔴 为什么它值得一条网：教师复制出去之后要粘到**任何**输入框（题干、选项、参考答案、
 *    表格格子），而落下去之后能不能被认成公式，取决于这里的每一个字符。
 *    包错了（多一层 `$`、少了收尾的 `$`）屏幕上**看不出来** —— 粘进去就是一段死源码，
 *    要等到学生端才发现。
 */
test('🔴 `mathMarkup`：源码 → 剪贴板上那一串（带定界符，且能原样切回来）', () => {
  assert.equal(mathMarkup('x^2'), '$x^2$');
  // 前后空白剥掉：教师从别处粘进来常带一个尾巴空格。
  assert.equal(mathMarkup('  x^2  '), '$x^2$');
  // 空 / 只有空白 ⇒ **空串**（不是 `$$` —— 那会被当成一个空公式，渲染出来是个错误标记）。
  assert.equal(mathMarkup(''), '');
  assert.equal(mathMarkup('   '), '');
  // 🔴 **已经带定界符的不重复包**：`$x^2$` 再包一层成 `$$x^2$$` 就换了一层含义
  //（`$$…$$` 是规则 1 的那一档），而屏幕上一样看得见公式。
  assert.equal(mathMarkup('$x^2$'), '$x^2$');
  assert.equal(mathMarkup('$$x^2$$'), '$$x^2$$');
  // 🔴 源码里的换行**折成空格**：`$…$` 不跨行（规则 3），留着换行的那一串
  //    复制出去**永远不会被认成公式**，而屏幕上看不出区别。
  assert.equal(mathMarkup('x\n+1'), '$x +1$');
  assert.equal(mathMarkup('\\frac{1}\n{2}'), '$\\frac{1} {2}$');
  // 往返：包出来的那串切回来必须**正好一段公式**、且 tex 就是原文
  //（这是「点复制 = 一定拿得到能渲染的东西」这条承诺的全部内容）。
  for (const tex of ['x^2', '\\frac{a}{b}', '\\sqrt[3]{x}', 'x_1', '\\begin{cases} x+y=1 \\\\ x-y=3 \\end{cases}', 'x\n+1']) {
    const pieces = splitMath(mathMarkup(tex));
    assert.equal(pieces.length, 1, `${JSON.stringify(tex)} 包出来不是一段：${JSON.stringify(pieces)}`);
    assert.equal(pieces[0].kind, 'math', `${JSON.stringify(tex)} 包出来不是公式`);
    assert.equal(pieces[0].tex, tex.replace('\n', ' '), `${JSON.stringify(tex)} 包出来 tex 变了`);
  }
});
