'use client';
import { useEffect, useRef, useState } from 'react';
import { IconVolume, IconPlayerPause } from '@tabler/icons-react';
/** Reuses one audio element for sequential chunks and stops on unmount. */
export function SpeechListener({load,label='听一听'}:{load:()=>Promise<{clips:string[]}>;label?:string}){
 const audio=useRef<HTMLAudioElement>(null);const urls=useRef<string[]>([]);const index=useRef(0);const alive=useRef(true);const busy=useRef(false);
 const [loading,setLoading]=useState(false),[playing,setPlaying]=useState(false),[error,setError]=useState('');
 useEffect(()=>{alive.current=true;const element=audio.current;return()=>{alive.current=false;element?.pause();urls.current.forEach(URL.revokeObjectURL);};},[]);
 const play=async()=>{try{await audio.current?.play();if(alive.current)setError('');}catch{if(alive.current){setPlaying(false);setError('已准备好，请再点一次播放');}}};
 const toggle=async()=>{if(busy.current)return;if(playing){audio.current?.pause();return;}
  if(urls.current.length){void play();return;}busy.current=true;setLoading(true);setError('');
  try{const result=await load();if(!alive.current)return;if(!result.clips.length)throw new Error('语音尚未准备好');
   urls.current=result.clips.map(base64=>{const raw=atob(base64);return URL.createObjectURL(new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:'audio/mpeg'}));});index.current=0;if(audio.current)audio.current.src=urls.current[0];await play();
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'朗读暂不可用');}finally{busy.current=false;if(alive.current)setLoading(false);}
 };
 return <span style={{display:'inline-flex',flexWrap:'wrap',alignItems:'center',gap:8}}>
  <button type="button" className="btn btn-secondary" onClick={()=>void toggle()} disabled={loading} style={{display:'inline-flex',alignItems:'center',gap:6,padding:'7px 12px',fontSize:14}}>{playing?<IconPlayerPause size={18}/>:<IconVolume size={18}/ >}{loading?'正在准备…':playing?'暂停':label}</button>
  <audio ref={audio} preload="none" onPlay={()=>{setPlaying(true);document.querySelectorAll('audio').forEach(other=>{if(other!==audio.current)other.pause();});}} onPause={()=>setPlaying(false)} onError={()=>{setPlaying(false);setError('播放失败，请重试');}} onEnded={()=>{index.current++;if(index.current<urls.current.length){if(audio.current)audio.current.src=urls.current[index.current];void play();}else{index.current=0;if(audio.current)audio.current.src=urls.current[0];setPlaying(false);}}}/>
  {error&&<small role="status">{error}</small>}
 </span>;
}
