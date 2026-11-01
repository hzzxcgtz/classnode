'use client';
import {useEffect,useState} from 'react';
import {TeacherPageHeader,TeacherPageTabs} from '@/lib/components';
import AvatarsPage from '../avatars/page';
import ShieldPage from '../shield/page';
import AboutPage from '../about/page';
import {VoiceSettings} from '../voice/voice-settings';
import {settingsItems} from './settings-navigation';
import styles from './settings.module.css';
type Tab='avatars'|'shield'|'voice'|'about';
const validTabs:Tab[]=['avatars','shield','voice','about'];
export default function SettingsPage(){
 const [tab,setTab]=useState<Tab>('avatars');
 useEffect(()=>{const read=()=>{const value=new URLSearchParams(window.location.search).get('tab');if(validTabs.includes(value as Tab))setTab(value as Tab);};read();window.addEventListener('popstate',read);return()=>window.removeEventListener('popstate',read);},[]);
 const select=(value:Tab)=>{setTab(value);const url=new URL(window.location.href);url.searchParams.set('tab',value);window.history.replaceState(null,'',url.pathname+url.search);};
 return <><TeacherPageHeader title="设置" description="管理课堂的头像、安全与语音配置，查看应用信息。"/>
  <div className={styles.workspace}><div className={styles.tabs}><TeacherPageTabs variant="connected" value={tab} onChange={select} items={settingsItems.map(({label,Icon},index)=>({value:validTabs[index],label,icon:<Icon size={23} stroke={1.6} aria-hidden="true"/>}))}/></div>
  <div className={styles.content} data-settings-section={tab} role="region" aria-label={settingsItems[validTabs.indexOf(tab)].label}>
   {tab==='avatars'?<AvatarsPage/>:tab==='shield'?<ShieldPage/>:tab==='voice'?<VoiceSettings embedded/>:<AboutPage/>}
  </div></div>
 </>;
}
