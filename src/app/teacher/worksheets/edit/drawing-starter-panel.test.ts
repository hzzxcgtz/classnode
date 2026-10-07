/**
 * 教师端「底稿」面板（★ 2026-10-06，教师：「学生可以完全从空白开始画，也可以在教师准备好的基础上继续画」）。
 *
 * 🔴 这是**源码级**用例（本仓没有前端渲染测试）：它盯的是三件「错一处就静默失效」的接线 ——
 *    · 面板只在该工具档出现（试点是流程图）；
 *    · 用的必须是**学生那块画板**（同一份数据形状），不是另写一套；
 *    · 写回去的是 `drawingStarter`，而且带上 `tool`（学生端按它判断要不要合并）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(import.meta.dirname, 'bodies', 'drawing-settings.tsx');
const source = fs.readFileSync(FILE, 'utf8');
/**
 * 与 `surface-lifecycle.test.ts` 同一份剥注释规则（本仓的注释都写在整行上）。
 * ⚠️ 「这一档已经删掉」这件事**写在注释里**（给下一个人看的历史），所以那几条「不许存在」的
 *    判据必须在**剥掉注释之后**判 —— 否则守的就变成「注释里也不许提这个词」，那是钉格式。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('阳性对照：这份源码确实读到了（否则下面几条在空串上永远绿）', () => {
  assert.ok(source.length > 500, 'drawing-settings.tsx 没读到');
  assert.match(source, /DrawingSettings/, '这不是那个组件');
});

test('★ 底稿面板：用学生的画板、写回带 tool 的 drawingStarter、有开关', () => {
  // ① 用的是学生那块画板（同一份数据 ⇒ 教师画的就是学生要接着画的那份）。
  assert.match(source, /import FlowchartDrawing from '@\/app\/classroom\/worksheet\/questions\/drawing-surfaces\/flowchart-drawing'/, '没有复用学生端的画板组件（它是默认导出）');
  // ② 写回 `drawingStarter`（带 tool！学生端按 `starter.tool === 'flowchart'` 判断要不要合并）。
  assert.match(source, /drawingStarter: \{ tool: 'flowchart', data: next \}/, '写回的形状不对（缺 tool 学生端会直接忽略）');
  // ③ 开关（教师 2026-10-06：「底稿要设一个开关」）：勾上落一份空底稿让画板立刻出现，取消清掉。
  assert.match(source, /type="checkbox"[\s\S]{0,200}?role="switch"[\s\S]{0,120}?checked=\{!!starter\}/, '没有「要不要设底稿」的开关');
  assert.match(source, /drawingStarter: undefined/, '取消开关没有清掉底稿');
  assert.match(source, /window\.confirm/, '已经有底稿时取消没有确认 —— 一次误点就丢一张图');
  // ④ 画板要有明确高度：它靠量出容器尺寸才初始化（这条路径我们修过两次：scale(0) / overflowHidden）。
  assert.match(source, /height: 380/, '底稿画板没有给固定高度 —— 量不出尺寸它不会初始化');
  // ⑤ 还没接好的档位要说清楚，而不是给一个画不了东西的空框。
  // ★ 2026-10-07：这一档的说明跟着「初始图推广到两档」改了 ——
  //   原来写的是「目前只支持流程图」，现在是「支持流程图与思维导图」。
  assert.match(source, /初始图目前支持/, '这两档之外的画板（数学作图 / 自由画）没有说明');
});

test('★ 2026-10-06（教师最终拍板）：「锁定初始图」开关**不许存在**（连同它的副说明）', () => {
  /*
    🔴 教师原话：「我觉得教师把初始图锁定也不对，这样学生端很多操作都无法进行了，我觉得还是不要
       锁定，因为学生端已经有恢复初始图功能了。」
    ⇒ 面板上**没有**这个开关、也没有那句副说明；写回那个字段的纯函数也不再被引用。
    ⚠️ 这条判据是**单档语义**里教师端那一半，不是「删空」：它同时要求「初始图」那块**还在**
      （`{starter ? (` 那段必须在、画板必须在），只是不再有锁这一档。
    ⚠️ 反面对照见本轮报告的变异测试（把开关加回来 ⇒ 必须红）。
  */
  // ① 面板上不许再出现「锁定初始图」这个词、那个写回函数、以及那个字段名（**剥掉注释之后**判：
  //    「这一档已经删掉」这句话本身写在注释里）。
  const code = stripComments(source);
  assert.ok(!/锁定初始图/.test(code), '「锁定初始图」开关（或它的副说明）又回来了 —— 教师已经拍板撤掉这一档');
  assert.ok(!/drawingStarterLockPatch/.test(code), '还在用 `drawingStarterLockPatch` 往题目上写「锁定」那个字段');
  assert.ok(!/drawingStarterLocked/.test(code), '还在读/写题目上那个历史的「锁定」字段（学生端一律忽略它，教师端更不该碰）');
  // ② 副说明那句具体的话也不许留（它讲的是「锁了会怎么样」，现在没有那一档了）。
  assert.ok(!/学生只能添加，不能修改或删除你给的框与连线/.test(code), '锁定那一档的副说明还留着（面板上会讲一件不存在的事）');
  // ③ 「要不要设底稿」那个开关**必须还在**（撤的是「锁定」，不是初始图本身）。
  assert.match(code, /checked=\{!!starter\}/, '「要不要设底稿」那个开关被误删了');
  assert.match(code, /\{starter \? \(/, '「这一题有初始图」那一支被误删了（初始图面板整块没了）');
  assert.match(code, /drawingStarter: \{ tool: 'flowchart', data: next \}/, '写回底稿的接线被误删了');
  // ⚠️ 反面对照：把那个开关块塞回去 ⇒ 上面那条必须红（证明它不是恒真）。
  // ★ 2026-10-07：锚点跟着那次改动挪了 —— 现在 `{starter ? (` 之后的第一支是
  //   「底稿属于别的画板」（`starter.tool !== tool`），不是原来的 `tool === 'flowchart'`。
  const switchBack = code.replace(
    "{starter ? (\n          starter.tool !== tool ? (",
    "{starter ? (\n          <label className=\"worksheet-editor-drawing-switch\"><input type=\"checkbox\" role=\"switch\" checked={starter.locked} /><span>锁定初始图</span></label>\n          starter.tool !== tool ? (",
  );
  assert.notEqual(switchBack, code, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(/锁定初始图/.test(switchBack), '反面对照没被抓住 —— 这条判据是恒真的');
});

test('★ 2026-10-06（教师）：照片上传时整块隐藏；两个区域改成紧凑样式', () => {
  const css = fs.readFileSync(path.resolve(import.meta.dirname, '..', '..', '..', 'globals.css'), 'utf8');
  // ① 作答方式 = 照片上传 ⇒ 工具/底图/底稿一个都不参与（留一句解释 + 指路）。
  assert.match(source, /node\.inputMode === 'photo'/, '没有读作答方式');
  assert.match(source, /if \(photo\) \{[\s\S]*?return \(/, '照片上传时没有提前返回（内容还露在外面）');
  const photoBlock = source.slice(source.indexOf('if (photo) {'), source.indexOf('const selectedTool'));
  for (const gone of ['DRAWING_TOOL_OPTIONS.map', 'DRAWING_BACKGROUND_PRESETS.map', 'FlowchartDrawing']) {
    assert.ok(!photoBlock.includes(gone), `照片上传时还渲染了 ${gone}`);
  }
  assert.match(photoBlock, /不使用作图工具、画布底图和初始图/, '照片上传时没有告诉教师为什么是空的');
  // ② 两个区域改成：选项只留名字 + 选中项在下面一行说明 + 缩略图行。
  assert.match(source, /className="worksheet-editor-drawing-tools"/, '作图工具没有换成紧凑的按钮行');
  assert.match(source, /className="worksheet-editor-drawing-swatches"/, '画布底图没有换成缩略图行');
  assert.match(source, /const selectedTool = DRAWING_TOOL_OPTIONS.find/, '没有「选中的那一项」的说明行');
  assert.match(source, /const selectedBackground = background\.preset === 'custom'/, '底图那一项没有说明行');
  // ⚠️ 反面：**不许**再回到「每张卡两行说明」的老样子（那正是不占空间要解决的问题）。
  const toolsBlock = source.slice(source.indexOf('drawing-tools'), source.indexOf('drawing-swatches'));
  assert.ok(!/<small>/.test(toolsBlock), '作图工具又给每张卡加了说明文字');
  // ③ 样式在这一层收紧（覆盖，不重写上面的基础规则）。
  for (const rule of ['.worksheet-editor-drawing-tools', '.worksheet-editor-drawing-swatch-preview', '.worksheet-editor-drawing-switch', '.worksheet-editor-drawing-note']) {
    assert.ok(css.includes(rule), `globals.css 里少了 ${rule}`);
  }
});
