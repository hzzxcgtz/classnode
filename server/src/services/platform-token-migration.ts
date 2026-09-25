import type { PrismaClient } from '@prisma/client';
import { decrypt, encrypt, isEncrypted } from './crypto.js';

/**
 * ★ 2026-09-25：把现有 **Coze 低代码**智能体的 Token 抽成共享的 `PlatformToken` 记录。
 *
 * 起因：Token 属于**扣子账号**、不属于 Bot —— 同一个号做出来的多个智能体从前各存一份
 * （`Agent.apiKey`），换一次要改 N 遍。
 *
 * ── 三条纪律（spec `2026-09-25-API-Token-共享与有效期.md` §六）─────────────
 *
 * 1. 🔴 **原 `apiKey` 一个字不动。** 它既是**回滚的路**（把 `credentialId` 全部置空就回到今天），
 *    也是「自带 Token」那条路的数据（`credentialId IS NULL` 时读的就是它）。
 *
 * 2. 🔴 **有效期不猜。** 不写 `now + 30d` —— 那是一个我们**没有依据**的断言，
 *    而且会在迁移当天给所有老用户造出一批**假倒计时**。留 `null`，
 *    界面上显示「未设置有效期」并催教师去填（那是一个要被催促的状态，不是沉默的默认）。
 *
 * 3. 🔴 **幂等。** 迁移可能中途崩过（标记没写上），所以第二次跑不能造出第二份同样的凭据。
 *    实现上靠两件事：`credentialId IS NULL` 这个筛选本身，以及下面按**明文**比对的 `known` 表。
 *
 * ── 一条决定实现形态的事实 ────────────────────────────────────────────────
 *
 * 🔴 `crypto.ts` 的 `encrypt` **每次都用一个随机 IV** ⇒ 同一个 Token 的密文每次都不一样。
 * 所以「按 Token 去重」**必须解密后比明文**。比密文的话，每个智能体都会被判成一份新的。
 */
export async function migratePlatformTokens(prisma: PrismaClient): Promise<{ tokens: number; linked: number }> {
  // 只看还没接上的 —— 这一句本身就是幂等的第一道保证。
  const pending = await prisma.agent.findMany({
    where: { platform: 'coze', credentialId: null },
    select: { id: true, name: true, apiKey: true },
    orderBy: { createdAt: 'asc' },
  });
  if (pending.length === 0) return { tokens: 0, linked: 0 };

  // 已有凭据的**明文** → id。⚠️ 必须解密：随机 IV 下密文逐次不同，比密文等于没比。
  const known = new Map<string, string>();
  for (const row of await prisma.platformToken.findMany({ where: { platform: 'coze' }, select: { id: true, token: true } })) {
    try {
      known.set(decrypt(row.token), row.id);
    } catch {
      // 读不出来的行（换了密钥、手改过）**跳过而不是中断**：一条坏记录不该让整个迁移停下，
      // 而停下意味着所有课堂的智能体都还挂在旧路上。
    }
  }

  // 按明文分组。`pending` 已按 createdAt 排序 ⇒ 每组第一个是**最早建的那个**，
  // 用它给凭据起名（见 migratedLabel）。
  const groups = new Map<string, { id: string; name: string }[]>();
  for (const agent of pending) {
    let plain: string;
    try {
      plain = isEncrypted(agent.apiKey) ? decrypt(agent.apiKey) : agent.apiKey;
    } catch {
      continue; // 同上：单条读不出来不阻断整体
    }
    if (!plain) continue;
    const list = groups.get(plain);
    if (list) list.push({ id: agent.id, name: agent.name });
    else groups.set(plain, [{ id: agent.id, name: agent.name }]);
  }

  let created = 0;
  let linked = 0;
  for (const [plain, list] of groups) {
    let tokenId = known.get(plain);
    if (!tokenId) {
      const row = await prisma.platformToken.create({
        data: {
          platform: 'coze',
          label: migratedLabel(list),
          token: encrypt(plain),
          expiresAt: null, // 纪律 2：不猜
        },
        select: { id: true },
      });
      tokenId = row.id;
      known.set(plain, tokenId);
      created += 1;
    }
    const updated = await prisma.agent.updateMany({
      where: { id: { in: list.map((agent) => agent.id) } },
      data: { credentialId: tokenId },
    });
    linked += updated.count;
  }

  return { tokens: created, linked };
}

/**
 * 迁移出来的凭据叫什么。
 *
 * 🔴 我们**不知道这是谁的账号**（系统认不出账号，只认 Token 字符串一样 —— 见 spec §一），
 * 所以这里给的是一个**可辨认、且明显该被改掉**的占位名：它说的是「这份 Token 是从哪儿来的」，
 * 教师看到就知道该把它改成「张老师的号」。
 *
 * ⚠️ 用**最早创建的那个智能体**的名字（`pending` 已按 `createdAt` 排序）：
 * 同一份 Token 的几个智能体里，最早那个通常就是教师最初配的那个，认起来最快。
 */
function migratedLabel(list: { name: string }[]): string {
  const first = list[0].name;
  return list.length === 1 ? `原「${first}」的 Token` : `原「${first}」等 ${list.length} 个智能体的 Token`;
}
