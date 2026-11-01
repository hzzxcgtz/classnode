import type { PrismaClient } from '@prisma/client';
import { generateRandomStudentAvatarByGender } from './student-avatar-generator.js';

/** Empty libraries only: never replace user images or student assignments. */
export async function ensureBuiltinAvatarPool(prisma: PrismaClient): Promise<number> {
  return prisma.$transaction(async tx => {
    if (await tx.avatar.count() !== 0) return 0;
    const seen = new Set<string>();
    const avatars = [];
    for (const gender of ['boy', 'girl'] as const) {
      let count = 0;
      for (let attempt = 0; count < 20 && attempt < 200; attempt++) {
        const avatar = generateRandomStudentAvatarByGender(gender);
        if (seen.has(avatar.svgContent)) continue;
        seen.add(avatar.svgContent);
        avatars.push({ ...avatar, category: 'student', source: 'teacher', sortOrder: avatars.length, isActive: true });
        count++;
      }
      if (count !== 20) throw new Error('无法生成足够的不重复默认头像');
    }
    await tx.avatar.createMany({ data: avatars });
    return avatars.length;
  });
}
