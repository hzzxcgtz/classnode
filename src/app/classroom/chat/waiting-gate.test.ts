import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 「等待 AI」这道闸门在**每一条终止路径**上都要收回。
 *
 * 🔴 起因（2026-10-09 审计 §B2）：学生发出去的话命中屏蔽词时，服务端**不调用 AI**
 * （`server/src/socket/index.ts` 的 `emit('shield-warned')` 之后直接 `return`），
 * 而客户端 `shield-warned` 的处理器**只弹了那一条提示、没有收回闸门** ——
 * `waitingAI` 与 `sendingRef` 一直挂着：输入框 `disabled`、发送键被 `waitingAI` 挡住、
 * 屏幕上那条「正在思考」的指示器永不消失。
 * 唯一可点的出口是「停止生成」，而它在 `allowStudentStop === false` 的课堂上**根本不存在**
 * （`chat-panel.tsx` 那个三元：`waitingAI && allowStudentStop !== false ? 停止 : 发送(disabled)`）
 * ⇒ 学生**没有任何办法再发一条**，直到刷新页面或连接断开。
 * 同文件里另外 11 条终止路径全都收了这个闸门 —— 少这一条，正是它一直没被发现的原因。
 *
 * ⚠️ **本文件证明的是接线，不是浏览器里的行为**（本仓没有前端测试框架、也没有 jsdom）：
 * 它扫的是源码里「这个处理器的函数体里有没有那句复位」。真正的行为要人工验：
 * **命中屏蔽词后，输入框与发送键要能再用**（`allowStudentStop` 关掉时尤其）。
 *
 * ```bash
 * node --test src/app/classroom/chat/waiting-gate.test.ts
 * ```
 */

/** 去掉注释再扫：本文件与源码里都**引用**了这些事件名与函数名（说明用），不去掉会自己扫自己。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'use-chat-socket.ts');

/**
 * 按 `socket.on('名字'` 把源码切块：每块 = 那个处理器的函数体（切到下一个 `socket.on(` 为止）。
 *
 * ⚠️ 切块而不是全文 `includes`：全文扫的话，只要**任何一处**收了闸门，每条断言都绿 ——
 * 而这道题的形态恰好是「12 处里少 1 处」，全文扫**永远看不见它**。
 */
function handlersOf(): Map<string, string> {
  const source = stripComments(readFileSync(FILE, 'utf8'));
  const marks = [...source.matchAll(/socket\.on\(\s*'([^']+)'/g)];
  const out = new Map<string, string>();
  marks.forEach((mark, index) => {
    const start = mark.index ?? 0;
    const end = index + 1 < marks.length ? (marks[index + 1].index ?? source.length) : source.length;
    out.set(mark[1], source.slice(start, end));
  });
  return out;
}

/** 一句复位：`waitingAI` 与 `sendingRef` 都要收（只收一个 ⇒ 发送闸门仍锁着）。 */
const GATE_CLOSED = /setWaitingAI\(false\)/;
const SENDING_RESET = /sendingRef\.current\s*=\s*false/;

test('🔴 锚点：能在这个文件里切出处理器（切不出来就没在扫我以为的那个文件）', () => {
  const handlers = handlersOf();
  assert.ok(handlers.size >= 12, `只切出 ${handlers.size} 个处理器 —— 切块规则失效了，先修用例`);
  // 顺带钉住「切块真的按事件名分开」：这两块的正文必须**不同**（切错成同一块时二者相等）。
  assert.notEqual(handlers.get('ai-thinking'), handlers.get('ai-response'), '切块没分开');
});

test('🔴 屏蔽词命中后必须收回闸门（服务端在这条路上根本没调用 AI）', () => {
  const shield = handlersOf().get('shield-warned');
  assert.ok(shield, '找不到 shield-warned 处理器 —— 用例的锚点失效了，先修用例');
  assert.match(shield, GATE_CLOSED,
    'shield-warned 不收「等待 AI」⇒ 输入框与发送键一直按不动；'
    + 'allowStudentStop 关闭时屏幕上连「停止生成」都没有，学生只能刷新页面');
  assert.match(shield, SENDING_RESET,
    'waitingAI 收了、sendingRef 没收 ⇒ sendMessage 的第一道闸门仍然把它挡回去');
});

test('🔴 每一条「这一轮到此为止」的路径都要收闸门', () => {
  // 名单逐条带理由：这些都是**服务端不会再给这一轮答案**的事件。
  const terminal: Array<[string, string]> = [
    ['ai-response', '答案到了，这一轮结束'],
    ['ai-error', '服务端说这一轮失败了'],
    ['student-auth-error', '会话失效（连接马上就要断）'],
    ['agent-disabled', '智能体被停用'],
    ['classroom-paused', '课堂暂停'],
    ['messages-cleared', '教师清屏'],
    ['student-blacklisted', '学生被黑屏'],
    ['identity-conflict', '身份冲突，要回身份页'],
    ['disconnect', '连接断了'],
    ['connect_error', '连不上'],
    ['error', 'socket 层报错'],
    ['shield-warned', '★ 本次补上的那一条'],
  ];
  const handlers = handlersOf();
  const missing = terminal
    .filter(([event]) => !GATE_CLOSED.test(handlers.get(event) ?? ''))
    .map(([event, why]) => `${event}（${why}）`);
  assert.deepEqual(missing, [],
    `这些处理器没有收回「等待 AI」闸门 ⇒ 命中它们的学生会卡在「正在思考」，屏幕上没有出口：\n  ${missing.join('\n  ')}`);
});

test('阳性对照：**不**结束这一轮的处理器不许碰闸门', () => {
  // 没有这一条，把 `waitingAI = false` 加到每一个处理器上也能让上面那条变绿 ——
  // 而那会把「正在思考」的指示器在一次正常的流式推送里抹掉。
  const handlers = handlersOf();
  assert.doesNotMatch(handlers.get('ai-thinking') ?? '', GATE_CLOSED,
    'ai-thinking 是**开始**这一轮，收闸门会让指示器根本不出现');
  assert.doesNotMatch(handlers.get('ai-chunk') ?? '', GATE_CLOSED,
    'ai-chunk 是流式正文，收到一半收闸门会把正在打的字吞掉');
  assert.doesNotMatch(handlers.get('ai-thinking-content') ?? '', GATE_CLOSED);
});
