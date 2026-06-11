'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl } from './api-base';

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(getApiBaseUrl(), {
        transports: ['websocket', 'polling'],
      });
      socketRef.current.on('connect_error', (err) => {
        console.warn('[Socket] Connection error:', err.message);
      });
      socketRef.current.on('reconnect', (attempt) => {
        console.log('[Socket] Reconnected after', attempt, 'attempts');
      });
    }
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

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
