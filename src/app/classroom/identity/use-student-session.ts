import { useEffect, useRef } from 'react';
import { api, setStudentSessionToken } from '@/lib/api';
import { fixSvgUrl } from '../avatar-utils';
import type { AvatarSummary, ClassroomStudentSummary, StudentClassroom } from '@/lib/types';

// restoreSessionFromUrl 只写不读组件里的 code state —— 课堂码由 URL 解析到本地
// 变量 codeFromUrl，所以这里接收 setCode，不接收 code。
interface StudentSessionOptions {
  router: { push: (href: string) => void };
  seenNotifIdsRef: { current: Set<string> };
  loadClassroom: (classroomCode?: string, sessionStudentId?: string) => Promise<StudentClassroom | undefined>;
  loadMessages: (classroomId: string, studentId: string) => Promise<void>;
  startChatSession: (studentId: string, studentName: string, classroomCode?: string, token?: string) => Promise<void>;
  setCode: (v: string) => void;
  setSelectedStudent: (v: ClassroomStudentSummary | null) => void;
  setStep: (v: 'loading' | 'identity' | 'chat') => void;
  setTeacherMsgs: (v: { message: string; time: string }[]) => void;
  setAvatarSvgs: (v: Record<number, string>) => void;
  setAllStudentAvatars: (v: AvatarSummary[]) => void;
  setAvatarTokenCount: (v: number) => void;
}

export function useStudentSession(options: StudentSessionOptions) {
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });

  // 首次渲染时一次性读取 URL 并处理全部逻辑，消除时序竞争
  const restoreSessionFromUrl = async (now: number) => {
    const o = optionsRef.current;
    let codeFromUrl = '';
    try {
      codeFromUrl = new URLSearchParams(window.location.search).get('code') || '';
    } catch {
      // URLSearchParams is available on iPadOS 15, but retain a simple parser
      // for restricted WebViews and unusual QR scanner browsers.
      const match = window.location.search.match(/[?&]code=([^&]+)/);
      codeFromUrl = match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : '';
    }
    if (!codeFromUrl) { o.router.push('/'); return; }
    o.setCode(codeFromUrl);
    let saved: string | null = null;
    try { saved = localStorage.getItem(`chat_session_${codeFromUrl}`); } catch {}
    let sessionData: { studentId: string; studentName: string; token?: string } | null = null;
    if (saved) {
      try {
        const session = JSON.parse(saved);
        if (now - session.timestamp < 7200000) {
          sessionData = { studentId: session.studentId, studentName: session.studentName, token: session.token };
          setStudentSessionToken(session.token);
          o.setSelectedStudent({ id: session.studentId, participantType: 'student', studentId: null, name: session.studentName, studentNo: null, gender: null, avatarId: null, groupId: null, status: 'offline' });
        } else {
          try { localStorage.removeItem(`chat_session_${codeFromUrl}`); } catch {}
        }
      } catch {
        try { localStorage.removeItem(`chat_session_${codeFromUrl}`); } catch {}
      }
    }
    o.loadClassroom(codeFromUrl, sessionData?.studentId).then(async (cr) => {
      if (!cr) {
        if (sessionData) {
          try { localStorage.removeItem(`chat_session_${codeFromUrl}`); } catch {}
          setStudentSessionToken();
          o.setSelectedStudent(null);
        }
        return;
      }
      if (sessionData) {
        // 每次刷新都在后台静默续领，兼容应用重启和旧版保存的本地会话。
        try {
          const renewed = await api.createStudentSession(codeFromUrl, sessionData.studentId);
          sessionData.token = renewed.token;
          setStudentSessionToken(renewed.token);
          try {
            localStorage.setItem(`chat_session_${codeFromUrl}`, JSON.stringify({
              studentId: sessionData.studentId,
              studentName: sessionData.studentName,
              token: renewed.token,
              timestamp: Date.now(),
            }));
          } catch {}
        } catch {
          try { localStorage.removeItem(`chat_session_${codeFromUrl}`); } catch {}
          o.setSelectedStudent(null);
          o.setStep('identity');
          return;
        }
        // 有有效会话，直接进入对话页恢复聊天（identity-conflict 事件兜底处理设备冲突）
        o.setStep('chat');
        // 从数据库加载教师通知（持久化后可导出，且刷新不丢失）
        if (cr.id) {
          try {
            const notifs = await api.getTeacherNotifications(cr.id, sessionData.studentId);
            const seen = o.seenNotifIdsRef.current;
            const msgs: { message: string; time: string }[] = [];
            for (const n of notifs) {
              seen.add(n.id);
              const d = new Date(n.createdAt);
              const time = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
              msgs.push({ message: n.content, time });
            }
            o.setTeacherMsgs(msgs);
            // 持久化已见的通知 ID 以防 socket 重放重复
            try { localStorage.setItem('_seen_notif_ids', JSON.stringify([...seen])); } catch {}
          } catch {}
        }
        if (cr.id) await o.loadMessages(cr.id, sessionData.studentId);
        o.startChatSession(sessionData.studentId, sessionData.studentName, codeFromUrl, sessionData.token);
        // 恢复头像数据 + token
        try {
          const [avData, avTeacherData, stsData, tokenData] = await Promise.all([
            api.getAvatarsAll('student'),
            api.getAvatars('student'),
            cr.id ? api.getClassroomStudents(cr.id) : Promise.resolve([]),
            Promise.resolve({ tokens: 0 }),
          ]);
          const m: Record<number, string> = {};
          avData.forEach((avatar) => { m[avatar.id] = fixSvgUrl(avatar.svgContent); });
          o.setAvatarSvgs(m);
          o.setAllStudentAvatars(avTeacherData);
          const cur = stsData.find((student) => student.id === sessionData!.studentId);
          if (cur) {
            o.setSelectedStudent(cur);
            if (cur.studentId) {
              const tokenData = await api.getStudentTokens(cur.id);
              o.setAvatarTokenCount(tokenData.tokens || 0);
            } else o.setAvatarTokenCount(0);
          }
        } catch {}
      } else {
        o.setStep('identity');
      }
    });
  };

  return { restoreSessionFromUrl };
}
