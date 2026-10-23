import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { createStudentToken, revokeAllStudentSessions } from '../middleware/student-auth.js';
import { createTeacherSession, revokeAllTeacherSessions } from '../middleware/auth.js';

test('rotation authorizes only teachers and active owners; saves immediately without altering answers or evaluations', async () => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'classnode-image-access-'));
  const previous=process.env.CLASSNODE_DATA_DIR;process.env.CLASSNODE_DATA_DIR=directory;
  const {default:uploads}=await import('../routes/upload.js');
  const app=express();app.use(express.json());
  let active=true;
  let forgedReferences=false;
  let answerValue: unknown=null;
  app.set('prisma', {
    classroomStudent:{findFirst:async()=>active?{id:'alice'}:null},
    worksheetAnswer:{findMany:async({where}: {where:{response:{participantId:string}}})=>(where.response.participantId==='alice'||forgedReferences)?[{value:answerValue}]:[]},
    worksheetAnswerReview:{findMany:async()=>[]},message:{findMany:async()=>[]},
  });
  app.get('/teacher-login',(_req,res)=>{createTeacherSession(res);res.json({ok:true});});
  app.use('/api/upload',uploads);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const imageUrl='/uploads/chat/chat-11111111-1111-4111-8111-111111111111.png';
  const token=createStudentToken('room','alice'),other=createStudentToken('room','bob');
  const info=(credential?:string)=>fetch(`${base}/api/upload/image-orientation?url=${encodeURIComponent(imageUrl)}`,{headers:credential?{Authorization:`Bearer ${credential}`}:{}});
  const save=(credential:string,version:string)=>fetch(`${base}/api/upload/image-orientation`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential}`},body:JSON.stringify({url:imageUrl,degrees:90,version})});
  try{
    const original=await sharp({create:{width:80,height:40,channels:3,background:'#aaccff'}}).png().toBuffer();
    const file=path.join(directory,'uploads','chat',path.basename(imageUrl));await fs.writeFile(file,original);
    assert.equal((await info()).status,401);
    assert.equal((await info(token)).status,403,'unreferenced files are not owned merely by knowing URL');
    answerValue={format:'photo/v1',url:imageUrl};
    assert.equal((await info(other)).status,403);
    const initial=await info(token);assert.equal(initial.status,200);
    const first=await initial.json() as {version:string};
    const saved=await save(token,first.version);assert.equal(saved.status,200);
    const after=await sharp(await fs.readFile(file)).metadata();assert.equal(after.width,40);assert.equal(after.height,80);
    assert.deepEqual(answerValue,{format:'photo/v1',url:imageUrl});
    const content=await fs.readFile(file);
    assert.equal((await save(token,first.version)).status,409,'stale preview cannot rotate a newer image');
    assert.deepEqual(await fs.readFile(file),content);
    assert.equal((await save(other,first.version)).status,403);
    active=false;assert.equal((await info(token)).status,403);
    const teacher=await fetch(base+'/teacher-login');const cookie=teacher.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await fetch(`${base}/api/upload/image-orientation?url=${encodeURIComponent(imageUrl)}`,{headers:{cookie}})).status,200);
    // New uploads can be rotated before a draft is saved; ownership is tied to the uploader.
    active=true;const form=new FormData();form.append('file',new Blob([original],{type:'image/png'}),'photo.png');
    const upload=await fetch(base+'/api/upload/worksheet-image',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});
    assert.equal(upload.status,200);const added=await upload.json() as {url:string};
    assert.match(added.url, /^\/uploads\/classrooms\/room\/worksheet\/chat-/);
    const scopedFile=path.join(directory,added.url.slice(1));
    assert.equal((await fs.stat(scopedFile)).isFile(),true);
    const fresh=`${base}/api/upload/image-orientation?url=${encodeURIComponent(added.url)}`;
    const scopedInfo=await fetch(fresh,{headers:{Authorization:`Bearer ${token}`}});
    assert.equal(scopedInfo.status,200);
    const scopedVersion=(await scopedInfo.json() as {version:string}).version;
    const scopedRotate=await fetch(base+'/api/upload/image-orientation',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({url:added.url,degrees:90,version:scopedVersion})});
    assert.equal(scopedRotate.status,200);
    const scopedMeta=await sharp(await fs.readFile(scopedFile)).metadata();
    assert.equal(scopedMeta.width,40);assert.equal(scopedMeta.height,80);
    const chatForm=new FormData();chatForm.append('file',new Blob([original],{type:'image/png'}),'chat.png');
    const chatUpload=await fetch(base+'/api/upload/',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:chatForm});
    assert.equal(chatUpload.status,200);
    assert.match((await chatUpload.json() as {url:string}).url,/^\/uploads\/classrooms\/room\/chat\/chat-/);
    const teacherForm=new FormData();teacherForm.append('file',new Blob([original],{type:'image/png'}),'shared.png');
    const teacherUpload=await fetch(base+'/api/upload/worksheet-image',{method:'POST',headers:{cookie},body:teacherForm});
    assert.equal(teacherUpload.status,200);
    assert.match((await teacherUpload.json() as {url:string}).url,/^\/uploads\/chat\/chat-/);
    assert.equal((await fetch(fresh,{headers:{Authorization:`Bearer ${other}`}})).status,403);
    answerValue={format:'photo/v1',url:added.url};
    // A forged reference must not grant another student ownership of a newer upload.
    forgedReferences=true;
    const forged = await fetch(fresh,{headers:{Authorization:`Bearer ${other}`}});
    assert.equal(forged.status,403);
    assert.ok(await fs.stat(path.join(directory,'uploads','.image-owners',`${path.basename(added.url)}.json`)));

  }finally{
    server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
    revokeAllStudentSessions();revokeAllTeacherSessions();
    if(previous===undefined)delete process.env.CLASSNODE_DATA_DIR;else process.env.CLASSNODE_DATA_DIR=previous;
    await fs.rm(directory,{recursive:true,force:true});
  }
});
