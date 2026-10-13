import type { PrismaClient } from '@prisma/client';

/** 旧库只补列，不重建表、不修改课堂和消息记录。 */
export async function ensureClassroomMaterialColumns(prisma: PrismaClient): Promise<void> {
  const columns = await prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info('Classroom')`);
  const names = new Set(columns.map(column => column.name));
  if (!names.has('materialsRevision')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Classroom" ADD COLUMN "materialsRevision" INTEGER NOT NULL DEFAULT 0`);
  }
  if (!names.has('agentContextStarts')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Classroom" ADD COLUMN "agentContextStarts" JSONB`);
  }
}
