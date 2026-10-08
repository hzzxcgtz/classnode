/**
 * ★ 2026-10-07（教师）：「那两个图标能不能去掉？什么意义。」—— **与库对拍**的判据。
 *
 * 那条 `display: none` 依赖的是**库内部给的 id**（`dist/MindElixir.js` 里那个 `W(id, kind)` 逐字
 * `n.id = e`）。🔴 这是本仓最该防的形状：**依赖第三方内部实现的写法，升级后静默失效** ——
 * 按钮又回来了，而没有任何报错、没有任何用例会红。
 * ⇒ 所以这条判据去读**库的产物**，两边对拍：库改了 id 名字 ⇒ 它先红，而不是悄悄失效。
 *
 * ⚠️ 它证的是「CSS 与库对得上」，**不证**屏幕上真的看不见了（那要真机）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = fs.readFileSync(
  path.resolve(HERE, '../../../../node_modules/mind-elixir/dist/MindElixir.js'), 'utf8');
const CSS = fs.readFileSync(path.join(HERE, 'worksheet.module.css'), 'utf8');
const SURFACE = fs.readFileSync(path.join(HERE, 'questions', 'drawing-surfaces', 'mindmap-drawing.tsx'), 'utf8');

test('🔴 库仍然用那两个 id 造按钮（改了名字这条会红，而不是静默失效）', () => {
  assert.match(LIB, /W\("fullscreen",\s*"full"\)/,
    '库不再用 `fullscreen` 这个 id 造「全屏」按钮了 —— 下面那条 CSS 已经失效（按钮会重新出现）');
  assert.match(LIB, /W\("toCenter",\s*"living"\)/,
    '库不再用 `toCenter` 这个 id 造「回到中心」按钮了 —— 上面那条 CSS 已经失效');
});

test('★ 右下库工具条整体隐藏，视图操作进入统一的分组工具栏', () => {
  assert.match(CSS, /\.mindmapCanvas :global\(\.mind-elixir-toolbar\.rb\)\s*\{\s*display:\s*none/);
  for (const label of ['放大', '缩小', '适应画布']) {
    assert.ok(SURFACE.includes(`aria-label="${label}"`), `统一工具栏缺少「${label}」`);
  }
  assert.match(SURFACE, /instance\.scaleFit\(\); instance\.toCenter\(\)/,
    '适应画布没有同时缩放并居中');
});

test('★ 藏的写法是 `display: none`，方向工具条仍由库提供', () => {
  const at = CSS.indexOf('.mind-elixir-toolbar.rb');
  const rule = CSS.slice(at, CSS.indexOf('}', at));
  assert.match(rule, /display:\s*none/);
  assert.match(SURFACE, /toolBar: true/, '库的方向工具条也被关掉了');
});
