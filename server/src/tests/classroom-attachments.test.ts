import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import express from 'express';
import { createRequire } from 'node:module';
import { ATTACHMENT_URL, classroomUploadRelative, ensureAttachmentDirectory, resolveAttachmentFile } from '../services/upload-paths.js';
import { ArchiveAssets } from '../services/classroom-archive-assets.js';
import { readWordImage } from '../services/worksheet-docx-layout.js';
import { cleanupOrphanedUploads } from '../routes/upload.js';
import exportRoutes from '../routes/export.js';

const name = 'chat-11111111-1111-4111-8111-111111111111.png';
const oldUrl = `/uploads/chat/${name}`;
const newUrl = `/uploads/classrooms/room-one/worksheet/${name}`;
const Zip = createRequire(import.meta.url)('adm-zip');

test('legacy and classroom files resolve safely, export to Word/archive, and cleanup preserves every referenced revision', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'classnode-scoped-assets-'));
  const previous = process.env.CLASSNODE_DATA_DIR; process.env.CLASSNODE_DATA_DIR = root;
  try {
    const uploads = path.join(root, 'uploads');
    const image = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#ddd' } }).png().toBuffer();
    for (const url of [oldUrl, newUrl]) {
      const dir = ensureAttachmentDirectory(uploads, path.posix.dirname(url.slice(9)));
      fs.writeFileSync(path.join(dir, name), image);
      assert.equal(resolveAttachmentFile(uploads, url), path.join(root, url.slice(1)));
      assert.ok(await readWordImage(url), 'Word export embeds both path formats');
    }
    assert.equal(classroomUploadRelative('room-one', 'chat'), 'classrooms/room-one/chat');
    for (const id of ['..', 'a/b', 'a\\b', '', '%2e%2e']) assert.throws(() => classroomUploadRelative(id, 'chat'));
    for (const url of [newUrl.replace('room-one', '..'), newUrl+'?x', '/uploads/classrooms/room-one/worksheet/evil.html']) assert.equal(ATTACHMENT_URL.test(url), false);
    const assets = new ArchiveAssets(path.join(root, 'export'), uploads, path.join(root, 'webapps'));
    assets.scan({ legacy: oldUrl, answer: { url: newUrl }, history: [newUrl] });
    assert.equal(assets.inventory.length, 2, 'archive collects and deduplicates scoped and legacy assets');
    assert.equal(assets.warnings.length, 0);
    const orphan = name.replace('111111111111.png', '111111111112.png');
    const recent = name.replace('111111111111.png', '111111111113.png');
    const scopedDir = path.join(uploads, 'classrooms/room-one/worksheet');
    fs.writeFileSync(path.join(scopedDir, orphan), image);fs.writeFileSync(path.join(scopedDir, recent), image);
    const old = new Date(Date.now()-25*3600_000);
    for (const file of [path.join(uploads,'chat',name),path.join(scopedDir,name),path.join(scopedDir,orphan)]) fs.utimesSync(file,old,old);
    const prisma = { classroomAnnotation:{findMany:async()=>[]}, message:{findMany:async()=>[{fileUrls:JSON.stringify([oldUrl])}]}, avatar:{findMany:async()=>[]},worksheet:{findMany:async()=>[]},worksheetAnswer:{findMany:async()=>[]},worksheetAnswerReview:{findMany:async()=>[{value:{url:newUrl},question:{}}]} };
    const result = await cleanupOrphanedUploads(prisma as never,{chatDirectory:path.join(uploads,'chat'),avatarDirectory:path.join(uploads,'avatars')});
    assert.equal(result.chat,1);assert.ok(fs.existsSync(path.join(scopedDir,name)));assert.ok(fs.existsSync(path.join(scopedDir,recent)));assert.equal(fs.existsSync(path.join(scopedDir,orphan)),false);
    if (process.platform !== 'win32') {
      fs.symlinkSync(scopedDir,path.join(uploads,'classrooms/linked'));
      assert.equal(resolveAttachmentFile(uploads,newUrl.replace('room-one','linked')),null);
      assert.throws(()=>ensureAttachmentDirectory(uploads,'classrooms/linked/chat'));
    }
  } finally { if(previous===undefined)delete process.env.CLASSNODE_DATA_DIR;else process.env.CLASSNODE_DATA_DIR=previous;fs.rmSync(root,{recursive:true,force:true}); }
});

test('attachment-only backup round trip includes classroom directories and still imports old flat archives',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'classnode-attachment-backup-'));
  const previous=process.env.CLASSNODE_DATA_DIR;process.env.CLASSNODE_DATA_DIR=root;
  const app=express();app.use('/api/export',exportRoutes);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/export`;
  try{
    for(const url of [oldUrl,newUrl]){const file=path.join(root,url.slice(1));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'saved image');}
    const response=await fetch(base+'/backup/uploads-chat');assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());const zip=new Zip(bytes);
    assert.ok(zip.getEntry('chat/'+name));assert.ok(zip.getEntry('classrooms/room-one/worksheet/'+name));
    fs.rmSync(path.join(root,'uploads'),{recursive:true,force:true});
    const send=async(data:Buffer)=>{const form=new FormData();form.append('file',new Blob([new Uint8Array(data)]),'attachments.classchat');return fetch(base+'/backup/uploads-chat/import',{method:'POST',body:form});};
    assert.equal((await send(bytes)).status,200);for(const url of [oldUrl,newUrl])assert.equal(fs.readFileSync(path.join(root,url.slice(1)),'utf8'),'saved image');
    const legacy=new Zip();legacy.addFile(name,Buffer.from('legacy flat'));assert.equal((await send(legacy.toBuffer())).status,200);assert.equal(fs.readFileSync(path.join(root,'uploads/chat',name),'utf8'),'legacy flat');
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));if(previous===undefined)delete process.env.CLASSNODE_DATA_DIR;else process.env.CLASSNODE_DATA_DIR=previous;fs.rmSync(root,{recursive:true,force:true});}
});
