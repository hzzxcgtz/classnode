/**
 * ★ 独立审查 2026-09-25 抓到（Critical）：**按钮里的装饰件必须跟随文字色，不能写死颜色。**
 *
 * 🔴 为什么要有它：M6b/13 给「提交中…」加的那个旋转圈，初版把颜色写死成白色
 * （`border: 2px solid rgba(255,255,255,.45); border-top-color: #fff`）。
 * 在**主**提交按钮上没问题（`background: var(--ws-accent)` + `color: #fff`），
 * 但这个按钮在「已提交过」时会切成 `.submitButtonResubmit` —— **`background: #fff`**。
 * 两条规则同时命中同一个按钮 ⇒ **白底上的白圈，等于没加**，
 * 而且 `:disabled { opacity: .5 }` 让它更淡。**本机看不见界面，这个缺陷只能靠读级联发现。**
 *
 * ⇒ 立的规矩：按钮里的装饰件（旋转圈、图标、角标）**颜色一律从 `currentColor` 派生**，
 * 因为它所在的按钮底色会变（这个文件今天就有两种）。写死颜色 = 换一个按钮态就失效。
 *
 * ⚠️ 只读 CSS 文本 ⇒ 本机跑得起来。⚠️ 「屏幕上到底看不看得见」仍需真机（对比度、渲染差异）。
 *
 * ⚠️ 本用例**只读源码**，而压缩器会把 `border: 2px solid currentColor` 压成 `border: 2px solid`
 * —— 因为 `currentColor` 是 `border-color` 的**初始值**，省掉它语义不变（产物已复验）。
 * 所以这里查的是**书写约定**：颜色要显式写出来，让人一眼看出「它跟着文字色走」。
 * ⇒ 如果将来有人写 `border: 2px solid`（等价且正确），本用例会红并提示补上 `currentColor` ——
 * 那是刻意的：省掉的那一版**看起来**像忘了写颜色。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(HERE, 'worksheet.module.css'), 'utf8');

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/** 取一条类规则的正文。 */
function ruleBody(css: string, cls: string): string | null {
  const stripped = stripComments(css);
  const start = stripped.indexOf(`.${cls} {`);
  if (start === -1) return null;
  return stripped.slice(start, stripped.indexOf('}', start));
}

/** 装饰件：跟着按钮一起出现的小可视件。今天只有 `.spinner`。 */
const ADORNMENTS = ['spinner'];

/**
 * 取出所有**会带颜色**的声明值。
 * ⚠️ 必须是显式白名单：初版写成 `border|border-[a-z]+`，于是把 `border-radius: 50%`
 * 也当成了颜色（值 `50%` 当然不含 `currentColor`）⇒ **判据自己误报了**。
 * 白名单里每一项后面都紧跟 `:`，所以 `border-radius` 不会被 `border` 命中。
 */
const COLOR_PROPS = [
  'color', 'background', 'background-color', 'border', 'border-color',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline', 'outline-color', 'fill', 'stroke', 'box-shadow', 'caret-color',
].join('|');

function colorValues(css: string): string[] {
  const re = new RegExp(`(?:^|[;{\\s])(?:${COLOR_PROPS})\\s*:\\s*([^;}]+)`, 'g');
  return [...css.matchAll(re)].map((m) => m[1].trim());
}

/** 与 `currentColor` 无关的颜色值（`transparent` 按定义与背景无关，放行）。 */
function hardcodedColors(css: string): string[] {
  return colorValues(css).filter((v) => !/^transparent$/.test(v) && !/currentColor/.test(v));
}

test('★ 按钮里的装饰件颜色必须来自 currentColor（按钮底色会变，写死颜色会失效）', () => {
  for (const cls of ADORNMENTS) {
    const body = ruleBody(CSS, cls);
    assert.notEqual(body, null, `阳性对照：\`.${cls}\` 必须存在（否则本用例空转全绿）`);
    const values = colorValues(body!);
    assert.ok(values.length > 0, `\`.${cls}\` 应当声明了颜色（一条都没有说明本用例量错了对象）`);
    assert.deepEqual(
      hardcodedColors(body!),
      [],
      `\`.${cls}\` 有写死的颜色 —— 它所在的按钮有白底变体（.submitButtonResubmit），那个变体上会隐形`,
    );
  }
});

test('反证：写死白色的装饰件必须被判红（这就是修复前那一版）', () => {
  const before = '.probe { border: 2px solid rgba(255, 255, 255, .45); border-top-color: #fff; }';
  assert.deepEqual(hardcodedColors(before), ['2px solid rgba(255, 255, 255, .45)', '#fff'], '写死白色必须被判定为不合格');
});

test('反证：`border-radius` / `border-style` 不算颜色（判据自己误报过一次）', () => {
  const trap = '.probe { border-radius: 50%; border-width: 2px; border-style: solid; }';
  assert.deepEqual(colorValues(trap), [], '半径/宽度/线型都不是颜色，一条都不该被取到');
});

test('反证：`transparent` 与 `currentColor` 都不算写死颜色（否则正确的写法会被误报）', () => {
  const ok = '.probe { border: 2px solid currentColor; border-top-color: transparent; }';
  assert.deepEqual(hardcodedColors(ok), [], '这套写法必须全过');
});
