/**
 * ★ 2026-09-30（基本图形工具）：学生端工具栏的**默认档**。
 *
 * 🔴 本仓没有 jsdom、没有浏览器 ⇒「点了那个按钮会不会换档」在本机**验不了**。
 *    这一条网能回答的只有：**默认档是从判据层拿的、而不是随手写的一个字面量**。
 *    ⚠️ 真机走查要看的：进题目直接画能不能画出线（默认档是不是手写）、
 *       十一个按钮在 iPad 竖屏下换不换行、当前档看不看得出高亮。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BODY = fs.readFileSync(path.join(HERE, 'ink-body.tsx'), 'utf8');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const body = stripComments(BODY);

test('🔴 默认档从判据层拿（`INK_DEFAULT_TOOL`），不是随手写的一个字面量', () => {
  assert.ok(body.length > 1000, '阳性对照：剥完注释之后剩下的仍是这个组件');
  // 判据层那条常量自己有用例钉着「= 'pen'」（`worksheet-ink.test.ts`）。
  // 这里钉的是**这一侧接上了没有**：写一个 `useState('pen')` 字面量就成了第二份真源，
  // 而判据层把默认值改掉时这一侧不会跟着动（屏幕上只是「进题目画不出线」）。
  assert.match(body, /useState<InkTool>\(INK_DEFAULT_TOOL\)/, '默认档没有从 INK_DEFAULT_TOOL 拿');
  // 工具栏要把**全部**档画出来（漏一个 = 那个图形没有入口，而屏幕上只是「少一个按钮」）。
  assert.ok(body.includes('INK_TOOLS.map('), '工具栏没有遍历 INK_TOOLS');
  // 只读态（教师端预览渲染同一个组件）整排禁用，但一个都不少。
  assert.ok(body.includes('aria-pressed={tool === item}'), '当前档没有可读的状态（aria-pressed）');
});

test('★ 选中态：离开「选择」档要清掉，撤销/清空也要清掉（否则会删错东西）', () => {
  // ★ 2026-09-30（教师选「甲」）。
  // 🔴 两条都是**静默**的：选中是画上去的虚线框，而「谁被选中」是一个**下标** ——
  //    · 切回手写继续画之后还圈着旧图形 ⇒ 学生点一下删除会删掉一个自己没在看的图形；
  //    · 撤销/清空让 `strokes` 少了几笔 ⇒ 那个下标指向**别的图形**（或者指空）。
  //    屏幕上只是「删除删错了」/「点了没反应」，两边都不报错。
  assert.match(body, /if \(next !== 'select'\) setSelected\(null\)/, '换档时没有清掉选中');
  assert.equal((body.match(/setSelected\(null\); transform\(/g) ?? []).length, 2,
    '撤销与清空都必须清掉选中（两条路各一处）');
});

test('★ 删除按钮：**只在「选择」档且真的选中了**才渲染，而且有可读的名字', () => {
  // 🔴 一个永远在、点了没反应的删除按钮会让学生以为它坏了。
  assert.match(body, /tool === 'select' && selected !== null/, '删除按钮不是在「选中了才出现」的条件下渲染');
  assert.ok(body.includes('删除选中的图形'), '删除按钮没有可读的名字（文字本身就是它的无障碍名）');
  // 删除走的是**同一条** onChange（与撤销/清空同一条纪律：不存在「按钮改了别处没改」）。
  assert.match(body, /onChange\(\{ kind: 'ink', box, strokes: next \}\)/, '删除没有走那条唯一的写入口');
});

test('★ 选择档的命中判据来自判据层（`hitTestStroke`），不是组件自己算', () => {
  const canvas = fs.readFileSync(path.join(HERE, '..', 'ink-canvas.tsx'), 'utf8');
  const stripped = stripComments(canvas);
  assert.ok(stripped.includes('hitTestStroke('), '画布没有用判据层的命中测试');
  assert.ok(stripped.includes('strokeHandles('), '画布没有用判据层的控制点');
  assert.ok(stripped.includes('moveStroke(') && stripped.includes('resizeStroke('),
    '移动/改大小没有走判据层 —— 组件这一层没有回归网，几何必须留在那儿');
});
