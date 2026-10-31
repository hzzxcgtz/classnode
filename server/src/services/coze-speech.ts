import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { decrypt, isEncrypted } from './crypto.js';
export const SPEECH_KEY = 'coze-speech';
export type SpeechConfig = { enabled: boolean; credentialId: string; voiceId: string };
export async function speechConfig(db: PrismaClient): Promise<SpeechConfig> {
  const row = await db.setting.findUnique({where:{key:SPEECH_KEY}});
  try { const v=JSON.parse(row?.value ?? '{}'); return {enabled:v.enabled===true,credentialId:typeof v.credentialId==='string'?v.credentialId:'',voiceId:typeof v.voiceId==='string'?v.voiceId:''}; } catch { return {enabled:false,credentialId:'',voiceId:''}; }
}
export async function speechToken(db: PrismaClient, id: string) {
  const row=await db.platformToken.findUnique({where:{id}});
  if(!row || row.platform!=='coze') throw new Error('请先选择已保存的扣子访问令牌');
  if(row.expiresAt && row.expiresAt.getTime()<=Date.now()) throw new Error('扣子访问令牌已过期，请老师更新');
  return isEncrypted(row.token)?decrypt(row.token):row.token;
}
export function splitSpeech(text:string):string[] {
  const clean=text.replace(/<[^>]*>/g,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*#`_]/g,'').trim();
  if(!clean || Buffer.byteLength(clean)>24000) throw new Error('评价文字为空或过长，暂时无法朗读');
  const parts:string[]=[]; let chunk='';
  for(const char of clean){if(Buffer.byteLength(chunk+char)>1000){parts.push(chunk);chunk='';}chunk+=char;}
  if(chunk)parts.push(chunk); return parts;
}
async function upstream(path:string,token:string,body?:unknown,fetcher:typeof fetch=fetch) {
  const response=await fetcher(`https://api.coze.cn/v1/audio/${path}`,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok || path==='speech' && !/^(audio\/|application\/octet-stream)/i.test(response.headers.get('content-type')??'')) {
    await response.body?.cancel(); throw new Error('扣子语音服务暂不可用，请老师检查令牌的 listVoice、createSpeech 权限和可用额度');
  }
  return response;
}
export async function listSpeechVoices(token:string,fetcher:typeof fetch=fetch){
  const voices:Array<{id:string;name:string;language:string;custom:boolean;preview:string}>=[];
  for(let page=1;page<=20;page++){
    const response=await upstream(`voices?page_num=${page}&page_size=100`,token,undefined,fetcher);
    const data=await response.json();
    if(data.code!==0 || !Array.isArray(data.data?.voice_list))throw new Error('无法获取音色，请检查令牌的 listVoice 权限');
    for(const v of data.data.voice_list) if(typeof v.voice_id==='string' && v.state!=='init')voices.push({id:v.voice_id,name:String(v.name),language:String(v.language_name??''),custom:v.is_system_voice===false,preview:typeof v.preview_audio==='string'&&v.preview_audio.startsWith('https://')?v.preview_audio:''});
    if(!data.data.has_more)return voices;
  }
  throw new Error('音色列表过多，请稍后重试');
}
const cache=new Map<string,Buffer[]>(); const pending=new Map<string,Promise<Buffer[]>>(); let bytes=0;
/** Bounded process cache; coalesces concurrent identical requests, never stores credentials. */
export async function synthesizeSpeech(token:string,identity:string,voiceId:string,text:string,fetcher:typeof fetch=fetch):Promise<Buffer[]>{
  const chunks=splitSpeech(text);const key=createHash('sha256').update(JSON.stringify([identity,voiceId,chunks])).digest('hex');
  const saved=cache.get(key);if(saved)return saved;
  const active=pending.get(key);if(active)return active;
  if(pending.size>=4)throw new Error('朗读请求较多，请稍后再试');
  const job=(async()=>{const clips:Buffer[]=[];let total=0;
    for(const input of chunks){const response=await upstream('speech',token,{input,voice_id:voiceId,response_format:'mp3',speed:1},fetcher);
      if(!response.body)throw new Error('语音生成失败，请重试');
      const reader=response.body.getReader();const blocks:Buffer[]=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024 || total+size>24*1024*1024)throw new Error('生成的语音过大，请缩短评价');blocks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
      if(!size)throw new Error('语音生成失败，请重试');total+=size;clips.push(Buffer.concat(blocks));
    }
    while(cache.size && bytes+total>32*1024*1024){const oldest=cache.keys().next().value!;bytes-=cache.get(oldest)!.reduce((n,b)=>n+b.length,0);cache.delete(oldest);}
    cache.set(key,clips);bytes+=total;return clips;
  })();pending.set(key,job);try{return await job;}finally{pending.delete(key);}
}
