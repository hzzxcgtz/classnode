/**
 * ★ 2026-10-05（教师）：「垂直滚动条只需要保留一个。」
 *
 * 「学生端预览」弹窗里原来有**两条**垂直滚动条：
 *   · `.worksheet-editor-preview-stage` 自己一条（它写死了设备高度 + `overflow-y: auto`）；
 *   · 外面 `.worksheet-editor-preview-scroll` 一条。
 * 而且两层都设了 `overscroll-behavior: contain` ⇒ 外面那条几乎滚不动（只有光标落在舞台
 * 外的内边距上才响应）—— 「两条里能用的那条还不一定是看得见的那条」。
 *
 * ⇒ 现在只留弹窗那一个滚动容器：舞台的高度改成**下限**（`minHeight` = 设备视口高度），
 *    内容更高就跟着长高。**宽度仍然是写死的设备宽度** —— 「教师看到的就是学生看到的那个
 *    宽度」靠的是它，那一条不许动。
 *
 * 🔴 本仓没有 jsdom、没有浏览器 ⇒「滚轮滚的是哪一个」在本机**验不了**。
 *    这一条网能回答的只有：**那几个声明在不在**（与 `math-entry.test.ts` 同一路数）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODAL = fs.readFileSync(path.join(HERE, 'preview-modal.tsx'), 'utf8');
/**
 * ⚠️ 读进来先**剥掉注释**：这一版新加的注释里就写着旧写法（`overflow-y: auto`、
 *    `overscroll-behavior`），不剥的话「反面」断言会被自己的注释命中 —— 那种网比没有更坏
 *    （它逼着下一个人把注释删掉才能过）。
 */
const GLOBALS = fs.readFileSync(path.resolve(HERE, '../../../../app/globals.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('阳性对照：读到的确实是预览弹窗与全局样式', () => {
  assert.ok(MODAL.includes('WorksheetQuestionList'), '这不是预览弹窗（它渲染学生端那个共享组件）');
  assert.ok(GLOBALS.includes('.worksheet-editor-preview-scroll'), '全局样式里找不到那个滚动容器');
});

test('🔴 舞台给的是**下限**高度（内容更高就长高），不再是写死的高度', () => {
  // 反面钉的是旧写法：`height:` 会把舞台锁死 ⇒ 它必须自己再滚一条。
  assert.ok(
    !/^\s*height:\s*orientation/m.test(MODAL),
    'preview-modal.tsx 又把舞台高度写死了 —— 那就会多出一条垂直滚动条',
  );
  assert.match(MODAL, /minHeight:\s*orientation === 'portrait'/, '舞台高度不是 `minHeight`（下限）');
  // 宽度那一条**必须**还是写死的设备宽度（文件头那两条取舍里的第 1 条）。
  assert.match(MODAL, /width:\s*orientation === 'portrait' \? STUDENT_STAGE_WIDTH : STUDENT_LANDSCAPE_WIDTH/,
    '舞台宽度被改掉了 —— 它必须是写死的设备宽度');
});

test('🔴 舞台自己不再滚：`overflow-y: auto` 与配套的 `overscroll-behavior` 都不在了', () => {
  const at = GLOBALS.indexOf('.worksheet-editor-preview-stage {');
  assert.ok(at > 0, '找不到舞台那条规则');
  const block = GLOBALS.slice(at, GLOBALS.indexOf('}', at));
  assert.ok(!/overflow[^;]*auto/.test(block), '舞台又在自己滚了 —— 弹窗里会变成两条垂直滚动条');
  // ⚠️ 不滚的盒子留着 `overscroll-behavior` 只会让人以为滚动还在这里。
  assert.ok(!/overscroll-behavior/.test(block), '舞台已经不滚了，`overscroll-behavior` 该跟着删掉');
  // 阳性：外面那个容器仍然是**唯一**的滚动容器（它要是也被删了，长卷就滚不动）。
  const scrollAt = GLOBALS.indexOf('.worksheet-editor-preview-scroll {');
  const scrollBlock = GLOBALS.slice(scrollAt, GLOBALS.indexOf('}', scrollAt));
  assert.match(scrollBlock, /overflow:\s*auto/, '弹窗那个滚动容器丢了 —— 长卷会滚不动');
});
