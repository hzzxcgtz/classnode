/**
 * 第三方画板这一层的**接线**（★ 2026-10-07 教师：「教师的预设图在监控面板里没显示出来」）。
 *
 * 「空不空」「值不值得交」那两条判据住在 `src/lib/worksheet-drawing-document.ts`（纯函数、有真用例）；
 * 这里只钉**这一层接对了没有** —— 尤其是**快照能不能单独成立**那一步：它是组件里的时序问题
 * （靠 `useCallback` 的闭包），本机没有 jsdom，行为验不了，只能把形状钉住。
 *
 * ⚠️ 两条都配了变异（施工时验过：任一条改回旧写法都当场红）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const body = stripComments(fs.readFileSync(path.join(HERE, 'drawing-tool-body.tsx'), 'utf8'));

test('交出作答走 `keepsDrawingDocument` —— 不许退回「只看学生自己那份数据」', () => {
  assert.ok(body.length > 1000, '阳性对照：剥完注释之后剩下的仍是这个组件');
  assert.match(body, /keepsDrawingDocument\(nextDocument\)/, '没有走那条「有快照也算数」的判据');
  /*
   * ⚠️ 组件里**不许**再直接判「空」：底稿按设计不在学生的 `data` 里，
   *    只看 `data` 就会把「底稿 + 学生画的」那张快照一起丢掉 ⇒ 教师面板空白。
   */
  assert.ok(!/drawingDocumentIsEmpty\(/.test(body), '又在组件里直接判「空」了 —— 底稿会被连图一起丢掉');
});

test('★ 快照可以**单独成立** —— 第一张图到达时数据可能还没有', () => {
  const at = body.indexOf('const updateImage = useCallback');
  assert.notEqual(at, -1, 'updateImage 没找到 —— 先修这条判据');
  const updateImage = body.slice(at, body.indexOf('const Surface', at));
  assert.ok(updateImage.length > 80, `updateImage 那段没抠出来（${updateImage.length}）—— 先修这条判据`);
  /*
   * 🔴 原来这里是 `const data = drawingDocument?.data; if (data === undefined) return;` ——
   *    教师设了初始化图、学生还没动笔时，第一张（画着底稿的）快照到达那一刻数据还是空的
   *    ⇒ 直接 return ⇒ 那张图**永远进不来** ⇒ 监控面板一直空着。
   */
  assert.ok(!/if \(data === undefined\) return;/.test(updateImage), '又加回了「没有数据就直接 return」—— 教师设的初始化图永远进不来');
  assert.match(updateImage, /drawingDocument\?\.data \?\? \{\}/, '没有给「数据还没到」留一条路（快照要能单独成立）');
});
