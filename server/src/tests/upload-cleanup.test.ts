import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupOrphanedUploads } from '../routes/upload.js';

const referencedChat = 'chat-550e8400-e29b-41d4-a716-446655440000.png';
const orphanChat = 'chat-550e8400-e29b-41d4-a716-446655440001.png';
const recentChat = 'chat-550e8400-e29b-41d4-a716-446655440002.png';
const referencedWorksheetImage = 'chat-550e8400-e29b-41d4-a716-446655440005.webp';
const referencedWorksheetBackground = 'chat-550e8400-e29b-41d4-a716-446655440006.webp';
const referencedWorksheetPortraitBackground = 'chat-550e8400-e29b-41d4-a716-446655440007.webp';
const referencedAvatar = 'avatar-550e8400-e29b-41d4-a716-446655440003.png';
const orphanAvatar = 'avatar-550e8400-e29b-41d4-a716-446655440004.png';

test('orphan upload cleanup preserves referenced and recent files', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-upload-cleanup-'));
  const chatDirectory = path.join(root, 'chat');
  const avatarDirectory = path.join(root, 'avatars');
  fs.mkdirSync(chatDirectory);
  fs.mkdirSync(avatarDirectory);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const now = Date.now();
  for (const name of [referencedChat, orphanChat, recentChat, referencedWorksheetImage, referencedWorksheetBackground, referencedWorksheetPortraitBackground]) fs.writeFileSync(path.join(chatDirectory, name), 'file');
  for (const name of [referencedAvatar, orphanAvatar]) fs.writeFileSync(path.join(avatarDirectory, name), 'file');
  const old = new Date(now - 25 * 60 * 60 * 1000);
  for (const name of [referencedChat, orphanChat, referencedWorksheetImage, referencedWorksheetBackground, referencedWorksheetPortraitBackground]) fs.utimesSync(path.join(chatDirectory, name), old, old);
  for (const name of [referencedAvatar, orphanAvatar]) fs.utimesSync(path.join(avatarDirectory, name), old, old);

  const prisma = {
    message: { findMany: async () => [{ fileUrls: JSON.stringify([`/uploads/chat/${referencedChat}`]) }] },
    avatar: { findMany: async () => [{ svgContent: `<svg><image href="/uploads/avatars/${referencedAvatar}" /></svg>` }] },
    worksheet: {
      findMany: async () => [{
        content: { nodes: [{ data: { promptImageUrl: `/uploads/chat/${referencedWorksheetImage}` } }] },
        settings: {
          backgroundImageUrl: `/uploads/chat/${referencedWorksheetBackground}`,
          backgroundPortraitImageUrl: `/uploads/chat/${referencedWorksheetPortraitBackground}`,
        },
      }],
    },
  };
  const result = await cleanupOrphanedUploads(prisma as never, { now, chatDirectory, avatarDirectory });

  assert.deepEqual(result, { chat: 1, avatars: 1 });
  assert.equal(fs.existsSync(path.join(chatDirectory, referencedChat)), true);
  assert.equal(fs.existsSync(path.join(chatDirectory, orphanChat)), false);
  assert.equal(fs.existsSync(path.join(chatDirectory, recentChat)), true);
  assert.equal(fs.existsSync(path.join(chatDirectory, referencedWorksheetImage)), true);
  assert.equal(fs.existsSync(path.join(chatDirectory, referencedWorksheetBackground)), true);
  assert.equal(fs.existsSync(path.join(chatDirectory, referencedWorksheetPortraitBackground)), true);
  assert.equal(fs.existsSync(path.join(avatarDirectory, referencedAvatar)), true);
  assert.equal(fs.existsSync(path.join(avatarDirectory, orphanAvatar)), false);
});
