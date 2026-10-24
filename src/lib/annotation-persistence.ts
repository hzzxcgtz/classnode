import type { api } from './api';
import { writeImageAnnotations, type AnnotationDocument } from './image-annotation-session.ts';
import { HttpError } from './http-error.ts';

type State = { ready: boolean; loading: boolean; saving: boolean; error: string; conflict: boolean; document: AnnotationDocument | null };
type Transport = Pick<typeof api, 'readAnnotations' | 'saveAnnotations'>;

/** Serial writes continue after a viewer unmounts; CAS protects edits from another teacher. */
export class AnnotationPersistence {
  state: State = {ready:false, loading:false, saving:false, error:'', conflict:false, document:null};
  revision = 0;
  private saved = '';
  private dirty = false;
  private listeners = new Set<() => void>();
  readonly classroomId: string;
  readonly target: string;
  readonly cacheKey: string;
  private transport: Transport;
  constructor(classroomId: string, target: string, cacheKey: string, transport: Transport) {
    this.classroomId=classroomId; this.target=target; this.cacheKey=cacheKey; this.transport=transport;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private patch(change: Partial<State>) { this.state = {...this.state,...change}; this.listeners.forEach(listener => listener()); }
  get unsaved() { return this.dirty || this.state.saving; }
  async load() {
    if (this.unsaved || this.state.loading) return;
    this.patch({loading:true,ready:false,error:'',conflict:false});
    try {
      const data = await this.transport.readAnnotations(this.classroomId,this.target);
      this.revision = data.revision;
      this.saved = JSON.stringify(data.document);
      writeImageAnnotations(this.cacheKey,data.document?.strokes ?? []);
      this.patch({document:data.document,ready:true});
    } catch(error) { this.patch({error:error instanceof Error ? error.message : '读取批注失败'}); }
    finally { this.patch({loading:false}); }
  }
  update(document: AnnotationDocument) {
    if (!this.state.ready || this.state.conflict) return;
    if (JSON.stringify(document) === JSON.stringify(this.state.document)) return;
    // Mounting a blank canvas is not a change to save.
    if (!this.state.document && !document.strokes.length) return;
    this.dirty = true;
    writeImageAnnotations(this.cacheKey,document.strokes);
    this.patch({document});
    if (!this.state.error) void this.save();
  }
  async save() {
    if (this.state.saving || !this.dirty || this.state.conflict) return;
    this.patch({saving:true,error:''});
    try {
      while (this.dirty && this.state.document) {
        const document = this.state.document;
        const serialized = JSON.stringify(document);
        if (serialized !== this.saved) {
          const result = await this.transport.saveAnnotations(this.classroomId,this.target,document,this.revision);
          this.revision = result.revision; this.saved = serialized;
        }
        this.dirty = JSON.stringify(this.state.document) !== this.saved;
      }
    } catch(error) {
      this.patch({error:error instanceof Error ? error.message : '保存批注失败',conflict:error instanceof HttpError && error.status === 409});
    } finally { this.patch({saving:false}); }
  }
  async reload() {
    if (this.state.saving) return;
    this.dirty = false;
    await this.load();
  }
}

const sessions = new Map<string,AnnotationPersistence>();
let guarding = false;
export function annotationPersistence(classroomId: string, target: string, transport: Transport) {
  const key = JSON.stringify([classroomId,target]);
  if (!sessions.has(key)) sessions.set(key,new AnnotationPersistence(classroomId,target,key,transport));
  if (!guarding && typeof window !== 'undefined') {
    guarding = true;
    window.addEventListener('beforeunload', event => {
      if (![...sessions.values()].some(session => session.unsaved)) return;
      event.preventDefault(); event.returnValue = '';
    });
  }
  return sessions.get(key)!;
}
