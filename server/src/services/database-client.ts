import { PrismaClient } from '@prisma/client';

/** SQLite has one writer. Share a connection so polling cannot lock out commits. */
export function sqliteConnectionUrl(url: string): string {
  const separator = url.indexOf('?');
  const filename = separator < 0 ? url : url.slice(0, separator);
  const params = new URLSearchParams(separator < 0 ? '' : url.slice(separator + 1));
  params.set('connection_limit', '1');
  return `${filename}?${params}`;
}

export function createDatabaseClient(url = process.env.DATABASE_URL || 'file:./dev.db'): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: sqliteConnectionUrl(url) } } });
}
