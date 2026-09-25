/**
 * ★ API Token 共享（第 2 步）：**「解密 agent.apiKey」这句话只能有一个出处。**
 *
 * 🔴 这是收口那一步的真正产出，不是顺手清理。改动前那句话在 **7 处、4 个文件**里各写了一遍
 * （`routes/agents.ts` ×4 · `routes/worksheets.ts` · `services/agent-checker.ts` ·
 * `socket/index.ts`），而那种复制的失败是**静默**的：加第 8 个调用点、或者只改了其中 6 处，
 * **没有任何东西会红** —— 表现是「某一条链路还在用旧 Token」。
 * 更具体地说，那 7 处里有 **4 处不在对话链路上**（测试连接 / 开场白 / 信息预览 / 定时检查）
 * ⇒ 漏掉它们的症状是「对话已经用上新 Token 了，而『测试连接』还在报旧 Token 的错」，
 * 教师会去查一个根本不存在的问题。
 *
 * 所以这条用例把「只有一个出处」变成可判定的：
 *
 * ```bash
 * grep -rn "decrypt(.*apiKey" server/src --include="*.ts" | grep -v tests
 * ```
 *
 * ⚠️ **它守不住的那一半，说清楚**：一个新调用点如果**根本不解密**（直接 `apiKey: agent.apiKey`
 * 把密文当钥匙发出去），这条用例看不见它。要守那一半得去认「AgentConfig 字面量」的形状，
 * 而那会变成一条见谁都咬的脆网。⇒ 宁可守得住的那一半守死，也不写一条会被人关掉的网。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 🔴 **不能用 `path.resolve(HERE, '..')`** —— 本用例编译后跑在 `server/dist/tests/` 下，
 * 那样算出来是 `server/dist/`，于是扫的全是**编译产物**（`.js`），而下面的 `collect` 只收 `.ts`
 * ⇒ **一个文件都没扫**，第一条用例**空着就绿了**（当天真发生过，就是这条注释的由来）。
 *
 * 改成往上找「含 `src/services/agent-config.ts` 的那一层」：从 `dist/tests` 往上第一站是
 * `dist`（不含），第二站是 `server`（含）⇒ 拿到 `server/src`。用源码树里的一个**必然存在**的
 * 文件当锚点，比数 `..` 的层数稳 —— 后者在目录结构变动时会静默指错地方。
 */
function findServerSrc(): string {
  let dir = HERE;
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(dir, 'src');
    if (fs.existsSync(path.join(candidate, 'services', 'agent-config.ts'))) return candidate;
    dir = path.resolve(dir, '..');
  }
  throw new Error('找不到 server/src —— 定位逻辑失效了，用例必须报错而不是空扫一遍');
}
const SERVER_SRC = findServerSrc();

/** 去掉注释：说明里会**引用**被禁的写法（本文件上面就写了一处），不去掉会自己把自己扫红。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/**
 * 允许自己解密 `agent.apiKey` 的**全部**文件，每条都要有理由。
 *
 * 🔴 加一个进来之前先问：它是在**组装一份 AgentConfig** 吗？
 *    · 是 ⇒ 它该改调 `toAgentConfig`，**不许**加进这张表；
 *    · 不是（有别的用途）⇒ 可以加，但理由要写在这里。
 */
const ALLOWED = new Set([
  // 唯一组装 AgentConfig 的地方 —— 「使哪把钥匙」的唯一答案。
  'services/agent-config.ts',
  // 一次性迁移：它要的是「**智能体自带那把**钥匙的明文」来按值去重。
  // ⚠️ 这里**不能**改调 `toAgentConfig` —— 那个会**优先取共享凭据**，
  //    而迁移要的恰恰是各自的旧钥匙本身（用错了会把不同账号的 Token 合成一份）。
  'services/platform-token-migration.ts',
]);

test('🔴 「解密 agent.apiKey」只许出现在上表那两个文件里', () => {
  const offenders: string[] = [];
  const files = collect(SERVER_SRC);
  // 🔴 扫到东西的阳性对照 —— 就是它抓出过「扫了 0 个文件却全绿」那个假绿。
  assert.ok(files.length > 20, `只扫到 ${files.length} 个源文件 —— 定位错了，这条用例是空的`);
  for (const file of files) {
    const relative = path.relative(SERVER_SRC, file);
    if (ALLOWED.has(relative)) continue;
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    // 只看「把某个 apiKey 拿去解密」这一种写法 —— 别的解密（比如开场白缓存、密钥自检）不在此列。
    if (/decrypt\([^)]*apiKey[^)]*\)/.test(source)) offenders.push(relative);
  }
  assert.deepEqual(offenders, [],
    '这些文件又自己解密 agent.apiKey 了 —— 请改调 `toAgentConfig(agent, credential)`：\n'
    + offenders.map((f) => `  · ${f}`).join('\n'));
});

test('阳性对照：那条 grep 真的能匹配到东西（否则上面是恒真的）', () => {
  // 少了这一条，「正则写错了」与「全都没违规」都是空 offenders。
  const allowed = stripComments(fs.readFileSync(path.join(SERVER_SRC, 'services/agent-config.ts'), 'utf8'));
  assert.match(allowed, /decrypt\([^)]*\)/, '许可的那一处本身必须还在解密');
  assert.ok(
    /isEncrypted\(value\)/.test(allowed),
    '收口那一处必须仍然走 isEncrypted 判据（老库存过未加密的值）',
  );
});
