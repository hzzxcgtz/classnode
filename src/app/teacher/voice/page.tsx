'use client';
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
export default function VoiceSettingsPage(){const router=useRouter();useEffect(()=>{const mode=new URLSearchParams(window.location.search).get('tab')==='reading'?'reading':'recording';router.replace('/teacher/settings/?tab=voice&mode='+mode);},[router]);return <p role="status">正在打开语音设置…</p>;}
