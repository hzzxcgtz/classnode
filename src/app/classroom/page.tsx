'use client';

import { Suspense } from 'react';
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
        <StudentChatContent />
      </Suspense>
    </>
  );
}
