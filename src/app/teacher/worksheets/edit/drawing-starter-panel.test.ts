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

test('★ 底稿面板：只给流程图档、用学生的画板、写回带 tool 的 drawingStarter', () => {
  // ① 只在流程图档出现（试点就这一档；其它档学生端还没接，给出来就是骗人）。
  assert.match(source, /tool === 'flowchart' && \(/, '底稿面板没有限定在流程图档');
  assert.match(source, /\{tool === 'flowchart' && \([\s\S]*?<FlowchartDrawing/, '底稿面板里不是那块学生画板');
  // ② 用的是学生那块画板（同一份数据 ⇒ 教师画的就是学生要接着画的那份）。
  assert.match(source, /import FlowchartDrawing from '@\/app\/classroom\/worksheet\/questions\/drawing-surfaces\/flowchart-drawing'/, '没有复用学生端的画板组件（它是默认导出）');
  // ③ 写回 `drawingStarter`（带 tool！学生端按 `starter.tool === 'flowchart'` 判断要不要合并）。
  assert.match(source, /drawingStarter: \{ tool: 'flowchart', data: next \}/, '写回的形状不对（缺 tool 学生端会直接忽略）');
  // ④ 能清空（否则教师反悔之后这道题永远带着底稿）。
  assert.match(source, /drawingStarter: undefined/, '没有「清空底稿」');
  // ⑤ 画板要有明确高度：它靠量出容器尺寸才初始化（这条路径我们修过两次：scale(0) / overflowHidden）。
  assert.match(source, /height: \d+/, '底稿画板没有给固定高度 —— 量不出尺寸它不会初始化');
});
