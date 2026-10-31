import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import speechRoutes from '../routes/speech.js';
import {requireTeacher,createTeacherSession} from '../middleware/auth.js';
import {createStudentToken} from '../middleware/student-auth.js';

test('speech management and reading are teacher-only; disabled and empty requests do not synthesize',async t=>{
 const app=express();app.use(express.json());let enabled=false;
 app.set('prisma',{setting:{findUnique:async()=>({value:JSON.stringify({enabled,credentialId:'saved',voiceId:'123'})})}});
 app.use('/api/speech',requireTeacher,speechRoutes);
 const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/speech`;
 const student=createStudentToken('room','student');
 for(const [path,method] of [['/read','POST'],['/preview','POST'],['/voices','GET'],['/','PUT']]){
  const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${student}`,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify({text:'test'})})});assert.equal(response.status,401);
 }
 let cookie='';createTeacherSession({setHeader:(_key:string,value:string)=>{cookie=value.split(';')[0];}} as never);
 const call=(text:unknown)=>fetch(base+'/read',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({text})});
 assert.equal((await call('评价内容')).status,409);
 enabled=true;assert.equal((await call(' ')).status,400);assert.equal((await call(123)).status,400);
 assert.equal((await call('中'.repeat(9000))).status,400);
});
