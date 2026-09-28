import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ★ 2026-09-28：**学生端不许用 `@/lib/socket` 那个 `useSocket()`。**
 *
 * ── 这条用例是怎么来的（一次真实的、静默的事故）────────────────────────
 * 教师报：「清除学生的一个小题后，学生端没有马上清除，刷新后才清除」。
 * 根因是**两条不同的 socket**：
 *
 *   · `@/lib/socket.ts` 的 `getSocket()` 单例 —— 那是**教师端**用的
 *     （`teacher/classroom/page.tsx` 拿它 `joinTeacherBoard`）；
 *   · 学生端有**两条自己建的连接**：`useClassroomSession` 的状态监听，
 *     与 `useChatSocket` 的会话连接 —— 而**只有后者**发 `join-classroom`
 *     ⇒ 只有它进得了 `student:<id>` 房间。
 *
 * 我在学习单面板里调了 `useSocket()`，于是开出**第三条从没 join 过的连接**：
 * 服务端把广播发进 `student:<id>`，而那条连接不在房间里 ⇒ 永远收不到。
 * **两边都不报错**：服务端日志干净、事件照发、学生屏幕上什么都不动。
 *
 * ⇒ 学生端要收服务端的定向广播，唯一的路是**把订阅挂进 `useChatSocket`**，
 *   让状态走会话层、由外壳转手（`answersLocked` / `webappDemand` 都是这么做的）。
 *
 * ── 这条用例为什么是源码级的 ──────────────────────────────────────────
 * 本仓没有前端测试框架（`node --test` 加载不了 JSX），运行时也验不了
 * 「这条连接在不在那个房间里」。但**「谁 import 了哪个模块」是源码上的事实**，
 * 而它恰好就是这次事故的全部成因 ⇒ 源码级断言在这里是够用的。
 * 与 `worksheet-prompt-text.test.ts` / `editor-classes.test.ts` 同一路数。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 递归收集学生端目录下的全部源码（`.ts` / `.tsx`，跳过测试文件本身）。 */
function studentSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { studentSources(full, out); continue; }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.ts$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

test('🔴 学生端一律不许用 `@/lib/socket` 的 useSocket（那是教师端的单例，连不进 student 房间）', () => {
  const files = studentSources(HERE);
  // 阳性对照：真扫到了东西。少了它，一个路径写错的 glob 会让这条用例**永远绿**。
  assert.ok(files.length > 20, `扫到的学生端源码太少（${files.length} 个），路径大概是错的`);

  const offenders: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    // 判据是**导入**，不是提及：注释里为了讲清这件事会反复写到 `useSocket`。
    if (/from\s+['"]@\/lib\/socket['"]/.test(source)) {
      offenders.push(path.relative(HERE, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    '🔴 学生端要收服务端的定向广播，必须把订阅挂进 `useChatSocket`（那是唯一发 '
    + 'join-classroom、因而唯一进得了 `student:<id>` 房间的连接），状态走会话层、外壳转手。'
    + '用 `@/lib/socket` 会新开一条从没 join 过的连接 —— 收不到、且**两边都不报错**。',
  );
});

/**
 * 阳性对照的另一半：**那条唯一正确的连接确实在做它该做的事**。
 *
 * 少了这一条，将来若有人把 `useChatSocket` 里的 `join-classroom` 挪走
 * （或改掉房间名），上面那条断言照样全绿，而学生端从此收不到任何定向广播。
 */
test('阳性对照：`useChatSocket` 仍然发 join-classroom（学生端唯一的会话连接）', () => {
  const chatSocket = fs.readFileSync(path.join(HERE, 'chat/use-chat-socket.ts'), 'utf8');
  assert.match(
    chatSocket,
    /emit\(\s*['"]join-classroom['"]/,
    '🔴 `join-classroom` 是学生进 `student:<id>` 房间的**唯一**入口。它被挪走之后，'
    + '所有「教师动作 → 学生端实时」的功能都会静默失效（广播照发，收不到）。',
  );
});
