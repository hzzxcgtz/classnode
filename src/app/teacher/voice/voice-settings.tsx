'use client';
import {useEffect,useState} from 'react';
import {TeacherPageHeader,TeacherPageTabs} from '@/lib/components';
import {TranscriptionSettings} from './transcription-settings';
import {RecordingSettings} from '../network/recording-settings';
import {SpeechSettings} from '../agents/speech/speech-settings';
import styles from './voice.module.css';
export function VoiceSettings({embedded=false}:{embedded?:boolean}){
 const [tab,setTab]=useState<'recording'|'reading'|'transcription'>('recording');
 useEffect(()=>{const mode=new URLSearchParams(window.location.search).get('mode');if(mode==='reading'||mode==='transcription')setTab(mode);},[]);
 const select=(value:'recording'|'reading'|'transcription')=>{setTab(value);const url=new URL(window.location.href);url.searchParams.set('mode',value);window.history.replaceState(null,'',url.pathname+url.search);};
 return <div className={styles.page}>
  {!embedded&&<TeacherPageHeader title="语音设置" description="设置学生录音、语音朗读与录音转文字服务。"/>}
  {embedded&&<div className={styles.description}>设置学生录音、语音朗读与录音转文字服务。</div>}
  <TeacherPageTabs value={tab} onChange={select} items={[{value:'recording',label:'学生录音'},{value:'reading',label:'语音朗读'},{value:'transcription',label:'录音转文字'}]}/>
  <section id="voice-recording" role="tabpanel" aria-label="学生录音" hidden={tab!=='recording'}><RecordingSettings embedded/></section>
  <section id="voice-reading" role="tabpanel" aria-label="语音朗读" hidden={tab!=='reading'}><SpeechSettings embedded/></section>
  <section id="voice-transcription" role="tabpanel" aria-label="录音转文字" hidden={tab!=='transcription'}><TranscriptionSettings/></section>
 </div>;
}
