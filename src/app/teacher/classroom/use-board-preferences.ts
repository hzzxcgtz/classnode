'use client';

import { useEffect, useState } from 'react';
import type { ModuleId } from '@/lib/classroom-modules';

type BoardMode = 'follow' | 'assign';
interface BoardPreferences { mode: BoardMode; module: ModuleId }
const defaults: BoardPreferences = { mode: 'follow', module: 'companion' };

export function parseBoardPreferences(raw: string | null): BoardPreferences {
  try {
    const value = JSON.parse(raw ?? 'null');
    return {
      mode: value?.mode === 'assign' ? 'assign' : 'follow',
      module: ['worksheet', 'explore', 'companion'].includes(value?.module) ? value.module : 'companion',
    };
  } catch { return { ...defaults }; }
}

/** Restore before persisting, so a refresh never overwrites the saved choice with defaults. */
export function useBoardPreferences(classroomId: string) {
  const [state, setState] = useState({ classroomId: '', ...defaults });
  useEffect(() => {
    if (!classroomId) return;
    let saved = { ...defaults };
    try { saved = parseBoardPreferences(localStorage.getItem(`classnode:board:${classroomId}`)); } catch { /* Storage may be disabled. */ }
    setState({ classroomId, ...saved });
  }, [classroomId]);
  useEffect(() => {
    if (!classroomId || state.classroomId !== classroomId) return;
    try { localStorage.setItem(`classnode:board:${classroomId}`, JSON.stringify({mode: state.mode, module: state.module})); } catch { /* Keep controls usable without storage. */ }
  }, [classroomId, state]);
  const current = state.classroomId === classroomId ? state : defaults;
  return {
    boardMode: current.mode,
    assignModule: current.module,
    setBoardMode: (mode: BoardMode) => setState(previous => ({ ...previous, classroomId, mode })),
    setAssignModule: (module: ModuleId) => setState(previous => ({ ...previous, classroomId, module })),
  };
}
