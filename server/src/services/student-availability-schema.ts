import type { PrismaClient } from '@prisma/client';

/** Run before legacy Prisma reads so old databases can acquire the new default safely. */
export async function ensureStudentAvailabilityColumn(prisma: PrismaClient): Promise<void> {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>("PRAGMA table_info('Student')");
  if (columns.length && !columns.some(column => column.name === 'disabled')) {
    await prisma.$executeRawUnsafe('ALTER TABLE "Student" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false');
  }
}
