/**
 * ★ 2026-09-30（教师）：「这里可以提供更多的在初中、小学中会用到的公式符号。」
 *
 * 🔴 这张表**只有数据、没有界面** ⇒ 它是本机唯一能真正验到的那一半
 *    （没有 jsdom、没有浏览器，「按钮画得好不好看」验不了）。
 *    所以「每个按钮点下去到底给出什么」必须全部钉在这里。
 *
 * ⚠️ 它与 `math-symbols.ts` 之间**只差一个 import 路径**，没有别的东西要装。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATH_SYMBOL_GROUPS } from './math-symbols.ts';
import { splitMath, mathMarkup } from '../../../../lib/worksheet-math.ts';

/** 表里全部符号的源码，按组摊平。 */
const allTex = () => MATH_SYMBOL_GROUPS.flatMap((group) => group.symbols.map((symbol) => symbol.tex));

test('阳性对照：表真的被加载起来了（否则下面几条对空表永远绿）', () => {
  // ⚠️ 这个数是**下限**不是精确值：教师随时可以再加符号，加的时候不该来改这一行；
  //    但表被清空、或者 import 拿到个空壳，它必须当场红。
  assert.ok(MATH_SYMBOL_GROUPS.length >= 5, `只有 ${MATH_SYMBOL_GROUPS.length} 组`);
  const total = allTex().length;
  assert.ok(total >= 30, `只有 ${total} 个符号（原来那版是 12 个）`);
});

test('每组有名字、不是空组；每格有源码、有说明', () => {
  for (const group of MATH_SYMBOL_GROUPS) {
    assert.ok(group.label.trim(), '有一组没有名字');
    assert.ok(group.symbols.length > 0, `「${group.label}」是个空组`);
    for (const symbol of group.symbols) {
      assert.ok(symbol.tex.trim(), `「${group.label}」里有一格没有源码`);
      // 🔴 说明不是装饰：它就是那个按钮的 `title` 与 `aria-label`。
      //    少了它，按钮上只有一个小图形，教师看不出是什么、屏幕阅读器也读不出来。
      assert.ok(symbol.title.trim(), `「${group.label}」里的 ${JSON.stringify(symbol.tex)} 没有说明`);
    }
  }
});

test('🔴 每个符号复制出去都必须**正好是一段公式**', () => {
  // 这是整张表存在的意义：点一下 = **一定**拿得到能渲染的东西。
  // 模板里混进一个换行（`$…$` 不跨行）、或者少半个花括号，屏幕上只是「那个按钮画得怪」，
  // 而粘进题干之后是一段**永远不会渲染**的死源码 —— 两边都不报错。
  for (const group of MATH_SYMBOL_GROUPS) {
    for (const symbol of group.symbols) {
      const pieces = splitMath(mathMarkup(symbol.tex));
      assert.equal(pieces.length, 1,
        `「${symbol.title}」(${symbol.tex}) 复制出去不是一段：${JSON.stringify(pieces)}`);
      assert.equal(pieces[0].kind, 'math', `「${symbol.title}」复制出去不是公式`);
      assert.equal(pieces[0].tex, symbol.tex, `「${symbol.title}」复制出去 tex 变了`);
    }
  }
});

test('🔴 教师点名要的四类都在（缺一个就是没交付）', () => {
  const tex = allTex();
  const must = [
    // 几何
    '\\angle', '^\\circ', '\\perp', '\\parallel', '\\triangle', '\\odot', '\\cong', '\\sim',
    // 代数与方程（`\\sqrt[3]{x}` 与方程组按前缀认：它们本身就带花括号）
    '|x|', '\\vec{a}',
    // 推理与集合
    '\\because', '\\therefore', '\\in', '\\notin', '\\cup', '\\cap',
  ];
  for (const item of must) {
    assert.ok(tex.includes(item), `表里少了 ${item}`);
  }
  assert.ok(tex.some(t => t.startsWith('\\sqrt[3]{x}')), '表里少了立方根');
  assert.ok(tex.some(t => t.startsWith('\\begin{cases}')), '表里少了方程组的大括号');
  assert.ok(tex.some(t => t.startsWith('1\\frac')), '表里少了带分数');
});

test('没有两个按钮给出同一段源码（各处分头加符号时最常留的那种重）', () => {
  const seen = new Map<string, string>();
  for (const group of MATH_SYMBOL_GROUPS) {
    for (const symbol of group.symbols) {
      const at = seen.get(symbol.tex);
      assert.equal(at, undefined, `${JSON.stringify(symbol.tex)} 在「${at}」与「${group.label}」里各有一个`);
      seen.set(symbol.tex, group.label);
    }
  }
});
