'use client';
import {useEffect,useState} from 'react';
import {IconTextCaption,IconKey,IconInfoCircle,IconCheck,IconAlertCircle} from '@tabler/icons-react';
import {api} from '@/lib/api';
import type {PlatformTokenSummary} from '@/lib/types';
import styles from '../agents/speech/speech.module.css';
import local from './transcription-settings.module.css';
export function TranscriptionSettings(){
 const [tokens,setTokens]=useState<PlatformTokenSummary[]>([]),[credential,setCredential]=useState(''),[saved,setSaved]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
 const [enabled,setEnabled]=useState(false),[savedEnabled,setSavedEnabled]=useState(false);
 const [message,setMessage]=useState<{error:boolean;text:string}|null>(null);
 useEffect(()=>{let alive=true;Promise.all([api.getPlatformTokens(),api.getTranscriptionConfig()]).then(([items,config])=>{if(alive){setTokens(items.filter(t=>t.platform==='coze'));setCredential(config.credentialId);setSaved(config.credentialId);setEnabled(config.enabled);setSavedEnabled(config.enabled);setReady(true);}}).catch(()=>{if(alive)setMessage({error:true,text:'无法读取转写配置，请刷新重试'});});return()=>{alive=false;};},[]);
 const save=async()=>{setBusy(true);setMessage(null);try{await api.saveTranscriptionConfig(credential,enabled);setSaved(credential);setSavedEnabled(enabled);setMessage({error:false,text:'转写设置已保存'});}catch(e){setMessage({error:true,text:e instanceof Error?e.message:'保存失败，请重试'});}finally{setBusy(false);}};
 return <div className={styles.page}><section className={styles.panel} aria-labelledby="transcription-title" aria-busy={!ready}>
  <header className={styles.enableRow}>
   <span className={styles.sectionIcon}><IconTextCaption size={24} stroke={1.7} aria-hidden="true"/></span>
   <div className={styles.enableCopy}><h2 id="transcription-title">学生录音转文字</h2><p>将学生录音识别为文字，便于教师查看和课堂讲评。</p></div>
   <span className={`${styles.status} ${enabled?styles.enabled:''}`}>{!ready?'读取中…':enabled?'已开启':'已关闭'}</span>
   <label className={styles.switch} title="开启录音转文字"><input type="checkbox" aria-label="开启录音转文字" checked={enabled} disabled={!ready||busy} onChange={e=>{setEnabled(e.target.checked);setMessage(null);}}/><span aria-hidden="true"/></label>
  </header>
  {enabled && <div className={styles.usage} role="status"><IconInfoCircle size={18} aria-hidden="true"/><p>温馨提醒：开启并保存后，点击“转文字”会消耗所选扣子账号的积分，请按需使用。已保存的转写文字可直接查看，无需再次识别。具体消耗以扣子平台为准。</p></div>}
  <div className={local.form}>
   <div className={styles.field}><label htmlFor="transcription-credential"><IconKey size={18} aria-hidden="true"/>扣子识别服务令牌</label>
    <select id="transcription-credential" className="input" aria-describedby="transcription-help" disabled={!ready||busy||!enabled} value={credential} onChange={e=>{setCredential(e.target.value);setMessage(null);}}><option value="">未配置</option>{tokens.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select>
    <p id="transcription-help" className={styles.fieldHint}><IconInfoCircle size={16} aria-hidden="true"/><span>请选择具备 createTranscription 权限的扣子令牌，与语音朗读配置独立。</span></p>
    {ready&&!tokens.length&&<p className={styles.fieldHint}>暂无扣子令牌，请先在 AI 智能体管理中添加访问令牌。</p>}
   </div>
  </div>
  <div className={styles.usage}><IconInfoCircle size={18} aria-hidden="true"/><p>教师点击“转文字”时才调用识别服务并消耗扣子积分。关闭后不再发起新的转写，已保存的文字仍可查看。不会改变学生原始作答或评分。</p></div>
  {message&&<div className={message.error?styles.error:styles.success} role="status">{message.error?<IconAlertCircle size={18} aria-hidden="true"/>:<IconCheck size={18} aria-hidden="true"/>}{message.text}</div>}
  <footer className={styles.footer}><span>{ready&&(credential!==saved||enabled!==savedEnabled)?'配置已修改，保存后生效。':'转写结果仅供参考，可播放原音核对。'}</span><button type="button" className="btn btn-primary" disabled={!ready||busy} onClick={()=>void save()}><IconCheck size={18} aria-hidden="true"/>{busy?'保存中…':'保存转写设置'}</button></footer>
 </section></div>;
}
