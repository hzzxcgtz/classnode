'use client';

import { useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl } from './api-base';

/** 全局共享的单例 socket，避免组件卸载时断开连接导致事件丢失 */
let globalSocket: Socket | null = null;

function getSocket(): Socket {
  if (!globalSocket) {
    globalSocket = io(getApiBaseUrl(), {
      transports: ['websocket', 'polling'],
    });
    globalSocket.on('connect_error', (err) => {
      console.warn('[Socket] Connection error:', err.message);
    });
    globalSocket.on('reconnect', (attempt) => {
      console.log('[Socket] Reconnected after', attempt, 'attempts');
    });
  }
  return globalSocket;
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);

  // 使用全局单例 socket，不随组件卸载断开
  if (!socketRef.current) {
    socketRef.current = getSocket();
  }

  const joinClassroom = useCallback((classroomCode: string, studentId: string) => {
    socketRef.current?.emit('join-classroom', { classroomCode, studentId });
  }, []);

  const joinTeacherBoard = useCallback((classroomId: string) => {
    socketRef.current?.emit('join-teacher-board', classroomId);
  }, []);

  const sendMessage = useCallback((classroomCode: string, studentId: string, content: string) => {
    socketRef.current?.emit('send-message', { classroomCode, studentId, content });
  }, []);

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    socketRef.current?.on(event, handler);
    return () => {
      socketRef.current?.off(event, handler);
    };
  }, []);

  const emit = useCallback((event: string, ...args: any[]) => {
    socketRef.current?.emit(event, ...args);
  }, []);

  return { socket: socketRef, joinClassroom, joinTeacherBoard, sendMessage, on, emit };
}
