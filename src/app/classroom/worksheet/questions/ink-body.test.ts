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

test('★ 选择档的判定全部来自判据层，而且**控制点要排在轮廓命中之前**', () => {
  const canvas = fs.readFileSync(path.join(HERE, '..', 'ink-canvas.tsx'), 'utf8');
  const stripped = stripComments(canvas);
  for (const fn of ['pickInkHandle(', 'pickInkStroke(', 'moveStroke(', 'resizeStroke(', 'isShapeTooSmall(']) {
    assert.ok(stripped.includes(fn), `画布没有用判据层的 \`${fn.slice(0, -1)}\``);
  }
  // 🔴 **顺序**才是要害（2026-09-30 复审抓出来的核心缺陷）：
  //    先轮廓命中、再找控制点 ⇒ 椭圆/三角形/梯形/平行四边形/直角三角形的控制点
  //    （外接框的角，落在轮廓外面 ≈30～75px）**永远找不到**，一按就 `onSelect(null)`。
  //    ⇒ 控制点必须先判。
  const selectAt = stripped.indexOf('INK_TOOL_SELECT');
  const handleAt = stripped.indexOf('pickInkHandle(', selectAt);
  const strokeAt = stripped.indexOf('pickInkStroke(', selectAt);
  assert.ok(handleAt >= 0 && strokeAt >= 0, '找不到选择档里的两个挑选函数');
  assert.ok(handleAt < strokeAt,
    '控制点判定必须排在轮廓命中**之前** —— 排在后面的话，那五个图形的控制点一按就丢掉选中');
  // 几何不许在组件里自己算（这一层没有回归网）。
  assert.ok(!/Math\.hypot\(/.test(stripped.slice(selectAt, strokeAt + 400)),
    '选择档里的几何是组件自己算的 —— 应该走判据层');
});

test('★ 工具栏：图标按钮**每一个都有可读的名字**（图标按钮的硬规矩）', () => {
  // ★ 2026-09-30（教师：「UI 你不考虑的吗？」）⇒ 十一个档换成**图标**。
  // 🔴 图标按钮没有可见文字 ⇒ **`aria-label` 是它唯一的名字**：少了它，
  //    读屏用户听到的是十一个「按钮」。设计规范里这条是硬规矩。
  assert.ok(body.includes('aria-label={TOOL_LABELS[item]}'), '工具按钮没有 aria-label（读屏读不出来）');
  assert.ok(body.includes('aria-label={`${WIDTH_LABELS[index]}笔`}'), '粗细按钮没有 aria-label');
  // 图标本身对读屏是**噪音**（形状已经由按钮的名字说了）⇒ 要 `aria-hidden`。
  // ⚠️ **只看 ToolIcon 那个函数体**：文件里还有一处 `aria-hidden`（粗细按钮里那个圆点），
  //    查整个文件的话「把工具图标的 aria-hidden 删掉」照样绿 —— 变异检验抓出来的假绿。
  const iconAt = body.indexOf('function ToolIcon(');
  assert.ok(iconAt >= 0, '找不到 ToolIcon');
  const iconFn = body.slice(iconAt, body.indexOf('\n}', iconAt));
  assert.ok(iconFn.includes('aria-hidden="true"'), '工具图标没有 aria-hidden —— 读屏会多念一段路径');
});

test('★ 粗细三档：当前档要看得见（aria-pressed），而且只影响新画的笔', () => {
  assert.ok(body.includes('INK_WIDTH_OPTIONS.map('), '粗细没有遍历判据层的三档');
  assert.match(body, /aria-pressed=\{width === option\}/, '当前粗细档没有可读的状态');
  // 🔴 它是**新笔画**的参数，不该写进 draft（写进去就成了「作答数据的一部分」，
  //    而换一次粗细会进撤销栈 —— 学生按撤销会撤销掉「换粗细」而不是一笔画）。
  assert.ok(!/onChange\(\{[^}]*width[^}]*\}/.test(body), '粗细被写进了作答数据（它只该影响新笔画）');
});

test('★ 颜色：八色从判据层来；**选中元素时点颜色 = 改那个元素**', () => {
  // ★ 2026-09-30（教师：「还缺少颜色工具」+ 选了「八色固定色板」那一档）。
  assert.ok(body.includes('INK_PALETTE.map('), '色板没有遍历判据层的八色');
  assert.ok(body.includes('aria-label={`${swatch.label}色`}'), '色块没有可读的名字（它只有一块颜色）');
  assert.match(body, /aria-pressed=\{color === swatch\.value\}/, '当前色没有可读的状态');
  // 🔴 **选中之后点颜色要改那个元素** —— 少了它，学生想改一个画错的颜色只能删掉重画。
  assert.match(body, /index === selected \? \{ \.\.\.stroke, color: next \}/,
    '选中元素时点颜色没有改它');
  // 🔴 而颜色**不是整幅画的属性**：它是每个元素各自的字段（与粗细同一条纪律）。
  //    写进 draft 的顶层就成了「换一次颜色进一次撤销栈」，而那不是学生做的动作。
  assert.ok(!/onChange\(\{[^}]*\bcolor:/.test(body), '颜色被写成了整幅画的属性');
});
