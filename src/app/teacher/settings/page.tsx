'use client';

import { useEffect, useState } from 'react';
import { TeacherPageHeader, TeacherPageTabs } from '@/lib/components';
import AvatarsPage from '../avatars/page';
import ShieldPage from '../shield/page';
import AboutPage from '../about/page';
import { VoiceSettings } from '../voice/voice-settings';
import { ClassroomConnectionSettings } from '../network/recording-settings';
import { settingsItems, type SettingsTab } from './settings-navigation';
import styles from './settings.module.css';

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('network');
  useEffect(() => {
    const read = () => {
      const query = new URLSearchParams(window.location.search);
      const selected = query.get('tab');
      setTab(selected === 'voice' && query.get('mode') === 'recording'
        ? 'network' : settingsItems.find(item => item.value === selected)?.value ?? 'network');
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  function select(value: SettingsTab) {
    setTab(value);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', value);
    if (url.searchParams.get('mode') === 'recording') url.searchParams.delete('mode');
    window.history.replaceState(null, '', url.pathname + url.search);
  }

  return (
    <>
      <TeacherPageHeader title="设置" description="管理课堂连接、语音、智能学伴安全及头像与图标。" />
      <div className={styles.workspace}>
        <div className={styles.tabs}>
          <TeacherPageTabs variant="connected" value={tab} onChange={select}
            items={settingsItems.map(({ value, label, Icon }) => ({ value, label, icon: <Icon size={23} stroke={1.6} aria-hidden="true" /> }))} />
        </div>
        <div className={styles.content} data-settings-section={tab} role="region" aria-label={settingsItems.find(item => item.value === tab)?.label}>
          {tab === 'network' && <ClassroomConnectionSettings />}
          {tab === 'voice' && <VoiceSettings embedded />}
          {tab === 'shield' && <ShieldPage />}
          {tab === 'avatars' && <AvatarsPage />}
          {tab === 'about' && <AboutPage />}
        </div>
      </div>
    </>
  );
}
