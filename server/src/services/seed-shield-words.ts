import type { PrismaClient } from '@prisma/client';
import defaultShieldWords from './default-shield-words.js';

/** Preserve existing words and the first-initialization rule, with one commit. */
export async function seedShieldWords(prisma: PrismaClient): Promise<number> {
  return prisma.$transaction(async tx => {
    if (await tx.shieldWord.count({ where: { builtin: true } }) > 0) return 0;
    const words = [...new Set(defaultShieldWords)];
    const existing = new Set((await tx.shieldWord.findMany({
      where: { word: { in: words } }, select: { word: true },
    })).map(row => row.word));
    const data = words.filter(word => !existing.has(word)).map(word => ({ word, builtin: true }));
    if (!data.length) return 0;
    return (await tx.shieldWord.createMany({ data })).count;
  }, { timeout: 30000 });
}
