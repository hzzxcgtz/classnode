import test from 'node:test';
import assert from 'node:assert/strict';
import { AnnotationPersistence } from './annotation-persistence.ts';
import { HttpError } from './http-error.ts';
import type { AnnotationDocument } from './image-annotation-session.ts';
const doc = (id: number): AnnotationDocument => ({version:1,kind:'image',strokes:[{id,tool:'pen',color:'#ef4444',width:3,points:[{x:5,y:6}]}]});
const flush = () => new Promise(resolve => setTimeout(resolve,0));
test('连续画笔串行保存，后一笔使用上一笔返回的版本；清空也保存', async () => {
 const sent: {revision:number;document:AnnotationDocument}[]=[];
 let release: (()=>void) | undefined;
 const session = new AnnotationPersistence('c','image','cache',{
  readAnnotations:async()=>({revision:0,document:null}),
  saveAnnotations:async(_c,_t,document,revision)=>{sent.push({revision,document});if(sent.length===1)await new Promise<void>(r=>release=r);return {revision:revision+1};},
 });
 await session.load();session.update(doc(1));session.update(doc(2));
 assert.equal(sent.length,1);assert.equal(session.unsaved,true);
 release!();await flush();assert.equal(sent.length,2);assert.equal(sent[1].revision,1);assert.deepEqual(sent[1].document,doc(2));
 session.update({version:1,kind:'image',strokes:[]});await flush();assert.equal(sent[2].document.strokes.length,0);assert.equal(session.unsaved,false);
});
test('读取失败不允许写入，保存失败保留修改并支持重试，冲突不静默覆盖',async()=>{
 let readingFail=true,fail=true,conflict=false;
 const session=new AnnotationPersistence('c','text','cache2',{
  readAnnotations:async()=>{if(readingFail)throw new Error('offline');return{revision:2,document:doc(1)};},
  saveAnnotations:async()=>{if(conflict)throw new HttpError('其他教师已修改',409);if(fail)throw new Error('offline');return{revision:3};},
 });
 await session.load();session.update(doc(2));assert.equal(session.state.document,null);
 readingFail=false;await session.load();session.update(doc(2));await flush();assert.equal(session.unsaved,true);assert.deepEqual(session.state.document,doc(2));
 fail=false;await session.save();assert.equal(session.unsaved,false);
 conflict=true;session.update(doc(3));await flush();assert.equal(session.state.conflict,true);const before=session.state.document;session.update(doc(4));assert.equal(session.state.document,before);
 await session.reload();assert.deepEqual(session.state.document,doc(1));assert.equal(session.unsaved,false);
});
