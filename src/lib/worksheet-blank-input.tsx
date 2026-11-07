'use client';

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

/** Keep the configured width while growing vertically with the answer. */
export function BlankInput(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight + 2}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={ref} rows={1} style={{lineHeight:1.45, resize:'none', overflow:'hidden', verticalAlign:'middle', whiteSpace:'pre-wrap', overflowWrap:'anywhere', maxWidth:'100%', boxSizing:'border-box', ...props.style}} />;
}
