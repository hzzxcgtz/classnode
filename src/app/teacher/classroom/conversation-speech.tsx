'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
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
  const anchor = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{dialog: HTMLDialogElement; left: number; top: number; visible: boolean} | null>(null);
  const plain = stripMarkdownToPlainText(text).trim();
  // Render controls outside the drawing layer but keep them anchored beside the name.
  // This also avoids the pointer lock applied to annotation content.
  useLayoutEffect(() => {
    const element = anchor.current;
    const dialog = element?.closest('dialog');
    if (!element || !dialog) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const region = element.closest('[role="region"]')?.getBoundingClientRect();
      setPosition({dialog,left:rect.left,top:rect.top,visible:rect.width>0 && (!region || rect.top>=region.top && rect.bottom<=region.bottom)});
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element); observer.observe(dialog);
    dialog.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); dialog.removeEventListener('scroll',measure,true); window.removeEventListener('resize',measure); };
  }, []);
  if (!plain || !speech) return null;
  const active = speech.selected === id;
  const playing = active && speech.state === 'playing';
  const loading = active && speech.state === 'loading';
  const busy = active && speech.state !== 'idle';
  const label = loading ? '正在准备语音' : playing ? '暂停朗读' : active && speech.state === 'paused' ? '继续朗读' : '朗读回复';
  return <span ref={anchor} className={styles.conversationSpeechAnchor}>
    {position?.visible && createPortal(<div className={styles.conversationSpeech} style={{left:position.left,top:position.top}}>
      <button type="button" className={styles.conversationSpeechIcon} aria-label={label} title={label} disabled={loading} aria-pressed={busy} onClick={()=>speech.read(id,plain)}>
        {loading ? <IconLoader2 size={20}/> : playing ? <><IconPlayerPause size={22}/><span className={styles.speechWave} data-playing="true" aria-hidden="true"><i/><i/><i/></span></> : active && speech.state==='paused' ? <IconPlayerPlay size={24}/> : <IconVolume size={26} stroke={1.8}/>}
      </button>
      {busy && <button type="button" className={`${styles.conversationSpeechIcon} ${styles.conversationSpeechStop}`} aria-label="停止朗读" title="停止朗读" onClick={speech.stop}><IconPlayerStop size={17} fill="currentColor"/></button>}
      {active && speech.error && <span className={styles.conversationSpeechError} role="status">{speech.error}</span>}
    </div>,position.dialog)}
  </span>;
}
