import { useEffect, useRef, useState } from 'react';
import type { BrowserSpeechRecognition, SpeechRecognitionWindow } from '../classroom-types';

interface VoiceInputOptions {
  input: string;
  setInput: (v: string) => void;
  setToast: (t: { msg: string; type: 'success' | 'error' | 'info' } | null) => void;
  inputRef: { current: HTMLTextAreaElement | null };
}

export function useVoiceInput(options: VoiceInputOptions) {
  const [voiceInputAvailable, setVoiceInputAvailable] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const voiceRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const voiceInputBaseRef = useRef('');
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  useEffect(() => {
    const speechWindow = window as SpeechRecognitionWindow;
    setVoiceInputAvailable(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
  }, []);

  const voiceErrorMessage = (error: string) => {
    if (error === 'not-allowed' || error === 'service-not-allowed') {
      return '无法使用语音输入。请使用 Safari 打开，并在系统设置中启用 Siri、听写和麦克风权限';
    }
    if (error === 'audio-capture') return '没有检测到可用的麦克风，请检查 iPad 麦克风权限';
    if (error === 'network') return '语音识别服务暂时无法连接，请检查网络后重试';
    if (error === 'no-speech') return '没有听清，请靠近麦克风后重试';
    return '语音识别失败，请稍后重试或使用键盘输入';
  };

  const toggleVoiceInput = () => {
    if (voiceListening) {
      voiceRecognitionRef.current?.stop();
      setVoiceListening(false);
      return;
    }

    const speechWindow = window as SpeechRecognitionWindow;
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      optionsRef.current.setToast({ msg: '当前浏览器不支持语音输入，请使用 Safari 或系统键盘听写', type: 'info' });
      return;
    }

    const recognition = new Recognition();
    voiceInputBaseRef.current = optionsRef.current.input;
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0]?.transcript || '';
      }
      optionsRef.current.setInput(`${voiceInputBaseRef.current}${transcript}`);
      requestAnimationFrame(() => {
        const textarea = optionsRef.current.inputRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
      });
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') {
        optionsRef.current.setToast({ msg: voiceErrorMessage(event.error), type: 'error' });
      }
      setVoiceListening(false);
      voiceRecognitionRef.current = null;
    };
    recognition.onend = () => {
      setVoiceListening(false);
      voiceRecognitionRef.current = null;
    };

    voiceRecognitionRef.current = recognition;
    try {
      recognition.start();
      setVoiceListening(true);
    } catch {
      voiceRecognitionRef.current = null;
      setVoiceListening(false);
      optionsRef.current.setToast({ msg: '语音输入启动失败，请检查 Safari 的麦克风权限', type: 'error' });
    }
  };

  // 卸载时中止语音：原本与 socket / 定时器清理写在 page.tsx 的同一个卸载 effect 里，
  // 拆出来后仍在同一组件卸载时执行，行为不变。
  useEffect(() => () => {
    if (voiceRecognitionRef.current) {
      voiceRecognitionRef.current.abort();
      voiceRecognitionRef.current = null;
    }
  }, []);

  return { voiceInputAvailable, voiceListening, toggleVoiceInput };
}
