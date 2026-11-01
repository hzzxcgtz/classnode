'use client';
import {useContext,useEffect,useState} from 'react';
import {IconTextCaption,IconCopy,IconMaximize} from '@tabler/icons-react';
import {AnnotationTranscriptContext} from './annotation-content-state';
import {api} from '@/lib/api';
import {copyText} from '@/lib/copy-text';
import {FullscreenPreview} from '@/app/teacher/classroom/fullscreen-preview';
import styles from './audio-transcription.module.css';
export function AudioTranscription({src,title,showActions=true,fontSize,inline=false}:{src:string;title:string;showActions?:boolean;fontSize?:number;inline?:boolean}){
 const [text,setText]=useState(''),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[full,setFull]=useState(false),[size,setSize]=useState(24),[copied,setCopied]=useState(false);
 const url=(()=>{try{return new URL(src,window.location.href).pathname;}catch{return src;}})();
 useEffect(()=>{let alive=true;api.transcribeRecording(url).then(({result})=>{if(alive&&result)setText(result.text);}).catch(()=>{});return()=>{alive=false;};},[url]);
 const expanded=useContext(AnnotationTranscriptContext);const displayed=expanded?expanded.includes(url):open;
 const toggle=async()=>{if(text){setOpen(v=>!v);return;}setBusy(true);setError('');try{const {result}=await api.transcribeRecording(url,true);if(result){setText(result.text);setOpen(true);}}catch(e){setError(e instanceof Error?e.message:'转写失败，请重试');}finally{setBusy(false);}};
 return <div data-transcription="" data-expanded={displayed} data-audio-url={url} className={`${styles.root} ${inline?styles.inline:''}`}>
  <button type="button" className={styles.action} onClick={()=>void toggle()} disabled={busy} aria-expanded={displayed}><IconTextCaption size={17}/>{busy?'正在转写…':text?displayed?'收起文字':'查看文字':error&&!error.includes('尚未开启')?'重试转写':'转文字'}</button>
  {error&&<p role="status" className={error.includes('尚未开启')?styles.hint:styles.error}>{error}</p>}
  {displayed&&text&&<div className={styles.transcript}><div className={styles.tools}><span className={styles.heading}>语音转写<small>仅供参考</small></span>{showActions&&<><button type="button" onClick={async()=>{try{await copyText(text);setCopied(true);}catch{setError('复制失败，请选择文字手动复制');}}}><IconCopy size={16}/>{copied?'已复制':'复制'}</button><button type="button" onClick={()=>setFull(true)}><IconMaximize size={16}/>放大讲评</button></>}</div><p style={fontSize?{fontSize:`var(--preview-text-size, ${fontSize}px)`}:undefined}>{text}</p></div>}
  {full&&<FullscreenPreview title={`${title} · 语音转写`} allowAnnotations floatingControls textSize={size} annotationKey={JSON.stringify(['audio-transcript',url,text])} onClose={()=>setFull(false)} controls={<><button aria-label="缩小转写文字" onClick={()=>setSize(n=>Math.max(18,n-2))}>A−</button><output>{size}px</output><button aria-label="放大转写文字" onClick={()=>setSize(n=>Math.min(48,n+2))}>A＋</button></>}><div className={styles.full} role="region" aria-label="语音转写全文"><article style={{fontSize:'var(--preview-text-size,24px)'}}><p>{text}</p><small>转写仅供参考，可播放原音核对。</small></article></div></FullscreenPreview>}
 </div>;
}
