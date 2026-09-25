import crypto from 'crypto';

export const SCRYPT_PREFIX = 'scrypt';

/**
 * 管理密码的**准入判据**（唯一一处）。
 *
 * ★ 2026-09-25（教师要求「登录密码不限长度」）：原来的「至少 8 位」已去掉。
 *
 * 🔴 **长度不限，但「非空」必须留着** —— 它不是长度限制，是登录本身：
 *    空密码照样会被哈希、照样会写进 `admin_password` 那一行 ⇒ 那一行**存在**
 *    ⇒ `POST /verify` 的 `if (!stored) return { firstTime: true }`（含义是「还没设密码」）
 *    不再成立 ⇒ **任何人提交一个空密码就登录了教师端**。
 *    所以「顺手把校验整个删掉」与「按这次的要求放宽」是两件完全不同的事。
 *
 * ⚠️ 非字符串一律拒：请求体是外部输入，`12345678` 这种从类型缝里进来的值
 * 会在 `hashPassword` 里被隐式转成字符串，落库之后看着完全正常。
 *
 * ⚠️ 放宽之后的**残余防护**只剩 `routes/settings.ts` 的 `nextLoginAttempt`
 *    （同源 5 次失败 ⇒ 封 60 秒）。1~2 位的密码在那个限流下几分钟就能撞开 ——
 *    这是教师知情后的选择，不是这里漏了哪一道。
 */
export function isAcceptablePassword(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `${SCRYPT_PREFIX}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored.startsWith(`${SCRYPT_PREFIX}$`)) {
    const legacy = crypto.createHash('sha256').update(password).digest('hex');
    const actual = Buffer.from(legacy);
    const expected = Buffer.from(stored);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  try {
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
    const expected = Buffer.from(hashHex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
