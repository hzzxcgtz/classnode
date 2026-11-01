'use client';

import { createContext, useContext, useEffect, useState, type ComponentProps } from 'react';
import { AnchoredSpeechControls } from './anchored-speech-controls';
import { IconVolume, IconPlayerPause, IconPlayerPlay, IconPlayerStop, IconLoader2 } from '@tabler/icons-react';
import { stripMarkdownToPlainText } from '@/lib/markdown';
import { FullscreenPreview } from './fullscreen-preview';
import { useReviewSpeech } from './use-review-speech';
import styles from './fullscreen-preview.module.css';

type SpeechActions = { selected: string | null; state: string; error: string; read: (id: string, text: string) => void; stop: () => void };
const SpeechContext = createContext<SpeechActions | null>(null);

export function ConversationSpeechPreview(props: ComponentProps<typeof FullscreenPreview>) {
  const [selection, setSelection] = useState<{id: string; text: string} | null>(null);
  const speech = useReviewSpeech(selection?.text ?? '', '', true, selection?.id ?? '');
  useEffect(() => {
    if (selection) void speech.start('reason');
    // Start after the hook resets its audio for the newly selected message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);
  return <SpeechContext.Provider value={{selected:selection?.id ?? null,state:speech.state,error:speech.error,stop:speech.stop,
    read:(id,text)=>{if(selection?.id===id)void speech.start('reason');else setSelection({id,text});}}}>
    <FullscreenPreview {...props}/>
  </SpeechContext.Provider>;
}

export function ConversationReadButton({id, text}: {id: string; text: string}) {
  const speech = useContext(SpeechContext);
  const plain = stripMarkdownToPlainText(text).trim();
  if (!plain || !speech) return null;
  const active = speech.selected === id;
  const playing = active && speech.state === 'playing';
  const loading = active && speech.state === 'loading';
  const busy = active && speech.state !== 'idle';
  const label = loading ? '正在准备语音' : playing ? '暂停朗读' : active && speech.state === 'paused' ? '继续朗读' : '朗读回复';
  return <AnchoredSpeechControls>
      <button type="button" className={styles.conversationSpeechIcon} aria-label={label} title={label} disabled={loading} aria-pressed={busy} onClick={()=>speech.read(id,plain)}>
        {loading ? <IconLoader2 size={20}/> : playing ? <><IconPlayerPause size={22}/><span className={styles.speechWave} data-playing="true" aria-hidden="true"><i/><i/><i/></span></> : active && speech.state==='paused' ? <IconPlayerPlay size={24}/> : <IconVolume size={26} stroke={1.8}/>}
      </button>
      {busy && <button type="button" className={`${styles.conversationSpeechIcon} ${styles.conversationSpeechStop}`} aria-label="停止朗读" title="停止朗读" onClick={speech.stop}><IconPlayerStop size={17} fill="currentColor"/></button>}
      {active && speech.error && <span className={styles.conversationSpeechError} role="status">{speech.error}</span>}
  </AnchoredSpeechControls>;
}
