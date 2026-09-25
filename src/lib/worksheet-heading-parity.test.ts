/**
 * 两级题号的**跨工程对拍** —— 前后端两份实现必须逐字一致。
 *
 * 🔴 为什么需要它：服务端读不到 `src/`，所以「拍平成可作答的题 + 每题一个两级题号」
 * 在仓里有**两份**实现（`src/lib/worksheet-questions.ts` 与
 * `server/src/services/worksheet-heading.ts`）。同一件事多份实现正是本项目反复被咬的那类分叉，
 * 而这里的症状尤其难查：两边算出的题号不同 ⇒ 教师看板列头写「任务二 · 3」、
 * 导出 Word 写「第 5 题」、分析载荷写「第 4 题」，**三处都不报错**，教师只会觉得「对不上」。
 *
 * ⚠️ 它**住在前端测试目录**，因为只有这一个 runner 能同时看见两边
 * （根目录的 `node --test` 扫 `src/` 下的全部 `*.test.ts`；服务端那一个只吃编译产物）。
 * ⚠️ 注释里**不要写 glob**：`src/` + `**` + `/` + `*.test.ts` 那串里的 `*` 加斜杠会**提前终止
 * 块注释**，余下的文字被当成代码 ⇒ `ERR_INVALID_TYPESCRIPT_SYNTAX`。
 * ⚠️ 镜像文件**不许有任何 import**（连 `import type` 之外的都不行）：Node 的类型擦除
 * **不会**把 `./x.js` 解析到 `./x.ts`（`ERR_MODULE_NOT_FOUND`）⇒ 一旦它 import 了
 * `./worksheet-questions.js`，这条护栏就加载不起来。先例是 `ink-path.ts`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenAnswerable, TASK_TYPE } from './worksheet-questions.ts';
import { flattenAnswerable as mirrorFlatten, TASK_TYPE as MIRROR_TASK_TYPE } from '../../server/src/services/worksheet-heading.ts';
import type { WorksheetQuestionNode } from './types.ts';

// ⚠️ 夹具用**真的**节点类型（不是本文件自己写的一个结构类型）：喂给两边时都要过类型检查，
// 而服务端那一份的 `T` 是从实参推断的 —— 用窄类型会让这条用例在 `tsc` 下红，
// 而它**跑**起来是绿的（`pnpm test:client` 不做类型检查，只有 `next build` / `tsc --noEmit` 会红）。
function q(id: string, children: WorksheetQuestionNode[] = []): WorksheetQuestionNode {
  return { id, type: 'single-choice', prompt: `题干 ${id}`, inputMode: 'keyboard', data: {}, children };
}

function task(id: string, prompt: string, children: WorksheetQuestionNode[]): WorksheetQuestionNode {
  return { id, type: TASK_TYPE, prompt, inputMode: 'keyboard', data: {}, children };
}

/** 刻意刁钻的一批树：空 / 无任务 / 一个任务 / 两个任务 / 散题与任务混排 / 标题留空 / 手工嵌套。 */
const TREES: WorksheetQuestionNode[][] = [
  [],
  [q('a'), q('b'), q('c')],
  [task('t1', '任务一', [q('a'), q('b'), q('c')])],
  [task('t1', '任务一', [q('a'), q('b')]), task('t2', '任务二', [q('c')])],
  [q('a'), task('t1', '任务一', [q('b'), q('c', [q('c1')])]), q('d')],
  [task('t1', '   ', [q('a'), q('b')]), q('c')],
  [task('t1', '  任务一\n', [q('a')]), q('b', [q('b1')])],
];

test('★ 对拍：同一批树上，两边的题号逐字相同', () => {
  for (const nodes of TREES) {
    const front = flattenAnswerable(nodes).map((item) => item.heading);
    const back = mirrorFlatten(nodes).map((item) => item.heading);
    assert.deepEqual(front, back, `题号不一致：${JSON.stringify(nodes.map((n) => n.id))}`);
  }
});

test('★ 对拍：两边都跳过任务节点，且题的顺序逐项相同', () => {
  for (const nodes of TREES) {
    const front = flattenAnswerable(nodes).map((item) => item.node.id);
    const back = mirrorFlatten(nodes).map((item) => item.node.id);
    assert.deepEqual(front, back);
    assert.equal(back.includes('t1') || back.includes('t2'), false, '任务被当成了一道题');
  }
});

test('对拍不是空转：至少有一棵树产出带前缀的题号，且没有任何空题号', () => {
  // 阳性对照 —— 少了它，两边**都坏成回空数组/空串**也能让上面两条全绿。
  const all = TREES.flatMap((nodes) => flattenAnswerable(nodes).map((item) => item.heading));
  assert.ok(all.some((heading) => heading.includes(' · ')), '没有任何一条两级题号，对拍是空转的');
  assert.ok(all.length > 0);
  assert.equal(all.some((heading) => heading.trim() === ''), false, '出现过空题号');
});

test('两边的 TASK_TYPE 必须是同一个串', () => {
  assert.equal(MIRROR_TASK_TYPE, TASK_TYPE);
});
