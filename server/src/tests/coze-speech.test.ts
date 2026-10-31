import test from 'node:test';
import assert from 'node:assert/strict';
import {splitSpeech,synthesizeSpeech,listSpeechVoices,speechToken} from '../services/coze-speech.js';
test('speech splitting respects UTF-8 limit and preserves Unicode, without reading Markdown URLs',()=>{
 const text='你好😀。'.repeat(300);const parts=splitSpeech(text);
 assert.equal(parts.join(''),text);assert.ok(parts.every(p=>Buffer.byteLength(p)<=1024));
 assert.equal(splitSpeech('**你好** [建议](https://example.com) ![图片](https://example.com/a.png)').join(''),'你好 建议');
 assert.throws(()=>splitSpeech(''));assert.throws(()=>splitSpeech('中'.repeat(9000)));
});
test('voice enumeration paginates without exposing credentials or accepting redirect locations',async()=>{
 let n=0;
 const voices=await listSpeechVoices('secret',async(url,options)=>{n++;assert.equal(options?.redirect,'error');assert.equal(new Headers(options?.headers).get('Authorization'),'Bearer secret');assert.ok(String(url).startsWith('https://api.coze.cn/v1/audio/voices?'));
 return Response.json({code:0,data:{has_more:n===1,voice_list:[{voice_id:String(n),name:'音色',state:'cloned',language_name:'中文',is_system_voice:true,preview_audio:'https://example.com/a.mp3'}]}});
 });assert.equal(voices.length,2);assert.equal(JSON.stringify(voices).includes('secret'),false);
});
test('identical speech requests coalesce and cache, while text or voice changes generate new audio',async()=>{
 let calls=0;const fetcher:typeof fetch=async(_url,options)=>{calls++;const body=JSON.parse(String(options?.body));assert.equal(body.response_format,'mp3');assert.equal(body.voice_id,'123');return new Response(Buffer.from('audio'),{headers:{'content-type':'audio/mpeg'}});};
 const [a,b]=await Promise.all([synthesizeSpeech('secret','test-token','123','测试音频',fetcher),synthesizeSpeech('secret','test-token','123','测试音频',fetcher)]);
 assert.equal(calls,1);assert.deepEqual(a,b);await synthesizeSpeech('secret','test-token','123','测试音频',fetcher);assert.equal(calls,1);
 await synthesizeSpeech('secret','test-token','123','新的评价',fetcher);assert.equal(calls,2);
});
test('upstream failures are not cached and never return raw token or vendor response',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;return Response.json({code:1,msg:'secret-token'},{status:403});};
 for(let i=0;i<2;i++)await assert.rejects(synthesizeSpeech('secret-token','bad','123','hello',fetcher),e=>e instanceof Error&&!e.message.includes('secret-token'));
 assert.equal(calls,2);
});
test('missing, wrong-platform and expired saved tokens are refused',async()=>{
 const db=(row:unknown)=>({platformToken:{findUnique:async()=>row}}) as unknown as Parameters<typeof speechToken>[0];
 await assert.rejects(speechToken(db(null),'x'));await assert.rejects(speechToken(db({platform:'dify'}),'x'));
 await assert.rejects(speechToken(db({platform:'coze',expiresAt:new Date(0),token:'secret'}),'x'),/过期/);
});
