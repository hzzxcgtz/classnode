import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { imageVersion, readRotatableImage, rotateStoredImage, containsImageUrl } from '../services/image-rotation.js';

const url = '/uploads/chat/chat-11111111-1111-4111-8111-111111111111.png';
const pixels = Buffer.from([255,0,0, 0,255,0, 0,0,255, 255,255,0, 0,255,255, 255,0,255]);
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'classnode-rotate-'));
  const original = await sharp(pixels, {raw:{width:3,height:2,channels:3}}).png().toBuffer();
  await fs.writeFile(path.join(directory,path.basename(url)), original);
  return {directory,original};
}
test('right/left rotations persist pixels, dimensions and version, and four turns restore the original', async () => {
  const f = await fixture();
  try {
    let version = imageVersion(f.original);
    const first = await rotateStoredImage(f.directory,url,90,version);
    version=first.version;
    const rotated=await readRotatableImage(f.directory,url);
    const {data,info}=await sharp(rotated.data).raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,2);assert.equal(info.height,3);
    assert.deepEqual([...data.subarray(0,3)],[255,255,0]);
    assert.notEqual(version,imageVersion(f.original));
    for(let i=0;i<3;i++)version=(await rotateStoredImage(f.directory,url,90,version)).version;
    assert.deepEqual(await sharp((await readRotatableImage(f.directory,url)).data).raw().toBuffer(),pixels);
    const left=await rotateStoredImage(f.directory,url,-90,version);
    const leftPixels=await sharp((await readRotatableImage(f.directory,url)).data).raw().toBuffer();
    assert.deepEqual([...leftPixels.subarray(0,3)],[0,0,255]);assert.equal(left.version,imageVersion((await readRotatableImage(f.directory,url)).data));
  } finally {await fs.rm(f.directory,{recursive:true,force:true});}
});
test('camera EXIF is normalized before applying the requested rotation',async()=>{
  const f=await fixture(); const jpegUrl=url.replace('.png','.jpg');
  try{
    const jpeg=await sharp(pixels,{raw:{width:3,height:2,channels:3}}).jpeg().withMetadata({orientation:6}).toBuffer();
    await fs.writeFile(path.join(f.directory,path.basename(jpegUrl)),jpeg);
    await rotateStoredImage(f.directory,jpegUrl,90,imageVersion(jpeg));
    const meta=await sharp((await readRotatableImage(f.directory,jpegUrl)).data).metadata();
    assert.equal(meta.width,3);assert.equal(meta.height,2);assert.equal(meta.orientation,undefined);
  }finally{await fs.rm(f.directory,{recursive:true,force:true});}
});
test('stale versions, invalid angles, traversal, symlinks and bad images never overwrite the source',async()=>{
  const f=await fixture();
  try{
    const version=imageVersion(f.original);
    for(const angle of [0,45,'90',null])await assert.rejects(rotateStoredImage(f.directory,url,angle,version));
    await assert.rejects(rotateStoredImage(f.directory,url,90,'a'.repeat(64)),/其他人修改/);
    for(const bad of ['/uploads/chat/../other.png','https://example.com'+url,'/uploads/chat/evil.png',url+'?v=1'])await assert.rejects(readRotatableImage(f.directory,bad));
    assert.deepEqual((await readRotatableImage(f.directory,url)).data,f.original);
    await fs.writeFile(path.join(f.directory,path.basename(url)),Buffer.from('not an image'));
    await assert.rejects(rotateStoredImage(f.directory,url,90,imageVersion(Buffer.from('not an image'))));
    assert.equal((await readRotatableImage(f.directory,url)).data.toString(),'not an image');
    assert.equal((await fs.readdir(f.directory)).length,1);
    // Windows runners may not grant symbolic-link creation privileges.
    if (process.platform !== 'win32') {
      await fs.unlink(path.join(f.directory,path.basename(url)));
      await fs.writeFile(path.join(f.directory,'original.png'),f.original);
      await fs.symlink(path.join(f.directory,'original.png'),path.join(f.directory,path.basename(url)));
      await assert.rejects(readRotatableImage(f.directory,url),/路径无效/);
    }
  }finally{await fs.rm(f.directory,{recursive:true,force:true});}
});
test('image ownership matches exact nested URL references, not partial text',()=>{
  assert.equal(containsImageUrl({format:'photo/v1',url},url),true);
  assert.equal(containsImageUrl([url],url),true);
  assert.equal(containsImageUrl({text:'other '+url},url),false);
});

test('rotation notifications include only referenced participants and their teacher rooms',async()=>{
  const {imageRotationRooms}=await import('../services/image-rotation.js');
  const rooms=await imageRotationRooms({
    worksheetAnswer:{findMany:async()=>[
      {value:{url},response:{classroomId:'room1',participantId:'alice'}},
      {value:{url:'/uploads/chat/another.png'},response:{classroomId:'other-room',participantId:'stranger'}},
    ]},
    worksheetAnswerReview:{findMany:async()=>[
      {value:{url},answer:{response:{classroomId:'room1',participantId:'alice'}}},
    ]},
    message:{findMany:async()=>[
      {fileUrls:JSON.stringify([url]),classroomId:'room2',studentId:'bob'},
      {fileUrls:'not JSON',classroomId:'other-room',studentId:'stranger'},
    ]},
  } as never,url,{classroomId:'room1',studentId:'alice'});
  assert.deepEqual(rooms.sort(),['participant:room1:alice','participant:room2:bob','teacher:room1','teacher:room2']);
});
