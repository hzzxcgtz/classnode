'use client';

import { useCallback, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl } from './api-base';
import type { ClientToServerEvents, ServerToClientEvents } from './socket-events';

/** 全局共享的单例 socket，避免组件卸载时断开连接导致事件丢失 */
let globalSocket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!globalSocket) {
    globalSocket = io(getApiBaseUrl(), {
      transports: ['websocket', 'polling'],
      withCredentials: true,
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
  const [socket] = useState(getSocket);
  const socketRef = useMemo(() => ({ current: socket }), [socket]);

  const joinClassroom = useCallback((classroomCode: string, studentId: string) => {
    socketRef.current?.emit('join-classroom', { classroomCode, studentId });
  }, [socketRef]);

  const joinTeacherBoard = useCallback((classroomId: string) => {
    socketRef.current?.emit('join-teacher-board', classroomId);
  }, [socketRef]);

  const sendMessage = useCallback((classroomCode: string, studentId: string, content: string) => {
    socketRef.current?.emit('send-message', { classroomCode, studentId, content });
  }, [socketRef]);

  const on = useCallback(<K extends string & keyof ServerToClientEvents>(event: K, handler: ServerToClientEvents[K]) => {
    const socket = socketRef.current as unknown as {
      on: (name: string, listener: (...args: never[]) => void) => void;
      off: (name: string, listener: (...args: never[]) => void) => void;
    } | null;
    const listener = handler as (...args: never[]) => void;
    socket?.on(event, listener);
    return () => {
      socket?.off(event, listener);
    };
  }, [socketRef]);

  const emit = useCallback(<K extends string & keyof ClientToServerEvents>(event: K, ...args: Parameters<ClientToServerEvents[K]>) => {
    socketRef.current?.emit(event, ...args);
  }, [socketRef]);

  return { socket: socketRef, joinClassroom, joinTeacherBoard, sendMessage, on, emit };
}
