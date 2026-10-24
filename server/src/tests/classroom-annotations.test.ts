import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { createServer } from 'node:http';
import annotationRoutes from '../routes/classroom-annotations.js';
import { createTeacherSession } from '../middleware/auth.js';
import { annotationDocument, readAnnotation, saveAnnotation } from '../services/classroom-annotations.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const document = {version:1,kind:'image',strokes:[{id:1,tool:'pen',color:'#ef4444',width:3,points:[{x:20,y:30}]}]};
test('批注校验拒绝脚本颜色、非有限坐标、重复笔迹编号和超量画布数据',()=>{
 assert.deepEqual(annotationDocument(document),document);
 for(const invalid of [null, {...document,strokes:[{...document.strokes[0],color:'url(javascript:x)'}]}, {...document,strokes:[{...document.strokes[0],points:[{x:NaN,y:0}]}]}, {...document,strokes:[document.strokes[0],document.strokes[0]]}, {...document,kind:'text'}, {...document,strokes:Array(2001).fill(document.strokes[0])}]) assert.throws(()=>annotationDocument(invalid));
 const text={...document,kind:'text',frame:{width:1000,height:600,textSize:26,scroll:[{top:300,left:0}]}};
 assert.deepEqual(annotationDocument(text),text);
});
test('教师批注持久保存、跨连接读取、课堂隔离、版本冲突和清空；学生无权读写',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cn-annotations-'));
 const url=`file:${path.join(directory,'test.db')}`;
 fs.writeFileSync(path.join(directory,'test.db'),'');
 execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'db','push','--skip-generate','--schema',path.join(root,'prisma/schema.prisma')],{env:{...process.env,DATABASE_URL:url},stdio:'pipe'});
 const prisma=new PrismaClient({datasources:{db:{url}}});
 const app=express();app.use(express.json());app.set('prisma',prisma);app.post('/login',(_req,res)=>{createTeacherSession(res);res.json({ok:true});});app.use('/api/classroom/:id/annotations',annotationRoutes);
 const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{
  await prisma.classroom.createMany({data:[{id:'a'},{id:'b'}]});
  assert.equal((await fetch(`${base}/api/classroom/a/annotations/read`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:'photo'})})).status,401);
  const login=await fetch(`${base}/login`,{method:'POST'});const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const request=(method:string,body:unknown)=>fetch(`${base}/api/classroom/a/annotations${method==='POST'?'/read':''}`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.deepEqual(await (await request('POST',{target:'photo'})).json(),{document:null,revision:0});
  assert.equal((await request('PUT',{target:'photo',document,revision:0})).status,200);
  const fresh=new PrismaClient({datasources:{db:{url}}});
  try{assert.deepEqual(await readAnnotation(fresh,'a','photo'),{document,revision:1});assert.deepEqual(await readAnnotation(fresh,'b','photo'),{document:null,revision:0});}finally{await fresh.$disconnect();}
  assert.equal((await request('PUT',{target:'photo',document,revision:0})).status,409);
  assert.equal((await request('PUT',{target:'photo',document,revision:9})).status,409);
  const empty={version:1,kind:'image',strokes:[]};
  await saveAnnotation(prisma,'a','photo',empty,1);assert.deepEqual(await readAnnotation(prisma,'a','photo'),{document:empty,revision:2});
  await assert.rejects(readAnnotation(prisma,'missing','photo'),/课堂不存在/);
  await prisma.classroom.delete({where:{id:'a'}});assert.equal(await prisma.classroomAnnotation.count(),0);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await prisma.$disconnect();fs.rmSync(directory,{recursive:true,force:true});}
});
