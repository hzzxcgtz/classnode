export function shouldPreserveAgentSecret(previousPlatform: string | null | undefined, nextPlatform: string | null | undefined) {
  return !nextPlatform || nextPlatform === previousPlatform;
}

/**
 * 掩码：公开前后各 4 个字符，中间一律 6 个星号。
 *
 * ⊘ 2026-09-25（教师）：「星号太多太长了，可以适当的减少一些，意思到就行，否则一行显示不下」。
 * 原来是 `'*'.repeat(len - 8)` —— 一个 40 位的扣子 Token 会印出 32 个星号，
 * 加上前后缀将近 40 个字符，在列表里撑成两行，而**多出来的星号一个比特的信息都没有**。
 *
 * ⚠️ 星号数是**固定**的（不再随长度变化）：这也顺手去掉了一条侧信道 ——
 * 从前数一数星号就知道密钥多长，而现在掩码长度本身就是常数。
 * 8 位以内的短值仍然全掩（那种长度下「露 8 个字符」等于没掩）。
 */
const MASK_STARS = 6;

export function maskAgentSecret(secret: string): string {
  if (secret.length <= 8) return '*'.repeat(secret.length);
  return secret.slice(0, 4) + '*'.repeat(MASK_STARS) + secret.slice(-4);
}
