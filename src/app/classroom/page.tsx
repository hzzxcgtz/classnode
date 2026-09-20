'use client';

import { Suspense, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Socket } from 'socket.io-client';
import { IdentityPicker } from './identity/identity-picker';
import { useClassroomSession } from './use-classroom-session';
import { StudentChatContent } from './chat/chat-panel';

export default function StudentChatPage() {
  return (
    <>
      <style>{`
        :root { --primary: #667eea; --text-secondary: #6b7280; --border: #e5e7eb; --bg: #f3f4f6; --danger: #ef4444; --primary-light: #eef2ff; }
        @keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0 } }
        @keyframes thinkingWave { 0%,60%,100% { color: #94a3b8 } 30% { color: #818cf8 } }
        @keyframes teacherBubbleIn { from { opacity:0; transform: translateY(-8px) scale(0.96); } to { opacity:1; transform: translateY(0) scale(1); } }
        @keyframes notifSlideUp { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform: translateY(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #f1f5f9; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
      <Suspense fallback={<div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',color:'white'}}>加载中...</div>}>
        <ClassroomOrchestrator />
      </Suspense>
    </>
  );
}

/**
 * 编排者：step 状态机 + loading/identity 分支 + 挂载面板。
 * 这里创建的 ref 同时交给外壳与面板，两侧必须是同一个对象（M0 Ruling 8）。
 */
function ClassroomOrchestrator() {
  const router = useRouter();
  const wsRef = useRef<Socket | null>(null);
  const statusSocketRef = useRef<Socket | null>(null);
  const chatConnectionGenerationRef = useRef(0);
  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  // useChatSocket 上移到外壳后，它内部使用的 ref 仍在这里声明：外壳与面板必须拿到
  // 同一个对象，否则停止生成 / 发送闸门 / 卸载清理会静默失效（M0 Ruling 8）。
  const sendingRef = useRef(false);
  const identityConflictTimerRef = useRef<number | null>(null);
  const teacherNotifTimerRef = useRef<number | null>(null);
  const streamingBufferRef = useRef('');
  const streamingRafRef = useRef<number | null>(null);

  const session = useClassroomSession({
    router,
    wsRef,
    statusSocketRef,
    chatConnectionGenerationRef,
    seenNotifIdsRef,
    sendingRef,
    identityConflictTimerRef,
    teacherNotifTimerRef,
    streamingBufferRef,
    streamingRafRef,
  });

  if (session.step === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: "1rem", marginBottom: 8 }}>正在连接课堂...</div>
          <div style={{ fontSize: "0.813rem", opacity: 0.7 }}>互动码: <span>{session.code}</span></div>
        </div>
      </div>
    );
  }

  if (session.step === 'identity') {
    return (
      <IdentityPicker
        classroom={session.classroom}
        students={session.students}
        selectedStudent={session.selectedStudent}
        identitySearch={session.identitySearch}
        onIdentitySearchChange={session.setIdentitySearch}
        onlineStudentIds={session.onlineStudentIds}
        avatarSvgs={session.avatarSvgs}
        joiningClassroom={session.joiningClassroom}
        loadError={session.loadError}
        onSelectStudent={session.setSelectedStudent}
        onConfirm={session.handleIdentityConfirm}
        onExit={session.handleExit}
      />
    );
  }

  return (
    <StudentChatContent
      code={session.code}
      classroom={session.classroom}
      selectedStudent={session.selectedStudent}
      avatarSvgs={session.avatarSvgs}
      avatarTokenCount={session.avatarTokenCount}
      allStudentAvatars={session.allStudentAvatars}
      onlineStudentIds={session.onlineStudentIds}
      teacherMsgs={session.teacherMsgs}
      messages={session.messages}
      loadingMessages={session.loadingMessages}
      waitingAI={session.waitingAI}
      paused={session.paused}
      agentDisabled={session.agentDisabled}
      shieldWarning={session.shieldWarning}
      toast={session.toast}
      loadError={session.loadError}
      connected={session.connected}
      connectionError={session.connectionError}
      streamingContent={session.streamingContent}
      thinkingContent={session.thinkingContent}
      teacherNotifBubble={session.teacherNotifBubble}
      blacklisted={session.blacklisted}
      setStep={session.setStep}
      setSelectedStudent={session.setSelectedStudent}
      setAvatarSvgs={session.setAvatarSvgs}
      setAllStudentAvatars={session.setAllStudentAvatars}
      setMessages={session.setMessages}
      setWaitingAI={session.setWaitingAI}
      setPaused={session.setPaused}
      setAgentDisabled={session.setAgentDisabled}
      setShieldWarning={session.setShieldWarning}
      setToast={session.setToast}
      setLoadError={session.setLoadError}
      setConnectionError={session.setConnectionError}
      setStreamingContent={session.setStreamingContent}
      setThinkingContent={session.setThinkingContent}
      setTeacherNotifBubble={session.setTeacherNotifBubble}
      loadClassroom={session.loadClassroom}
      loadMessages={session.loadMessages}
      fetchStudentTokens={session.fetchStudentTokens}
      startChatSession={session.startChatSession}
      onSwitchIdentity={session.handleSwitchIdentity}
      onExit={session.handleExit}
      router={router}
      wsRef={wsRef}
      statusSocketRef={statusSocketRef}
      chatConnectionGenerationRef={chatConnectionGenerationRef}
      sendingRef={sendingRef}
      identityConflictTimerRef={identityConflictTimerRef}
      teacherNotifTimerRef={teacherNotifTimerRef}
      streamingBufferRef={streamingBufferRef}
      streamingRafRef={streamingRafRef}
    />
  );
}
