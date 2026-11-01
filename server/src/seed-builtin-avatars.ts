import { PrismaClient } from '@prisma/client';
import { ensureBuiltinAvatarPool } from './services/builtin-avatar-pool.js';
const prisma = new PrismaClient();
try {
  const count = await ensureBuiltinAvatarPool(prisma);
  console.log(`[avatars] 预置 ${count} 个默认头像`);
} finally {
  await prisma.$disconnect();
}
