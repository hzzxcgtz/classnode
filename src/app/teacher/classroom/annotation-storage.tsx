'use client';
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { annotationPersistence } from '@/lib/annotation-persistence';
import { api } from '@/lib/api';

export const AnnotationClassroomContext = createContext<string | null>(null);
const empty = {ready:true,loading:false,saving:false,error:'',conflict:false,document:null};
const noSubscribe = () => () => {};
const emptySnapshot = () => empty;
export function useAnnotationStorage(target?: string) {
  const classroomId = useContext(AnnotationClassroomContext);
  const session = useMemo(() => classroomId && target ? annotationPersistence(classroomId,target,api) : null, [classroomId,target]);
  const state = useSyncExternalStore(session?.subscribe ?? noSubscribe,session?.snapshot ?? emptySnapshot,emptySnapshot);
  useEffect(() => { void session?.load(); }, [session]);
  return {session,state};
}
