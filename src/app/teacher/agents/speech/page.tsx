'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {api} from '@/lib/api';
import type {PlatformTokenSummary} from '@/lib/types';
import {TeacherPageHeader} from '@/lib/components';
import {IconArrowLeft, IconVolume, IconKey, IconHeadphones, IconCheck, IconInfoCircle, IconShieldCheck} from '@tabler/icons-react';
import styles from './speech.module.css';
import {SpeechListener} from '@/components/speech-listener';
type Voice={id:string;name:string;language:string;custom:boolean;preview:string};
export default function SpeechSettings(){
 const [tokens,setTokens]=useState<PlatformTokenSummary[]>([]),[voices,setVoices]=useState<Voice[]>([]);
 const [saving,setSaving]=useState(false);
 const [config,setConfig]=useState({enabled:false,credentialId:'',voiceId:''});const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
 useEffect(()=>{let alive=true;void Promise.all([api.getPlatformTokens(),api.getSpeechConfig()]).then(([t,c])=>{if(alive){setTokens(t.filter(v=>v.platform==='coze'));setConfig(c);setReady(true);}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[]);
 useEffect(()=>{if(!config.credentialId){setVoices([]);setBusy(false);return;}let alive=true;setVoices([]);setError('');setBusy(true);void api.getSpeechVoices(config.credentialId).then(v=>{if(alive)setVoices(v);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setBusy(false);});return()=>{alive=false;};},[config.credentialId]);
 const selectedVoice = voices.find(voice=>voice.id===config.voiceId);
 const save = async () => {
  setSaving(true); setError(''); setNotice('');
  try { await api.saveSpeechConfig(config); setNotice('朗读设置已保存，重新打开讲评或对话投屏页面后生效。'); }
  catch(problem) { setError(problem instanceof Error ? problem.message : '保存失败，请重试'); }
  finally { setSaving(false); }
 };
 return <div className={styles.page}>
  <TeacherPageHeader title="AI 语音朗读" description="为课堂讲评和对话投屏选择朗读声音。" actions={
   <Link className="btn btn-secondary" href="/teacher/agents/"><IconArrowLeft size={18} aria-hidden="true"/>返回智能体管理</Link>
  }/>
  <section className={styles.panel} aria-busy={!ready}>
   <div className={styles.enableRow}>
    <span className={styles.sectionIcon}><IconVolume size={24} stroke={1.7} aria-hidden="true"/></span>
    <div className={styles.enableCopy}><h2>AI 语音朗读</h2><p>在课堂讲评和对话投屏中，朗读 AI 的评价、建议与回复内容。</p></div>
    <span className={`${styles.status} ${config.enabled?styles.enabled:''}`}>{config.enabled?'已开启':'未开启'}</span>
    <label className={styles.switch}>
     <input type="checkbox" aria-label="开启AI 语音朗读" disabled={!ready||saving} checked={config.enabled} onChange={event=>{setConfig({...config,enabled:event.target.checked});setNotice('');}}/>
     <span aria-hidden="true"/>
    </label>
   </div>
   <div className={styles.workspace}>
    <div className={styles.form}>
     <div className={styles.field}>
      <label htmlFor="speech-token"><IconKey size={18} aria-hidden="true"/>扣子访问令牌</label>
      <select id="speech-token" className="input" value={config.credentialId} disabled={!ready||saving} onChange={event=>{setConfig({...config,credentialId:event.target.value,voiceId:''});setNotice('');}}>
       <option value="">选择已保存的令牌</option>{tokens.map(token=><option key={token.id} value={token.id}>{token.label}</option>)}
      </select>
      <p className={styles.fieldHint}><IconShieldCheck size={15} aria-hidden="true"/>使用已有令牌，无需再次填写密钥。</p>
     </div>
     <div className={styles.field}>
      <label htmlFor="speech-voice"><IconHeadphones size={18} aria-hidden="true"/>朗读音色</label>
      <select id="speech-voice" className="input" value={config.voiceId} disabled={!ready||busy||saving||!config.credentialId} onChange={event=>{setConfig({...config,voiceId:event.target.value});setNotice('');}}>
       <option value="">{busy?'正在读取音色…':config.credentialId?'请选择音色':'请先选择访问令牌'}</option>
       {voices.map(voice=><option value={voice.id} key={voice.id}>{voice.name} · {voice.language}{voice.custom?' · 自定义':''}</option>)}
      </select>
      <p className={styles.fieldHint}>支持系统音色及当前账号可用的自定义音色。</p>
     </div>
     <details className={styles.permissions}><summary>令牌权限说明</summary><p>需开通 listVoice（查看音色）和 createSpeech（语音合成）权限，密钥仅由教师机使用。</p></details>
    </div>
    <aside className={styles.preview} aria-label="音色试听">
     <span className={styles.previewIcon}><IconHeadphones size={30} stroke={1.5} aria-hidden="true"/></span>
     <div className={styles.wave} aria-hidden="true">{[14,25,36,21,30,18,34,24,12].map((height,index)=><i key={index} style={{height}}/>)}</div>
     <h3>{selectedVoice?.name || (busy?'正在载入音色…':'选择一个喜欢的声音')}</h3>
     <p>{selectedVoice ? `${selectedVoice.language || '默认语言'} · ${selectedVoice.custom?'自定义音色':'系统音色'}` : '先选音色，再听听朗读效果。'}</p>
     {selectedVoice ? <SpeechListener key={config.credentialId+config.voiceId} label="试听音色" load={()=>api.previewSpeech(config.credentialId,config.voiceId)}/> : <button type="button" className="btn btn-secondary" disabled><IconVolume size={18} aria-hidden="true"/>试听音色</button>}
    </aside>
   </div>
   <div className={styles.usage}><IconInfoCircle size={17} aria-hidden="true"/><p>内置音色试听直接播放本地音频。新增音色首次试听和正文朗读将使用所选账号的扣子语音合成额度。</p></div>
   {error&&<div className={styles.error} role="alert"><IconInfoCircle size={18} aria-hidden="true"/><span>{error}</span></div>}
   {notice&&<div className={styles.success} role="status"><IconCheck size={18} aria-hidden="true"/><span>{notice}</span></div>}
   <footer className={styles.footer}><span>可在讲评与对话投屏中朗读智能体内容。</span><button type="button" className="btn btn-primary" disabled={!ready||busy||saving||(config.enabled&&!selectedVoice)} onClick={()=>void save()}><IconCheck size={18} aria-hidden="true"/>{saving?'正在保存…':'保存设置'}</button></footer>
  </section>
 </div>;
}
