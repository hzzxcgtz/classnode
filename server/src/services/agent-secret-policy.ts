export function shouldPreserveAgentSecret(previousPlatform: string | null | undefined, nextPlatform: string | null | undefined) {
  return !nextPlatform || nextPlatform === previousPlatform;
}
