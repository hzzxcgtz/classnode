/**
 * ★ 2026-10-06（术语）：学生端那颗「连到线上时插进线里的小圆点」，**信息科技课教材里叫「连接点」**。
 *
 * 🔴 为什么要有这一条：产品的内部名字是 `junction`，注释里一直写「交点」；而「交点」在数学课上
 *    指的是**两条线相交的那个点** —— 与流程图里「线汇合处的小圆点」是两回事。学生按教材的词去找，
 *    所以**学生看得见的字**必须统一成「连接点」。
 *
 * ⚠️ 这一条是**语义**网（钉「学生看得见的字符串里用哪个词」，不钉措辞）：
 *    · 判据一：`flowchart-drawing.tsx` **剥掉注释之后**不许再出现「交点」——
 *      这个画板里那个词只可能指那颗小圆点（它没有「两线相交」这种几何功能），
 *      所以「交点」落在哪儿都是学生看得见的一处（JSX 文本 / aria-label / title / 提示语）。
 *    · 判据二：**提到连接点的那两句提示语**必须用「连接点」（画布工具条的提示格 + 题干下的模式说明）。
 *      抠出来的是**字符串字面量** ⇒ 改措辞、换说法都不会红；把词换回「交点」、或把提示整条删掉才红。
 *    ⚠️ 这里**只**判「流程图 / 思维导图」那两行模式说明：`mode === 'math'` 那句讲的是数学作图，
 *      将来完全可能**合法**地出现「交点」（两条线的交点）⇒ 拿它当全局禁词是过界。
 * ⚠️ 内部标识符（`junction` / `junctionId` / `kind: 'junction'` / `JUNCTION_*` / `.flowNode_junction`
 *    这类 CSS 类名）**一律不判**：它们是**数据契约**，改了会破坏已存作答；这一条只判给学生看的字。
 * ⚠️ 注释里的「交点」**故意不判**（本文件先把注释剥掉）：注释是给开发者的，而且源码里首次出现处
 *    已经注明「界面上叫『连接点』」；用正则去钉注释措辞属于钉格式，不是钉行为。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FLOWCHART = fs.readFileSync(path.join(HERE, 'flowchart-drawing.tsx'), 'utf8');
const INK_BODY = fs.readFileSync(path.resolve(HERE, '..', 'ink-body.tsx'), 'utf8');

/** 与 `surface-lifecycle.test.ts` / `ink-body.test.ts` 同一份剥注释规则（本仓的注释都写在整行上）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
/** 从 `startMarker` 切到它之后的 `endMarker`；切不出来回**空串**（让用例自己报错，不许静默全绿）。 */
function blockAfter(source: string, startMarker: string, endMarker: string): string {
  const at = source.indexOf(startMarker);
  if (at === -1) return '';
  const end = source.indexOf(endMarker, at + startMarker.length);
  return end === -1 ? '' : source.slice(at, end);
}
/** 一块 JSX 里出现的**字符串字面量**（单引号那一套；本仓的可见文案都在这里）。 */
function quotedIn(block: string): string[] {
  return [...block.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

const flowchartCode = stripComments(FLOWCHART);
/** 学生看得见的那些字里，还有没有把那个小圆点叫「交点」。 */
const namesItACrossingPoint = (source: string): boolean => stripComments(source).includes('交点');

test('★ 判据一：流程图画板里、学生看得见的地方不许再出现「交点」（改叫「连接点」）', () => {
  // 阳性对照：剥完注释之后剩下的仍然是这个组件（否则下面全在空串上判，假绿）。
  assert.ok(flowchartCode.length > 5000, '阳性对照：剥完注释之后剩下的仍是这个组件');
  const hits = flowchartCode.match(/.{0,24}交点.{0,24}/g) ?? [];
  assert.deepEqual(hits, [], `学生看得见的文案里还写着「交点」：${hits.join(' ／ ')}`);
  // 而且那个词要**真的用上**：工具条提示里得有「连接点」（学生按教材的词找得到它）。
  assert.ok(flowchartCode.includes('连接点'),
    '流程图工具条的提示语没有用「连接点」—— 学生按教材里那个词找不到它');
  // ⚠️ 反面对照（等同于本轮的变异检验）：把**看得见的那一处**「连接点」换回「交点」⇒ 必须抓住它。
  //    ⚠️ 变异要做在 `flowchartCode`（已剥注释）上，不能做在 `FLOWCHART` 上：源码里**第一个**
  //    「连接点」落在注释（那段术语对照）里，剥掉之后才轮到提示语那一处。
  const mutatedVisibleText = flowchartCode.replace('连接点', '交点');
  assert.notEqual(mutatedVisibleText, flowchartCode,
    '反面对照没造出来（看得见的文案里已经没有「连接点」了）—— 这条判据会变成恒真');
  assert.ok(namesItACrossingPoint(mutatedVisibleText), '反面对照没被抓住 —— 这条判据是恒真的');
});

test('★ 判据二：提到它的两句提示语必须用「连接点」', () => {
  // ① 画布工具条那一格（点空白时那句「……即可连线」）。
  const toolbarHint = blockAfter(flowchartCode, 'styles.drawingToolbarHint', '</span>');
  assert.ok(toolbarHint.length > 40, '流程图工具条的提示格没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const toolbarStrings = quotedIn(toolbarHint);
  assert.ok(toolbarStrings.some((text) => text.includes('连接点')),
    '工具条的提示没有把那颗小圆点叫「连接点」');
  assert.ok(!toolbarStrings.some((text) => text.includes('交点')),
    `工具条的提示里还写着「交点」：${toolbarStrings.filter((text) => text.includes('交点')).join(' ／ ')}`);
  // ② 题干下面那句模式说明（流程图 / 思维导图两行）—— 抠**字符串字面量**，不钉整句措辞。
  const modeLines = [...stripComments(INK_BODY).matchAll(/\{mode === '(flowchart|mind-map)' && '([^']*)'\}/g)]
    .map((match) => ({ mode: match[1], text: match[2] }));
  assert.equal(modeLines.length, 2,
    `题干下的模式说明没抠出两行（抠到 ${modeLines.length} 行）—— 先修这条判据，别让它在空串上全绿`);
  for (const { mode, text } of modeLines) {
    assert.ok(text.includes('连接点'), `${mode} 那句说明没有把连接点叫「连接点」`);
    assert.ok(!text.includes('交点'), `${mode} 那句说明里还写着「交点」：${text}`);
  }
});
