import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { decrypt, encrypt, isEncrypted } from '../services/crypto.js';
import { maskAgentSecret } from '../services/agent-secret-policy.js';

/**
 * ★ 2026-09-25：**共享 API Token 的管理端点**（spec §三①）。
 *
 * 教师在这里维护若干份「某账号的 Token」，建/改智能体时选一份。
 * 起因：Coze 低代码的 Token 属于**扣子账号**、不属于 Bot —— 同一个号做出来的多个智能体
 * 从前各存一份，换一次要改 N 遍。
 *
 * ── 三条硬规矩 ────────────────────────────────────────────────────────────
 *
 * 1. 🔴 **明文 Token 只在进库那一次出现。** 出去的方向一律走 `maskAgentSecret`
 *    （首尾各 4 个字符）—— 与智能体列表那边同一条纪律。
 *
 * 2. 🔴 **正在被智能体用着的凭据删不掉。** 外键虽然是 `RESTRICT`，但**不能只靠它**：
 *    数据库回的是一个 500 级的 Prisma 错误，教师看到的是「删除失败」而不知道**为什么**。
 *    所以先查引用、给出「哪几个智能体在用」再拒。
 *
 * 3. 🔴 **改 Token 的值要能说清影响面。** 删除有守卫（删不掉），改值是「改得掉但要说清」——
 *    一份凭据被 3 个智能体用着时，改它就是同时改那 3 个的钥匙。界面据此提示。
 */
const router: Router = Router();

/** 读得出来就用读出来的；读不出来把原串当明文（老库存过未加密的值，换过密钥的行也不该让整个列表 500）。 */
function decryptOrRaw(value: string): string {
  try {
    return isEncrypted(value) ? decrypt(value) : value;
  } catch {
    return value;
  }
}

/** 出参形状：**永不包含明文 token**。`agentCount` 是引用面（删除守卫与影响面提示共用）。 */
function toView(row: { id: string; platform: string; label: string; token: string; expiresAt: Date | null; createdAt: Date }, agentCount: number) {
  return {
    id: row.id,
    platform: row.platform,
    label: row.label,
    /**
     * 掩码，给教师**认自己的 Token**用（「我填的是不是这个」）。
     *
     * 🔴 **必须解密之后再掩码。** 直接 `maskAgentSecret(row.token)` 盖的是**密文** ——
     * 出参看着像掩码、其实首尾露的是密文的字符：教师认不出自己的 Token（这个字段就没用了），
     * 而密文的首尾也白送出去。与 `routes/agents.ts:137` 那条同款（那边也是先解密再掩码）。
     *
     * ⚠️ 容错照抄别处：读不出来（老库的明文值 / 换过密钥）就把原串拿去掩码 ——
     * 列表接口不该因为一行坏数据整个 500。
     */
    maskedToken: maskAgentSecret(decryptOrRaw(row.token)),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    agentCount,
  };
}

/**
 * 把请求里的 `expiresAt` 读成一个日期或 `null`。
 *
 * 🔴 「没给」与「显式清空」是**两件事**（与 `captureFieldsFromInput` 那条纪律逐字相同）：
 *   · 字段**不在**请求里 ⇒ 返回 `undefined` = 这次不改它；
 *   · 字段是 `null` / 空串 ⇒ 返回 `null` = 清掉有效期（回到「未设置」那个要被催促的状态）；
 *   · 别的 ⇒ 解析；解析不出来就回 `undefined`（**不写库**），由调用方决定报不报错。
 */
function readExpiresAt(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** 列表：每份凭据带上「几个智能体在用」。 */
router.get('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const rows = await prisma.platformToken.findMany({ orderBy: { createdAt: 'asc' } });
    // 一次 groupBy 拿全部计数，避免 N 次 count（列表通常只有几行，但这条写法不随行数退化）。
    const grouped = await prisma.agent.groupBy({ by: ['credentialId'], _count: { _all: true } });
    const counts = new Map(grouped.map((g) => [g.credentialId, g._count._all]));
    res.json(rows.map((row) => toView(row, counts.get(row.id) ?? 0)));
  } catch (error) {
    console.error('[PlatformToken] list error:', error);
    res.status(500).json({ error: '获取访问令牌列表失败' });
  }
});

router.post('/', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const { label, token, platform } = req.body ?? {};
    // 备注必填：一份没有名字的凭据，在一份列表里等于没有（spec §一）。
    if (typeof label !== 'string' || label.trim() === '') return res.status(400).json({ error: '请填写备注（这是谁的账号）' });
    if (typeof token !== 'string' || token.trim() === '') return res.status(400).json({ error: '请填写访问令牌' });
    const expiresAt = readExpiresAt(req.body?.expiresAt);
    if (expiresAt === undefined && req.body?.expiresAt !== undefined) {
      return res.status(400).json({ error: '有效期格式不正确' });
    }

    const row = await prisma.platformToken.create({
      data: {
        platform: typeof platform === 'string' && platform ? platform : 'coze',
        label: label.trim(),
        token: encrypt(token.trim()),
        // ⚠️ 新建时**允许留空**（= 之后会被界面催促去填），但界面上是必填的（spec §一）。
        expiresAt: expiresAt ?? null,
      },
    });
    res.json(toView(row, 0));
  } catch (error) {
    console.error('[PlatformToken] create error:', error);
    res.status(500).json({ error: '新建访问令牌失败' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const existing = await prisma.platformToken.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: '访问令牌不存在' });

    const { label, token } = req.body ?? {};
    const data: { label?: string; token?: string; expiresAt?: Date | null } = {};
    if (typeof label === 'string' && label.trim() !== '') data.label = label.trim();
    // 🔴 **不给 token 字段就不动它**：界面回显的是掩码，提交时也不回传 ——
    //    写成 `data.token = encrypt(token ?? '')` 会把一份好凭据覆盖成空串的密文，
    //    而那个错误**任何地方都不会报**（密文看起来正常，直到所有用它的智能体 401）。
    if (typeof token === 'string' && token.trim() !== '') data.token = encrypt(token.trim());
    const expiresAt = readExpiresAt(req.body?.expiresAt);
    if (req.body?.expiresAt !== undefined) {
      if (expiresAt === undefined) return res.status(400).json({ error: '有效期格式不正确' });
      data.expiresAt = expiresAt;
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ error: '没有要修改的内容' });

    const row = await prisma.platformToken.update({ where: { id: req.params.id }, data });
    const agentCount = await prisma.agent.count({ where: { credentialId: row.id } });
    res.json(toView(row, agentCount));
  } catch (error) {
    console.error('[PlatformToken] update error:', error);
    res.status(500).json({ error: '保存访问令牌失败' });
  }
});

/**
 * 查引用面。**与删除是两条端点、两个用途**：
 *   · 删除前用它给出「删不掉，因为这几个在用」；
 *   · 改值前用它给出「会影响这几个」。
 * 合成一条会让「只是想看看影响面」也走删除那条路 —— 而那是不可逆的。
 */
router.get('/:id/usage', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const token = await prisma.platformToken.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!token) return res.status(404).json({ error: '访问令牌不存在' });
    const agents = await prisma.agent.findMany({
      where: { credentialId: req.params.id },
      select: { id: true, name: true, platform: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ used: agents.length > 0, agentCount: agents.length, agents });
  } catch (error) {
    console.error('[PlatformToken] usage error:', error);
    res.status(500).json({ error: '查询引用失败' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const prisma: PrismaClient = req.app.get('prisma');
    const token = await prisma.platformToken.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!token) return res.status(404).json({ error: '访问令牌不存在' });

    // 🔴 先查引用再删，**不靠外键兜底**：外键回的是一个 500 级的 Prisma 错误，
    //    教师看到「删除失败」而不知道是哪几个智能体在用它 —— 一个说不出原因的拒绝，
    //    与一个允许了却做不到的承诺一样糟。
    const agents = await prisma.agent.findMany({
      where: { credentialId: req.params.id },
      select: { name: true },
      orderBy: { createdAt: 'asc' },
    });
    if (agents.length > 0) {
      return res.status(400).json({
        error: `还有 ${agents.length} 个智能体在用它：${agents.map((a) => a.name).join('、')}。请先把它们改成别的 Token，或者删掉它们。`,
      });
    }

    await prisma.platformToken.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('[PlatformToken] delete error:', error);
    res.status(500).json({ error: '删除访问令牌失败' });
  }
});

export default router;
