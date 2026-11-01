import {TRANSCRIPTION_CONFIG,transcribeRecording,transcriptionConfig} from '../services/audio-transcription.js';
import { Router } from 'express';
import { speechConfig, speechToken, listSpeechVoices, synthesizeSpeech, SPEECH_KEY } from '../services/coze-speech.js';
import {voicePreview,previewText,bundledPreviewVoices} from '../services/voice-preview-store.js';
const router:Router=Router();
router.get('/',async(req,res)=>{try{res.json(await speechConfig(req.app.get('prisma')));}catch{res.status(500).json({error:'读取朗读设置失败'});}});
router.get('/voices',async(req,res)=>{try{const token=await speechToken(req.app.get('prisma'),String(req.query.credentialId??''));
 try{res.json(await listSpeechVoices(token));}catch{res.json((await bundledPreviewVoices()).map(v=>({id:v.id,name:v.name,language:v.language,custom:false,preview:''})));}
}catch(e){res.status(400).json({error:e instanceof Error?e.message:'读取音色失败'});}});
router.put('/',async(req,res)=>{try{const db=req.app.get('prisma');const {enabled,credentialId,voiceId}=req.body;
 if(typeof enabled!=='boolean'||typeof credentialId!=='string'||typeof voiceId!=='string')return res.status(400).json({error:'朗读设置格式不正确'});
 if(enabled){const token=await speechToken(db,credentialId);if(!(await listSpeechVoices(token)).some(v=>v.id===voiceId))return res.status(400).json({error:'请选择可用音色'});}
 await db.setting.upsert({where:{key:SPEECH_KEY},update:{value:JSON.stringify({enabled,credentialId,voiceId})},create:{key:SPEECH_KEY,value:JSON.stringify({enabled,credentialId,voiceId})}});res.json({success:true});
 }catch(e){res.status(400).json({error:e instanceof Error?e.message:'保存朗读设置失败'});}});
router.post('/preview',async(req,res)=>{try{const {credentialId,voiceId}=req.body;
 const clip=await voicePreview(String(credentialId??''),voiceId,async()=>{
  if(!(await speechConfig(req.app.get('prisma'))).enabled)throw new Error('这个音色需要在线生成试听。请先开启并保存语音朗读设置；在线试听会消耗扣子积分，也可以先试听内置音色。');
  const token=await speechToken(req.app.get('prisma'),String(credentialId??''));
  const voice=(await listSpeechVoices(token)).find(v=>v.id===voiceId);if(!voice)throw new Error('请选择可用音色');
  const text=previewText(voice.language);return {text,audio:Buffer.concat(await synthesizeSpeech(token,String(credentialId),voiceId,text))};
 });res.setHeader('Cache-Control','no-store');res.json({clips:[clip.toString('base64')]});
}catch(e){res.status(400).json({error:e instanceof Error?e.message:'试听失败'});}});
router.post('/read',async(req,res)=>{try{
 const config=await speechConfig(req.app.get('prisma'));
 if(!config.enabled||!config.voiceId)return res.status(409).json({error:'语音朗读尚未开启。需要时，可以到“设置 → 语音设置 → 语音朗读”开启并选择音色，朗读会消耗扣子积分。'});
 const text=req.body?.text;if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>24000)return res.status(400).json({error:'朗读内容为空或过长'});
 const token=await speechToken(req.app.get('prisma'),config.credentialId);
 const clips=await synthesizeSpeech(token,config.credentialId,config.voiceId,text);
 res.setHeader('Cache-Control','no-store');res.json({clips:clips.map(b=>b.toString('base64'))});
 }catch(e){res.status(502).json({error:e instanceof Error?e.message:'朗读暂不可用，请重试'});}});
router.get('/transcription-config',async(req,res)=>{try{res.setHeader('Cache-Control','no-store');res.json(await transcriptionConfig(req.app.get('prisma')));}catch{res.status(500).json({error:'读取转写配置失败，请重试'});}});
router.put('/transcription-config',async(req,res)=>{try{
 const {credentialId,enabled}=req.body??{};
 if(typeof credentialId!=='string'||typeof enabled!=='boolean'||enabled&&!credentialId)return res.status(400).json({error:'开启转写前请选择服务令牌'});
 if(enabled)await speechToken(req.app.get('prisma'),credentialId);
 const value=JSON.stringify({credentialId,enabled});await req.app.get('prisma').setting.upsert({where:{key:TRANSCRIPTION_CONFIG},create:{key:TRANSCRIPTION_CONFIG,value},update:{value}});res.json({ok:true});
}catch{res.status(400).json({error:'保存失败，请检查令牌是否有效'});}});
router.post('/transcription',async(req,res)=>{try{res.setHeader('Cache-Control','no-store');res.json({result:await transcribeRecording(req.app.get('prisma'),req.body?.url,req.body?.create===true)});}catch(e){res.status(400).json({error:e instanceof Error&& !('code' in e)?e.message:'录音暂时无法读取，请确认附件仍存在后重试'});}});
export default router;
