'use client';
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
export default function LegacySpeechSettings(){const router=useRouter();useEffect(()=>{router.replace('/teacher/voice/?tab=recording');},[router]);return <p role="status">正在打开语音设置…</p>;}
