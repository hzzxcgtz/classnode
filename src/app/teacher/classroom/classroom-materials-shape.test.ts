/**
 * 教师看板里调「这间课堂在用什么材料」那几个函数时，**必须递拼好的那份形状**。
 *
 * 🔴 这个文件是一次真 bug 的产物（2026-09-29，教师：「词云还是没有回来」）。
 * 根因：`visibleModules` 内部走 `effectiveGroupAgent`，而它在标准模式下读的是
 * **`classroom.agents`** —— 教师端这条路径上那个字段叫 **`classroomAgents`**
 *（`GET /:id` 的 include，agent 嵌在里面），**没有 `agents`**。
 * 而 `agents` 在类型上是**可选**的 ⇒ 递原始 `classroom` 时它恒为 `undefined`，
 * 函数**静默**回 `null`（=「这间课堂没配智能体」）⇒「智能学伴」页签对**所有**课堂消失、
 * 词云跟着不见，而 **tsc / eslint / 全部用例一路绿灯**。
 * 同一个函数的网页 / 学习单两条恰好读的就是同名的小写字段 ⇒ 只有智能体那一条错。
 *
 * ⚠️ 这个坑**仓里早就付过一次学费**：`drawerAgent` 那处的注释写着「课堂级那一个在教师端
 * 这条路径上叫 `classroomAgents`，不叫 `agents`……不改名的话 `classroom.agents` 恒为
 * `undefined`」—— 那处拼了，而我这处没找到它。
 *
 * ⇒ 立的规矩：**这两类调用只许递 `materials`**（页面里拼一次、两处共用），
 *   不许再出现 `visibleModules(classroom` / `effectiveGroupAgent(classroom`。
 *   这条只有源码网拦得住 —— 可选字段的缺失在类型上无迹可寻。
 *
 * ⚠️ 只读文本、不渲染任何东西 ⇒ 本机（无 jsdom、无浏览器）跑得起来。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.join(HERE, 'page.tsx'), 'utf8');

/**
 * 剥掉注释再查。
 * 🔴 这一层是**必需的**（本仓另外两条源码网都有）：本文件与 `page.tsx` 的注释里都在
 * **讨论**这几个函数（上面那段就在讲「递 `classroom` 会怎样」）—— 不剥的话这条网会被
 * 自己的说明文字喂饱、永远红。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 🔴 **只盯「走智能体那一条」的两个函数**，不是全部材料解析函数。
 *
 * 为什么只盯它们：`effectiveGroupAgent`（以及内部走它的 `visibleModules`）在标准模式下读的是
 * **`classroom.agents`**，而这一页那个字段叫 `classroomAgents` ⇒ 直传时恒为 `undefined`（静默）。
 * 而 `effectiveGroupWorksheet` / `effectiveGroupWebapp` 读的是 `classroom.worksheets` /
 * `classroom.webapps` —— **这一页恰好就有这两个同名字段**（它们一直好用，见 `tileWorksheetOf`）。
 * ⇒ 「不许直传 `classroom`」这条**不是**一般规则（那样会误伤那两处），
 *   一般的是「**函数读的字段名要与这个对象上的字段名对得上**」，而它没法用 grep 判 ——
 *   所以这里把**已知对不上的那两个**钉住，理由写在上面。
 */
test('🔴 走智能体那一条的材料解析：不许递原始 `classroom`（它的字段叫 `classroomAgents`）', () => {
  const bare = stripComments(PAGE);
  const offenders = [
    ...[...bare.matchAll(/visibleModules\(\s*classroom\b/g)].map(() => 'visibleModules(classroom'),
    ...[...bare.matchAll(/effectiveGroupAgent\(\s*classroom\b/g)].map(() => 'effectiveGroupAgent(classroom'),
  ];
  assert.deepEqual(
    offenders, [],
    `这几处递的是原始 classroom：${offenders.join(' / ')}。`
    + '它在教师端这条路径上**没有 `agents` 字段**（叫 `classroomAgents`），而那个字段是可选的'
    + '⇒ 函数静默回 null，屏幕上「智能学伴」那一页整个不见，而门禁全绿。请改递 `materials`。',
  );
});

test('🔴 那一份 `materials` 真的拼了（把 `classroomAgents` 改名成 `agents`）', () => {
  // ⚠️ 少了这一条，上面那条在「有人把 `materials` 删掉、两处都改成别的写法」时也可能绿
  //（只要没有 `(classroom` 这么写的）。这里钉住**那份拼法本身**。
  const bare = stripComments(PAGE);
  assert.ok(
    /agents:\s*classroom\.classroomAgents\?\.map\(/.test(bare),
    '`materials` 必须把 `classroomAgents` 改名成 `agents`（`effectiveGroupAgent` 读的是后者）',
  );
  assert.ok(/const materials = \{ \.\.\.classroom, agents:/.test(bare), '而且要有一个叫 `materials` 的常量');
});

test('阳性对照：这条网真的读到了那几个调用点（不是靠「一个都没匹配到」变绿的）', () => {
  assert.ok(PAGE.length > 10000, '`page.tsx` 真的被读到了');
  const bare = stripComments(PAGE);
  // ⊘ ★ 2026-09-29：`visibleModules` 那一个调用点**已经删掉了** —— 统计面板（三页签）
  // 按教师要求整个取消（词云搬进了工具条「智能学伴▾ → 对话分析」）。
  // ⚠️ 于是这条网现在只盯 `effectiveGroupAgent` 一处；上面那两条「不许递 `classroom`」
  // 的断言对 `visibleModules` 仍然生效（万一将来有人把它加回来）。
  // ⚠️ 调用点与 `materials` 之间隔着一行注释（剥掉注释之后就贴上了）—— 所以查的是
  //     「同一个调用里出现了 materials」，而不是去拼换行与缩进。
  assert.ok(/effectiveGroupAgent\([^)]*materials\b/.test(bare), '`drawerAgent` 那一处也应当递 `materials`');
  // ⚠️ 另一条对照：**允许**直传的那两处确实还在（否则上面那条会显得像"全都不许传"，
  //    下一个人会以为 `effectiveGroupWorksheet` 也得拼一份 —— 那是把它改坏）。
  assert.ok(/effectiveGroupWorksheet\(classroom\b/.test(bare), '读同名字段的那一处可以直传（它读 `worksheets`）');
});
