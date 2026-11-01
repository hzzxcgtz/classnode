'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {IconUserCircle,IconShieldCheck,IconMicrophone,IconInfoCircle} from '@tabler/icons-react';
import styles from './settings.module.css';
export const settingsItems=[
 {path:'/teacher/avatars/',label:'头像管理',description:'管理学生头像与奖励图标。',Icon:IconUserCircle},
 {path:'/teacher/shield/',label:'安全管理',description:'管理屏蔽词与课堂安全规则。',Icon:IconShieldCheck},
 {path:'/teacher/voice/',label:'语音设置',description:'设置学生录音环境与语音朗读。',Icon:IconMicrophone},
 {path:'/teacher/about/',label:'关于',description:'查看版本信息、更新与应用说明。',Icon:IconInfoCircle},
];
export function isSettingsPath(path:string){return ['/teacher/settings','/teacher/avatars','/teacher/shield','/teacher/voice','/teacher/about','/teacher/network','/teacher/agents/speech'].some(prefix=>path.replace(/\/$/,'')===prefix||path.startsWith(prefix+'/'));}
export function SettingsNavigation(){const pathname=usePathname()??'';if(!isSettingsPath(pathname)||pathname.replace(/\/$/,'')==='/teacher/settings')return null;return <nav className={styles.tabs} aria-label="设置分类">{settingsItems.map(({path,label,Icon},index)=><Link key={path} href={`/teacher/settings/?tab=${['avatars','shield','voice','about'][index]}`} aria-current={pathname.startsWith(path)?'page':undefined}><Icon size={23} stroke={1.6} aria-hidden="true"/>{label}</Link>)}</nav>;}
