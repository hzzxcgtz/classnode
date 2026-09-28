import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ★ 2026-09-28：**抽屉「画内容」的判据不许带 `!loading`。**
 *
 * ── 这条用例是怎么来的 ────────────────────────────────────────────────
 * 教师报：「点某个学生卡片，右侧详情页里点开某一题看答题情况，它会自己收拢」。
 *
 * 根因是两件事被耦在了一起：
 *   · 抽屉用 `!loading` 决定「画内容还是画『正在读取作答…』」；
 *   · 看板的数据层是**常开 30 秒轮询**的（★ 2026-09-28 统一数据层那一步改的），
 *     而它**每一次**刷新都把 `loading` 置真。
 * ⇒ 每 30 秒，抽屉里那一整块被**卸载重挂**一次，组件内的状态（`expandedOverride`，
 *   「哪一题展开了」）随之清零、滚动位置也会跳。教师看到的正是「自己收拢」。
 *
 * ⇒ 判据换成「**有没有数据**」（`board` 在不在），刷新静默进行。
 *
 * ── 为什么是源码级的 ──────────────────────────────────────────────────
 * 本仓没有前端测试框架（`node --test` 加载不了 JSX），而这条性质是**结构**上的：
 * 「这些分支的判据里有没有 `!loading`」是源码上的事实，读一眼就能判，
 * 且它恰好就是这次事故的全部成因。与 `worksheet-prompt-text.test.ts` 同一路数。
 *
 * ⚠️ 它钉的是**这一个文件里这几行**，不是「loading 永远不能用」——
 * 上面那两句「读到了没有」的判据里用 `!board && loading` 是对的（那时确实还没数据）。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, 'worksheet-drawer.tsx'), 'utf8');

test('🔴 抽屉的内容分支不许带 `!loading`（30 秒轮询会把它卸载重挂，展开的题自己收拢）', () => {
  // 判据：`!loading && board &&` 这种写法（容忍任意空白）。
  const coupled = SOURCE.match(/!\s*loading\s*&&\s*board\s*&&/g) ?? [];
  assert.deepEqual(
    coupled,
    [],
    '🔴 「画不画内容」必须只看有没有数据（`board`），不许看「正在不在读」：\n'
    + '   看板的数据层是常开轮询的，每一次后台刷新都会让这一块卸载重挂 ——\n'
    + '   抽屉里展开的那一题会自己收拢、滚动位置会跳（实测事故）。',
  );
});

/**
 * 阳性对照：内容分支**确实还在**，而且确实以 `board` 为判据。
 * 少了它，一个「把四个分支全删掉」的实现也能让上面那条绿。
 */
test('阳性对照：四个内容分支仍在，且判据是 `board`（不是把内容删掉了）', () => {
  for (const kind of ['worksheets', 'questions', 'question', 'participant']) {
    assert.match(
      SOURCE,
      new RegExp(`board\\s*&&\\s*current\\.kind === '${kind}'`),
      `抽屉里「${kind}」那一层的内容分支不见了 —— 上面那条断言会因此变成假绿`,
    );
  }
  // 而「还没有数据」那两句仍然要看 loading（那时它是对的：确实还没有数据）。
  assert.match(SOURCE, /!\s*board\s*&&\s*loading/, '「正在读取作答…」那一句该留着');
  assert.match(SOURCE, /!\s*board\s*&&\s*!\s*loading/, '「还没有读到这一堂课的作答」那一句该留着');
});
