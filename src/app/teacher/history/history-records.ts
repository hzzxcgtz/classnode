import type { ClassroomHistoryItem } from '@/lib/types';

export type HistoryModule = '' | 'worksheet' | 'explorer' | 'companion';
export interface HistoryFilters {
  search: string;
  classId: string;
  module: HistoryModule;
  from: string;
  to: string;
  sort: 'newest' | 'oldest';
}
export const emptyHistoryFilters: HistoryFilters = { search: '', classId: '', module: '', from: '', to: '', sort: 'newest' };

// Match calendar dates in the teacher's local timezone, including the entire last day.
function calendarDay(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function filterHistory(records: ClassroomHistoryItem[], filters: HistoryFilters): ClassroomHistoryItem[] {
  if (filters.from && filters.to && filters.from > filters.to) return [];
  const terms = filters.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return records.filter(record => {
    const text = [record.title || '未命名课堂', ...record.classes.map(c => c.class.name)].join(' ').toLocaleLowerCase();
    if (!terms.every(term => text.includes(term))) return false;
    if (filters.classId && !record.classes.some(c => c.classId === filters.classId)) return false;
    if (filters.module === 'worksheet' && !(record.worksheetTotal > 0)) return false;
    if (filters.module === 'explorer' && !(record.webappUsageCount > 0)) return false;
    if (filters.module === 'companion' && !(record.totalRounds > 0 || record.totalChars > 0)) return false;
    const day = calendarDay(record.endedAt || record.createdAt);
    if ((filters.from || filters.to) && !day) return false;
    return !(filters.from && day < filters.from) && !(filters.to && day > filters.to);
  }).sort((a, b) => {
    const timestamp = (record: ClassroomHistoryItem) => new Date(record.endedAt || record.createdAt).getTime() || 0;
    const delta = timestamp(a) - timestamp(b);
    return filters.sort === 'oldest' ? delta : -delta;
  });
}
