'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './fullscreen-preview.module.css';

/** Keep audio controls clickable above the annotation layer at their heading position. */
export function AnchoredSpeechControls({children}: {children: ReactNode}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [position,setPosition] = useState<{dialog: HTMLDialogElement;left:number;top:number;visible:boolean}|null>(null);
  useLayoutEffect(()=>{
    const element=anchor.current, dialog=element?.closest('dialog');
    if(!element||!dialog)return;
    const measure=()=>{
      const rect=element.getBoundingClientRect(), region=element.closest('[role="region"]')?.getBoundingClientRect();
      setPosition({dialog,left:rect.left,top:rect.top,visible:rect.width>0&&(!region||rect.top>=region.top&&rect.bottom<=region.bottom)});
    };
    measure();const observer=new ResizeObserver(measure);observer.observe(element);observer.observe(dialog);
    dialog.addEventListener('scroll',measure,true);window.addEventListener('resize',measure);
    return()=>{observer.disconnect();dialog.removeEventListener('scroll',measure,true);window.removeEventListener('resize',measure);};
  },[]);
  return <span ref={anchor} className={styles.conversationSpeechAnchor}>{position?.visible&&createPortal(<div className={styles.conversationSpeech} style={{left:position.left,top:position.top}}>{children}</div>,position.dialog)}</span>;
}
