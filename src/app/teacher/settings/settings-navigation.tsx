'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconUserCircle, IconShieldCheck, IconMicrophone, IconInfoCircle, IconNetwork } from '@tabler/icons-react';
import styles from './settings.module.css';

export const settingsItems = [
  { value: 'network', path: '/teacher/network', label: '课堂连接', Icon: IconNetwork },
  { value: 'voice', path: '/teacher/voice', label: '语音设置', Icon: IconMicrophone },
  { value: 'shield', path: '/teacher/shield', label: '智能学伴安全', Icon: IconShieldCheck },
  { value: 'avatars', path: '/teacher/avatars', label: '头像与图标', Icon: IconUserCircle },
  { value: 'about', path: '/teacher/about', label: '关于', Icon: IconInfoCircle },
] as const;

export type SettingsTab = typeof settingsItems[number]['value'];

export function isSettingsPath(path: string) {
  return ['/teacher/settings', '/teacher/agents/speech', ...settingsItems.map(item => item.path)]
    .some(prefix => path === prefix || path.startsWith(prefix + '/'));
}

export function SettingsNavigation() {
  const pathname = (usePathname() ?? '').replace(/\/$/, '');
  if (!isSettingsPath(pathname) || pathname === '/teacher/settings') return null;
  return (
    <nav className={styles.tabs} aria-label="设置分类">
      {settingsItems.map(({ value, path, label, Icon }) => (
        <Link key={value} href={`/teacher/settings/?tab=${value}`}
          aria-current={pathname === path || (value === 'voice' && pathname === '/teacher/agents/speech') ? 'page' : undefined}>
          <Icon size={23} stroke={1.6} aria-hidden="true" />{label}
        </Link>
      ))}
    </nav>
  );
}
