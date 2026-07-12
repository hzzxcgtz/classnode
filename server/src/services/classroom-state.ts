export type ClassroomStatus = 'active' | 'paused' | 'ended';
export type ClassroomAction = 'pause' | 'resume' | 'end' | 'restore';

export const ALLOWED_SOURCE_STATUSES: Record<ClassroomAction, readonly ClassroomStatus[]> = {
  pause: ['active'],
  resume: ['paused'],
  end: ['active', 'paused'],
  restore: ['ended'],
};

export function canTransition(status: ClassroomStatus, action: ClassroomAction): boolean {
  return ALLOWED_SOURCE_STATUSES[action].includes(status);
}
