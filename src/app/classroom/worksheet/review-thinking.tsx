'use client';

import { useEffect, useState } from 'react';
import styles from './worksheet.module.css';

/** Mount separately for each review/phase so queue time is not counted as thinking. */
export function ReviewThinking({ queued }: { queued: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return <>
    <span className={styles.reviewThinkingBuddy} aria-hidden="true"><img src="/logo.png" alt="" /><i>✦</i><i>✦</i></span>
    <span className={styles.reviewThinkingCopy}>
      <strong>{queued ? '作答已提交，正在等待评价…' : '支点博士正在思考，请稍等…'}</strong>
      <span>{queued ? '轮到你的作答后，就会开始评价啦' : '正在发现你作答中的亮点，准备小建议'}</span>
      <span className={styles.reviewThinkingProgress} aria-live="off">
        <span className={styles.thinkingDots} aria-hidden="true"><i /><i /><i /></span>
        <span>{queued ? '已等待' : '已思考'} <span className={styles.reviewThinkingSeconds}>{seconds}</span> 秒</span>
      </span>
    </span>
  </>;
}
