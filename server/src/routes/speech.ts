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
  const token=await speechToken(req.app.get('prisma'),String(credentialId??''));
  const voice=(await listSpeechVoices(token)).find(v=>v.id===voiceId);if(!voice)throw new Error('请选择可用音色');
  const text=previewText(voice.language);return {text,audio:Buffer.concat(await synthesizeSpeech(token,String(credentialId),voiceId,text))};
 });res.setHeader('Cache-Control','no-store');res.json({clips:[clip.toString('base64')]});
}catch(e){res.status(400).json({error:e instanceof Error?e.message:'试听失败'});}});
router.post('/read',async(req,res)=>{try{
 const config=await speechConfig(req.app.get('prisma'));
 if(!config.enabled||!config.voiceId)return res.status(409).json({error:'请先在智能体管理的语音朗读设置中开启朗读并选择音色'});
 const text=req.body?.text;if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>24000)return res.status(400).json({error:'朗读内容为空或过长'});
 const token=await speechToken(req.app.get('prisma'),config.credentialId);
 const clips=await synthesizeSpeech(token,config.credentialId,config.voiceId,text);
 res.setHeader('Cache-Control','no-store');res.json({clips:clips.map(b=>b.toString('base64'))});
 }catch(e){res.status(502).json({error:e instanceof Error?e.message:'朗读暂不可用，请重试'});}});
export default router;
