/**
 * 首页卡片：**CSS 读的每一个 `--card-*` 变量，`student-home.tsx` 都必须设。**
 *
 * 🔴 它为什么存在 —— 2026-09-27（v6 改版）我自己就写错过一次：卡片改成「每个模块一套浅色」
 * 之后，CSS 那侧读了 8 个自定义属性（底 / 分隔线 / 信息块 / 药丸 / 圆托两个 / 主色两个），
 * 而 JSX 里只传了 4 个。**后果是静默的**：`.card` 给 8 个都写了蓝色兜底值 ⇒ 学习单、探究空间、
 * 学伴三张卡里有两张**长得跟学习单一样**（都是蓝的），而 `tsc` / `eslint` / 构建 / 屏幕上的
 * 报错——**一个都没有**。变量名是字符串，没有任何工具会核对它们。
 *
 * 这一族失效的形状与 `editor-classes.test.ts` 那条是同一个：**名字对不上，而没人问**
 * （那条守的是「JSX 写的类名在 CSS 里有没有定义」，这条守的是「CSS 读的变量在 JSX 里有没有设」）。
 * 两处都很久没有网。
 *
 * ⚠️ 只读文本、不渲染任何东西 ⇒ 本机（无 jsdom、无浏览器）跑得起来。
 * ⚠️ 它**不查颜色对不对、好不好看** —— 那只能在真机上看。
 *    它只回答一个问题：**这个名字有没有人给它赋值。**
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, 'home.module.css'), 'utf8');
const TSX = fs.readFileSync(path.join(HERE, 'student-home.tsx'), 'utf8');

/** CSS 里 `var(--card-…)` 读到的所有变量名（含带兜底值的那些）。 */
function varsReadByCss(css: string): Set<string> {
  return new Set([...css.matchAll(/var\((--card-[a-z-]+)/g)].map((match) => match[1]));
}

/** `student-home.tsx` 里以 `'--card-…':` 形式**设过值**的变量名。 */
function varsSetByComponent(source: string): Set<string> {
  return new Set([...source.matchAll(/'(--card-[a-z-]+)'\s*:/g)].map((match) => match[1]));
}

test('🔴 CSS 读的每个 `--card-*` 都在首页里设过（漏一个 ⇒ 那张卡静默变成蓝色的）', () => {
  const read = varsReadByCss(CSS);
  const set = varsSetByComponent(TSX);
  const missing = [...read].filter((name) => !set.has(name)).sort();
  assert.deepEqual(
    missing, [],
    `这些变量 CSS 在读、而 student-home.tsx 没有设 ⇒ 它们会落到 home.module.css 里写死的`
    + `蓝色兜底值（三张卡里有一张长得跟学习单一样），且没有任何报错：\n  ${missing.join('\n  ')}`,
  );
});

test('阳性对照：这条网真的看得见两边的变量名（否则上面那条对空集合永远绿）', () => {
  // 左边：从 CSS 里抠得出来（带兜底与不带兜底两种写法都要认）。
  const read = varsReadByCss('.a { color: var(--card-pill); background: var(--card-line, #fff); }');
  assert.ok(read.has('--card-pill'));
  assert.ok(read.has('--card-line'), '带兜底值的 `var(--x, 默认)` 也要算进去');
  // 右边：从 TSX 里抠得出来（模板串里的那种写法**不算** —— 它设不出确定的变量名）。
  const set = varsSetByComponent("style={{ '--card-accent': x, '--card-line': y }}");
  assert.ok(set.has('--card-accent'));
  assert.ok(set.has('--card-line'));
  assert.equal(set.size, 2, '不该把别的东西误算进来');
  // 而且它**不该**把别的变量误算进来（前缀是这一页自己的）。
  assert.equal(varsReadByCss('.a { color: var(--ws-accent); }').size, 0);
});

test('🔴 两边的变量名都非空 —— 空了的话上面那条会退化成「对空集合恒真」', () => {
  assert.ok(varsReadByCss(CSS).size >= 8, 'CSS 侧至少要读 8 个（每个模块一套浅色）');
  assert.ok(varsSetByComponent(TSX).size >= 8, '组件侧至少要设 8 个');
});

/* ── 插画素材 ─────────────────────────────────────────────────────────────── */

/** `module-meta.tsx` 里三个模块的 `iconSrc`。⚠️ 文本级提取：那边有 JSX，`node --test`
 *  加载不了它（React 运行期 import），而这里要核对的只是一个**文件路径**。 */
function iconSources(): string[] {
  const meta = fs.readFileSync(path.resolve(HERE, '../module-meta.tsx'), 'utf8');
  return [...meta.matchAll(/iconSrc:\s*'([^']+)'/g)].map((match) => match[1]);
}

test('🔴 三张卡的插画文件真的在 `public/` 里（路径打错 = 学生看到一张破图，而没有任何报错）', () => {
  const sources = iconSources();
  assert.equal(sources.length, 3, '三个模块各一个图标');
  const publicDir = path.resolve(HERE, '../../../../public');
  for (const src of sources) {
    const file = path.join(publicDir, src.replace(/^\//, ''));
    assert.ok(fs.existsSync(file), `卡片要用的图不在磁盘上：public${src}`);
    assert.ok(fs.statSync(file).size > 0, `图是空文件：public${src}`);
  }
  // ⚠️ v6 那一版要的是**插画**（384px WebP、透明底、圆底由 CSS 画）。
  //    回到那批 192px 的合成图（`assets/`）会在 iPad 的 2x 屏上被放大发虚 —— 那是选
  //    `originals` 而不是 `assets` 的唯一理由，写在这里免得下次被「顺手统一」回去。
  for (const src of sources) assert.match(src, /^\/images\/module-icons\/v6\/.+\.webp$/);
});
