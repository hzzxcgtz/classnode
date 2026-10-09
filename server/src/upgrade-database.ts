import { PrismaClient } from '@prisma/client';
import { recoverInterruptedMaintenance } from './services/full-backup.js';
import { upgradeDatabase } from './services/database-upgrade.js';

const prisma = new PrismaClient();
try {
  recoverInterruptedMaintenance();
  const result = await upgradeDatabase(prisma);
  console.log(JSON.stringify({ upgraded: result.backupPath !== null, backupPath: result.backupPath }));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
