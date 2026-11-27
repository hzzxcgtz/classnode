'use client';
import {useEffect,useState} from 'react';
import {TeacherPageHeader,TeacherPageTabs} from '@/lib/components';
import {TranscriptionSettings} from './transcription-settings';
import {SpeechSettings} from '../agents/speech/speech-settings';
import styles from './voice.module.css';
export function VoiceSettings({embedded=false}:{embedded?:boolean}){
 const [tab,setTab]=useState<'reading'|'transcription'>('transcription');
 useEffect(()=>{
  const query = new URLSearchParams(window.location.search);
  const mode = query.get('mode');
  if(mode==='reading'||mode==='transcription')setTab(mode);
  else if(!embedded && (mode==='recording'||query.get('tab')==='recording'))window.location.replace('/teacher/settings/?tab=network');
 },[embedded]);
 const select=(value:'reading'|'transcription')=>{setTab(value);const url=new URL(window.location.href);url.searchParams.set('mode',value);window.history.replaceState(null,'',url.pathname+url.search);};
 return <div className={styles.page}>
  {!embedded&&<TeacherPageHeader title="语音设置" description="设置录音转文字与课堂朗读服务。"/>}
  {embedded&&<div className={styles.description}>设置录音转文字与课堂朗读服务。</div>}
  <TeacherPageTabs value={tab} onChange={select} items={[{value:'transcription',label:'录音转文字'},{value:'reading',label:'语音朗读'}]}/>
  <section id="voice-reading" role="tabpanel" aria-label="语音朗读" hidden={tab!=='reading'}><SpeechSettings embedded/></section>
  <section id="voice-transcription" role="tabpanel" aria-label="录音转文字" hidden={tab!=='transcription'}><TranscriptionSettings/></section>
 </div>;
}
