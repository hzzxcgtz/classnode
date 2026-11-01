'use client';
import {createContext} from 'react';
/** Layout captured with a text annotation; undefined leaves live controls unchanged. */
export const AnnotationTranscriptContext=createContext<string[]|undefined>(undefined);
