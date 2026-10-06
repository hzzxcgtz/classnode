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
  assert.match(source, /初始图目前只支持/, '非流程图档没有说明');
});

test('★ 2026-10-06（教师）：「锁定初始图」开关 —— 默认锁、只在有初始图时出现、写回 drawingStarterLocked', () => {
  /*
    🔴 信息科技课作业的常态是「老师给一半，学生只补连线，不许动老师的框」⇒ 默认就是**锁**：
      题目数据上那个字段**缺席 = 锁定**，教师**取消锁定**时才写 `false`。
    ⚠️ 字段名 / 有没有写反**不在这里验**（源码正则猜不出数据语义）—— 那两条由
      `src/lib/worksheet-drawing-starter.test.ts` 里那条**真调用**的往返用例守
      （`drawingStarterLockPatch(false)` ⇒ `{ drawingStarterLocked: false }` ⇒ 读回来 locked === false）。
      这里只守**接线**：这个开关接到了那个纯函数上、默认值取自 `starter.locked`、没有初始图就没有它。
  */
  // 出现条件：这段必须落在 `{starter ? ( … ) : null}` 里（没有初始图就没什么可锁的）。
  const lockSwitchInStarterBranch = (src: string): boolean => /\{starter \? \([\s\S]{0,700}?锁定初始图/.test(src);
  assert.ok(lockSwitchInStarterBranch(source), '「锁定初始图」不在「这一题有初始图」的分支里 —— 没有初始图也会出现');
  // ⚠️ 反面对照：把出现条件换成恒真 ⇒ 必须判违规（证明这条判据守的正是那个分支）。
  const alwaysShown = source.replace('{starter ? (', '{true ? (');
  assert.notEqual(alwaysShown, source, '反面对照没造出来 —— 这条判据会变成恒真');
  assert.ok(!lockSwitchInStarterBranch(alwaysShown), '反面对照没被抓住 —— 这条判据是恒真的');
  const blockMatch = source.match(/\{starter \? \([\s\S]{0,700}?锁定初始图[\s\S]{0,400}/);
  assert.ok(blockMatch, '「锁定初始图」的开关块没抠出来 —— 先修这条判据，别让它在空串上全绿');
  const block = blockMatch[0];
  // ① 是**开关**不是复选框（教师澄清 3）：`role="switch"`，外观复用既有那套轨道。
  assert.match(block, /role="switch"/, '「锁定初始图」不是开关（缺 role="switch"）');
  assert.match(block, /className="worksheet-editor-drawing-switch"/, '「锁定初始图」没有复用既有的开关样式（那条轨道是自绘的）');
  // ② 默认 = **锁定**：勾选状态读的是 `starter.locked`（`readDrawingStarter` 给的，缺席 = true）。
  //    ⚠️ 取反（`!starter.locked`）会红 —— 那正是「默认锁」被写反的样子。
  assert.match(block, /checked=\{\s*starter\.locked\s*\}/, '「锁定初始图」的勾选状态不是取自 starter.locked（缺席 = 锁定）');
  // ③ 写回：走那个纯函数（它只在**取消锁定**时写 false，与「缺席 = 锁定」配套）。
  assert.match(block, /drawingStarterLockPatch\(\s*event\.target\.checked\s*\)/,
    '开关没有把「当前是否锁定」交给 drawingStarterLockPatch 写回题目数据');
  // ④ 副说明一句话讲清后果（教师原话：「学生只能添加，不能修改或删除你给的框与连线」）。
  assert.match(block, /学生只能添加，不能修改或删除你给的框与连线/, '开关没有一句话讲清「锁了会怎么样」');
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
