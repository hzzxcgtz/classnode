'use client';
import {useEffect,useRef,useState} from 'react';
import {IconVolume,IconPlayerPause,IconPlayerStop} from '@tabler/icons-react';
import {api} from '@/lib/api';
import styles from './fullscreen-preview.module.css';
type Part='reason'|'advice';
type Mode=Part|'all';
type Clip={url:string;part:Part};
export function useReviewSpeech(reason:string,advice:string,visible:boolean,identity:string){
 const audio=useRef<HTMLAudioElement|null>(null);const generation=useRef(0);const controller=useRef<AbortController|null>(null);
 const cache=useRef(new Map<Part,string[]>());const queue=useRef<Clip[]>([]);const index=useRef(0);
 const [mode,setMode]=useState<Mode|null>(null),[part,setPart]=useState<Part|null>(null),[state,setState]=useState<'idle'|'loading'|'playing'|'paused'>('idle'),[error,setError]=useState('');
 const stop=()=>{generation.current++;controller.current?.abort();controller.current=null;audio.current?.pause();if(audio.current)audio.current.removeAttribute('src');queue.current=[];setMode(null);setPart(null);setState('idle');setError('');};
 useEffect(()=>{const invalidate=()=>{generation.current++;controller.current?.abort();};const element=new Audio();audio.current=element;
  const play=()=>{if(!queue.current.length){element.pause();return;}setState('playing');setPart(queue.current[index.current]?.part??null);document.querySelectorAll('audio').forEach(other=>{if(other!==element)other.pause();});};
  const ended=()=>{index.current++;const next=queue.current[index.current];if(next){element.src=next.url;setPart(next.part);void element.play().catch(()=>{setState('paused');setError('请点击继续朗读');});}else{setMode(null);setPart(null);setState('idle');queue.current=[];}};
  const failed=()=>{if(!queue.current.length)return;setState('paused');setError('播放暂时失败，请停止后重试');};
  const hidden=()=>{if(document.hidden){invalidate();element.pause();queue.current=[];setMode(null);setPart(null);setState('idle');}};
  document.addEventListener('visibilitychange',hidden);
  element.addEventListener('play',play);element.addEventListener('ended',ended);element.addEventListener('error',failed);
  return()=>{invalidate();element.pause();element.removeAttribute('src');document.removeEventListener('visibilitychange',hidden);element.removeEventListener('play',play);element.removeEventListener('ended',ended);element.removeEventListener('error',failed);audio.current=null;};
 },[]);
 useEffect(()=>{stop();setError('');return()=>{generation.current++;controller.current?.abort();audio.current?.pause();cache.current.forEach(urls=>urls.forEach(URL.revokeObjectURL));cache.current.clear();};},[reason,advice,visible,identity]); // eslint-disable-line react-hooks/exhaustive-deps
 const start=async(nextMode:Mode)=>{
  if(nextMode===mode&&state==='playing'){audio.current?.pause();setState('paused');return;}
  if(nextMode===mode&&state==='paused'&&queue.current.length){try{await audio.current?.play();setError('');}catch{setError('请再点一次继续朗读');}return;}
  stop();setError('');if(!visible)return;const ticket=generation.current;const request=new AbortController();controller.current=request;setMode(nextMode);setState('loading');
  try{const parts:Part[]=nextMode==='all'?['reason','advice']:[nextMode];const clips:Clip[]=[];
   for(const key of parts){const text=key==='reason'?reason:advice;if(!text.trim())continue;
    let urls=cache.current.get(key);if(!urls){const result=await api.readSpeech(text,request.signal);if(ticket!==generation.current)return;
     urls=result.clips.map(b=>{const raw=atob(b);return URL.createObjectURL(new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:'audio/mpeg'}));});cache.current.set(key,urls);}
    clips.push(...urls.map(url=>({url,part:key})));
   }
   if(ticket!==generation.current)return;if(!clips.length)throw new Error('没有可朗读的内容');queue.current=clips;index.current=0;setPart(clips[0].part);if(audio.current)audio.current.src=clips[0].url;
   try{await audio.current?.play();}catch{if(ticket===generation.current){setState('paused');setError('语音已准备好，请点继续朗读');}}
  }catch(e){if(ticket===generation.current){setState('idle');setMode(null);setPart(null);setError(e instanceof Error?e.message:'朗读失败，请重试');}}
 };
 const controls=(type:Mode)=><span className={styles.reviewSpeechControls}>
  <button type="button" className={styles.reviewSpeechButton} aria-pressed={mode===type} disabled={mode===type&&state==='loading'||(type==='reason'?!reason.trim():type==='advice'?!advice.trim():!reason.trim()&&!advice.trim())} onClick={()=>void start(type)}>
   {mode===type&&state==='playing'?<IconPlayerPause size={18}/>:<IconVolume size={18}/>}
   {mode===type?(state==='loading'?'正在准备…':state==='playing'?'暂停朗读':state==='paused'?'继续朗读':type==='all'?'朗读全部':type==='reason'?'朗读评价':'朗读建议'):type==='all'?'朗读全部':type==='reason'?'朗读评价':'朗读建议'}
  </button>
  {mode===type&&state!=='idle'&&<button type="button" className={styles.reviewSpeechStop} onClick={stop} aria-label="停止朗读" title="停止朗读"><IconPlayerStop size={16} fill="currentColor" aria-hidden="true"/><span>停止</span></button>}
 </span>;
 return {controls,activePart:part,error};
}
