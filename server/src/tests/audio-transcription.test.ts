import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {PrismaClient} from '@prisma/client';
import {recognizeAudio,transcribeRecording,transcriptionConfig,TRANSCRIPTION_CONFIG} from '../services/audio-transcription.js';
test('transcription sends multipart file and handles empty/error upstream responses',async()=>{
 const text=await recognizeAudio(Buffer.from('OggSsample'),'test-token',async(_url,options)=>{
  assert.ok(options?.body instanceof FormData);assert.ok(options.body.get('file') instanceof Blob);assert.equal(new Headers(options.headers).get('Content-Type'),null);
  return Response.json({code:0,data:{text:' 学生原话。 '}});
 });assert.equal(text,'学生原话。');
 await assert.rejects(recognizeAudio(Buffer.from('OggS'),'x',async()=>Response.json({code:0,data:{text:' '}})),/未识别/);
 await assert.rejects(recognizeAudio(Buffer.from('OggS'),'x',async()=>new Response('secret',{status:403})),/createTranscription/);
});
test('saved transcripts survive service calls, separate recordings and changed bytes; reads never bill',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'classnode-asr-'));const previous=process.env.CLASSNODE_DATA_DIR;process.env.CLASSNODE_DATA_DIR=dir;
 const values=new Map<string,string>([[TRANSCRIPTION_CONFIG,JSON.stringify({credentialId:'test',enabled:true})]]);
 const db={setting:{findUnique:async({where}:{where:{key:string}})=>values.has(where.key)?{value:values.get(where.key)}:null,upsert:async({where,create}:{where:{key:string};create:{value:string}})=>{values.set(where.key,create.value);}},platformToken:{findUnique:async()=>({platform:'coze',token:'test-token',expiresAt:null})}} as unknown as PrismaClient;
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return Response.json({code:0,data:{text:`转写${calls}`}});};
 const url='/uploads/chat/chat-1234.ogg';const file=path.join(dir,url.slice(1));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'OggSfirst');
 try{
  assert.equal(await transcribeRecording(db,url,false,fetcher),null);assert.equal(calls,0);
  const [a,b]=await Promise.all([transcribeRecording(db,url,true,fetcher),transcribeRecording(db,url,true,fetcher)]);assert.deepEqual(a,b);assert.equal(calls,1);
  assert.deepEqual(await transcribeRecording(db,url,false,fetcher),a);assert.equal(calls,1);
  assert.equal((await transcriptionConfig(db)).enabled,true,'explicit enable is preserved');
  values.set(TRANSCRIPTION_CONFIG,JSON.stringify({credentialId:'test',enabled:false}));
  assert.deepEqual(await transcribeRecording(db,url,true,fetcher),a,'disabled service still returns saved text');
  await fs.writeFile(file,'OggSnew-disabled');await assert.rejects(transcribeRecording(db,url,true,fetcher),/尚未开启/);assert.equal(calls,1,'disabled service never calls upstream');
  values.set(TRANSCRIPTION_CONFIG,JSON.stringify({credentialId:'test',enabled:true}));
  await fs.writeFile(file,'OggSsecond');assert.equal(await transcribeRecording(db,url,false,fetcher),null);await transcribeRecording(db,url,true,fetcher);assert.equal(calls,2);
  await assert.rejects(transcribeRecording(db,'https://example.com/private.ogg',true,fetcher),/仅支持/);
  await assert.rejects(transcribeRecording(db,'/uploads/chat/../../secret.ogg',true,fetcher),/仅支持/);
  if(process.platform!=='win32'){await fs.symlink('/etc/hosts',path.join(dir,'uploads/chat/chat-5678.ogg'));await assert.rejects(transcribeRecording(db,'/uploads/chat/chat-5678.ogg',true,fetcher),/路径无效/);}
 }finally{if(previous===undefined)delete process.env.CLASSNODE_DATA_DIR;else process.env.CLASSNODE_DATA_DIR=previous;await fs.rm(dir,{recursive:true,force:true});}
});

test('speech recognition and synthesis default off until explicitly enabled', async () => {
 const {speechConfig} = await import('../services/coze-speech.js');
 for (const value of [null, '{}', '{"credentialId":"saved"}', 'invalid']) {
  const db = {setting:{findUnique:async()=>value===null?null:{value}}} as unknown as PrismaClient;
  assert.equal((await speechConfig(db)).enabled,false);
  assert.equal((await transcriptionConfig(db)).enabled,false);
 }
});
