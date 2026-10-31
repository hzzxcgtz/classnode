import {readFile,writeFile,mkdir,rename,stat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const serverRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const PREVIEW_TEXT='你好，我是你的学习小助手。让我们一起听听这次的评价和小建议。';
const translated:Record<string,string>={
  '英文':'Hello! I am your learning assistant. Let us listen to your feedback and a helpful suggestion.',
  '越南语':'Xin chào! Tôi là trợ lý học tập của bạn. Chúng ta hãy cùng lắng nghe nhận xét và gợi ý.',
  '泰语':'สวัสดี ฉันเป็นผู้ช่วยการเรียนรู้ของคุณ มาฟังคำแนะนำไปด้วยกัน',
};
export const previewText=(language:string)=>translated[language]??PREVIEW_TEXT;
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
interface Entry {id:string;name:string;language:string;custom:boolean;bytes:number;sha256:string;status:string}
export async function bundledPreviewVoices(root=path.join(serverRoot,'assets/voice-previews')):Promise<Entry[]> {
 const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
 return manifest.voices.filter((v:Entry)=>/^\d{1,64}$/.test(v.id)&&v.status==='ready'&&!v.custom);
}
async function readValid(file:string,metadata:{bytes:number;sha256:string}) {
 try{const info=await stat(file);if(info.size!==metadata.bytes||info.size===0||info.size>8*1024*1024)return null;
  const bytes=await readFile(file);return hash(bytes)===metadata.sha256?bytes:null;
 }catch{return null;}
}
export function createVoicePreviewStore(options:{bundledRoot?:string;userRoot?:string}={}) {
 const bundledRoot=options.bundledRoot??path.join(serverRoot,'assets/voice-previews');
 const userRoot=options.userRoot??path.join(process.env.CLASSNODE_DATA_DIR||serverRoot,'voice-previews');
 const pending=new Map<string,Promise<Buffer>>();
 return async function preview(credentialId:string,voiceId:string,generate:()=>Promise<{audio:Buffer;text:string}>) {
  if(typeof voiceId!=='string'||!/^\d{1,64}$/.test(voiceId)||!credentialId)throw new Error('请选择令牌和音色');
  const directory=path.join(userRoot,hash(credentialId).slice(0,24),'v1');
  const file=path.join(directory,voiceId+'.mp3'),metadataFile=path.join(directory,voiceId+'.json');
  try{const metadata=JSON.parse(await readFile(metadataFile,'utf8'));
   if(metadata.version===1&&metadata.voiceId===voiceId&&typeof metadata.text==='string'){
    const saved=await readValid(file,metadata);if(saved)return saved;
   }
  }catch{ /* Missing or damaged user preview: try built-in resources. */ }
  try{const entry=(await bundledPreviewVoices(bundledRoot)).find(v=>v.id===voiceId);
   if(entry){const saved=await readValid(path.join(bundledRoot,'audio',voiceId+'.mp3'),entry);if(saved)return saved;}
  }catch{ /* Distribution without assets: fall back to synthesis. */ }
  const key=file,active=pending.get(key);if(active)return active;
  if(pending.size>=4)throw new Error('试听请求较多，请稍后再试');
  const job=(async()=>{
   const {audio,text}=await generate();
   if(!audio.length||audio.length>8*1024*1024||!(audio.subarray(0,3).toString()==='ID3'||audio[0]===255&&(audio[1]&224)===224))throw new Error('试听音频格式不正确，请重试');
   await mkdir(directory,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp',metaTemp=metadataFile+'.'+randomUUID()+'.tmp';
   try{
    await writeFile(temp,audio);await rename(temp,file);
    await writeFile(metaTemp,JSON.stringify({version:1,voiceId,text,bytes:audio.length,sha256:hash(audio)}));await rename(metaTemp,metadataFile);
   }finally{await unlink(temp).catch(()=>{});await unlink(metaTemp).catch(()=>{});}
   return audio;
  })();pending.set(key,job);try{return await job;}finally{pending.delete(key);}
 };
}
export const voicePreview=createVoicePreviewStore();
