import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureBuiltinAvatarPool } from '../services/builtin-avatar-pool.js';
import { sanitizeSvg } from '../services/svg-sanitizer.js';

test('empty libraries receive 20 avatars of each gender; existing libraries stay unchanged', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'classnode-avatars-'));
  const db = new PrismaClient({ datasourceUrl: `file:${path.join(dir, 'test.db')}` });
  try {
    await db.$executeRawUnsafe('CREATE TABLE Avatar (id INTEGER PRIMARY KEY AUTOINCREMENT, svgContent TEXT NOT NULL, category TEXT NOT NULL DEFAULT "student", gender TEXT NOT NULL DEFAULT "neutral", sortOrder INTEGER NOT NULL DEFAULT 0, isActive BOOLEAN NOT NULL DEFAULT true, source TEXT NOT NULL DEFAULT "teacher", createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    assert.equal(await ensureBuiltinAvatarPool(db), 40);
    const avatars = await db.avatar.findMany({ orderBy: { id: 'asc' } });
    for (const gender of ['boy', 'girl']) assert.equal(avatars.filter(a => a.gender === gender).length, 20);
    assert.equal(new Set(avatars.map(a => a.svgContent)).size, 40);
    for (const avatar of avatars) assert.ok(sanitizeSvg(avatar.svgContent));
    assert.equal(await ensureBuiltinAvatarPool(db), 0);
    assert.deepEqual(await db.avatar.findMany({ orderBy: { id: 'asc' } }), avatars);
    await db.avatar.deleteMany();
    const custom = await db.avatar.create({ data: { svgContent: '<svg/>', category: 'class' } });
    assert.equal(await ensureBuiltinAvatarPool(db), 0);
    assert.deepEqual(await db.avatar.findMany(), [custom]);
  } finally { await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
