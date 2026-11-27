'use client';
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
export default function LegacyNetworkSettings(){const router=useRouter();useEffect(()=>{router.replace('/teacher/settings/?tab=network');},[router]);return <p role="status">正在打开课堂连接设置…</p>;}
