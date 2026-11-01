import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {PrismaClient} from '@prisma/client';
import {resolveLocalPath} from './ai-proxy.js';
import {speechToken} from './coze-speech.js';
export const TRANSCRIPTION_CONFIG='audio-transcription-config';
export async function transcriptionConfig(db:PrismaClient){
 const row=await db.setting.findUnique({where:{key:TRANSCRIPTION_CONFIG}});
 let raw:{credentialId?:unknown;enabled?:unknown}={};try{raw=JSON.parse(row?.value??'{}')??{};}catch{}
 const credentialId=typeof raw.credentialId==='string'?raw.credentialId:'';
 return {credentialId,enabled:raw.enabled===true};
}
const pending=new Map<string,Promise<{text:string;createdAt:string}>>();
export async function recognizeAudio(bytes:Buffer,token:string,fetcher:typeof fetch=fetch){
 const form=new FormData();form.append('file',new Blob([new Uint8Array(bytes)],{type:'audio/ogg'}),'recording.ogg');
 const response=await fetcher('https://api.coze.cn/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form,redirect:'error',signal:AbortSignal.timeout(90000)});
 if(!response.ok){await response.body?.cancel();throw Error('语音识别失败，请检查令牌的 createTranscription 权限与可用额度后重试');}
 const data=await response.json();if(data.code!==0||typeof data.data?.text!=='string')throw Error('语音识别未返回有效结果，请重试');
 const text=data.data.text.trim();if(!text)throw Error('未识别到有效语音，请播放原音核对后重试');if(text.length>60000)throw Error('转写结果过长');return text;
}
export async function transcribeRecording(db:PrismaClient,url:unknown,create:boolean,fetcher:typeof fetch=fetch){
 if(typeof url!=='string'||!/^\/uploads\/(?:chat|classrooms\/[A-Za-z0-9_-]{1,128}\/(?:chat|worksheet))\/chat-[0-9a-f-]+\.ogg$/.test(url))throw Error('仅支持课堂中的学生录音');
 const file=resolveLocalPath(url);const real=await fs.realpath(file);const root=await fs.realpath(resolveLocalPath('/uploads/'));
 if(!real.startsWith(root+path.sep))throw Error('录音路径无效');
 const stat=await fs.stat(real);if(!stat.isFile()||stat.size>10*1024*1024||stat.size<4)throw Error('录音为空或超过10MB');
 const bytes=await fs.readFile(real);if(bytes.subarray(0,4).toString()!=='OggS')throw Error('录音格式无效');
 const key='audio-transcript:'+createHash('sha256').update(url).update(bytes).digest('hex');
 const saved=await db.setting.findUnique({where:{key}});if(saved)return JSON.parse(saved.value) as {text:string;createdAt:string};
 if(!create)return null;
 const config=await transcriptionConfig(db);if(!config.enabled)throw Error('录音转文字尚未开启。需要时，可以到“设置 → 语音设置 → 录音转文字”开启，开启后使用会消耗扣子积分。');
 const active=pending.get(key);if(active)return active;if(pending.size>=2)throw Error('正在转写其他录音，请稍后重试');
 const job=(async()=>{if(!config.credentialId)throw Error('请先在设置 → 语音设置 → 录音转文字中选择服务令牌');
 const token=await speechToken(db,config.credentialId);const text=await recognizeAudio(bytes,token,fetcher);const result={text,createdAt:new Date().toISOString()};
 await db.setting.upsert({where:{key},create:{key,value:JSON.stringify(result)},update:{value:JSON.stringify(result)}});return result;})();
 pending.set(key,job);try{return await job;}finally{pending.delete(key);}
}
