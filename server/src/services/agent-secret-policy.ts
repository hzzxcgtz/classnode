export function shouldPreserveAgentSecret(previousPlatform: string | null | undefined, nextPlatform: string | null | undefined) {
  return !nextPlatform || nextPlatform === previousPlatform;
}

/** 保留密钥实际长度，仅公开前后各 4 个字符。 */
export function maskAgentSecret(secret: string): string {
  if (secret.length <= 8) return '*'.repeat(secret.length);
  return secret.slice(0, 4) + '*'.repeat(secret.length - 8) + secret.slice(-4);
}
