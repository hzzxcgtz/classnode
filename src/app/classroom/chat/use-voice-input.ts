import { useEffect, useRef, useState } from 'react';
import type { BrowserSpeechRecognition, SpeechRecognitionWindow } from '../classroom-types';

interface VoiceInputOptions {
  input: string;
  setInput: (v: string) => void;
  setToast: (t: { msg: string; type: 'success' | 'error' | 'info' } | null) => void;
  inputRef: { current: HTMLTextAreaElement | null };
  /** 所属模块此刻是否可见（M1b-2 Task 5 / Ruling 6）。转 false 时必须停麦。 */
  active: boolean;
}

export function useVoiceInput(options: VoiceInputOptions) {
  // `active` 在 render 期直接读（下面那条停麦 effect 的依赖要它）；其余入参仍走 optionsRef，
  // 因为回调（onresult / onerror / onend）是在识别器存活期间才被调用的，需要拿到最新的值。
  const { active } = options;
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

  // M1b-2 Task 5 / Ruling 6：模块转为**不可见**时必须停麦。
  // 面板常驻之后（§4.5）「切走」不再等于「卸载」，上面那条卸载清理一辈子都不会跑 ——
  // 学生会在一间被隐藏的模块里持续被录音，而界面上一片安静（没有任何地方显示"正在听"）。
  // 面向未成年人的产品里这不可接受，与 Task 6「送回首页」的语义也矛盾。
  //
  // 中止（不是 stop）是刻意的：abort 不产生 final 结果，也就不会往输入框里再写一次文本 ——
  // **已经转写出来的内容原样留在 `input` 里**（它是在 onresult 里累加进去的），学生切回来
  // 接着说就行。这是 Ruling 6 明确要求的"保留已转写文本"。
  // 三个回调先摘掉再 abort：这里是**主动**中止，不该走 onerror 的报错分支（abort 会触发
  // 一个 error='aborted' 事件，虽然那条分支已经过滤了 aborted，但摘掉更确定 ——
  // 隐藏之后不该再有任何 setState 落在这个 hook 上）。
  useEffect(() => {
    if (active) return;
    const recognition = voiceRecognitionRef.current;
    voiceRecognitionRef.current = null;
    setVoiceListening(false);
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.abort();
  }, [active]);

  return { voiceInputAvailable, voiceListening, toggleVoiceInput };
}
