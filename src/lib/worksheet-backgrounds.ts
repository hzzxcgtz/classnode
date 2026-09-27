import type { WorksheetBackgroundTheme } from './types';

export interface WorksheetBackgroundOption {
  id: Exclude<WorksheetBackgroundTheme, 'custom'>;
  name: string;
  description: string;
  url: string | null;
  swatch: string;
}

export const DEFAULT_WORKSHEET_BACKGROUND: WorksheetBackgroundTheme = 'cloud-playground';

export const WORKSHEET_BACKGROUND_OPTIONS: readonly WorksheetBackgroundOption[] = [
  { id: 'none', name: '清爽无图', description: '纯色底，最简洁', url: null, swatch: '#f4f7fb' },
  { id: 'cloud-playground', name: '云朵操场', description: '明亮、轻松', url: '/worksheet-backgrounds/cloud-playground.webp', swatch: '#dff2ff' },
  { id: 'forest-explorer', name: '森林探险', description: '自然、好奇', url: '/worksheet-backgrounds/forest-explorer.webp', swatch: '#e9f4e6' },
  { id: 'space-discovery', name: '星际发现', description: '想象、探索', url: '/worksheet-backgrounds/space-discovery.webp', swatch: '#eceeff' },
  { id: 'ocean-observation', name: '海底观察', description: '清新、安静', url: '/worksheet-backgrounds/ocean-observation.webp', swatch: '#ddf7f7' },
  { id: 'creative-notebook', name: '创意手账', description: '温暖、活泼', url: '/worksheet-backgrounds/creative-notebook.webp', swatch: '#fffaf0' },
  { id: 'dinosaur-archaeology', name: '恐龙考古', description: '发现、求知', url: '/worksheet-backgrounds/dinosaur-archaeology.webp', swatch: '#f8ead6' },
  { id: 'invention-workshop', name: '发明工坊', description: '动手、创造', url: '/worksheet-backgrounds/invention-workshop.webp', swatch: '#e4f3ef' },
  { id: 'music-rhythm', name: '音乐律动', description: '轻快、灵动', url: '/worksheet-backgrounds/music-rhythm.webp', swatch: '#f7eaf4' },
  { id: 'chinese-study', name: '国风书院', description: '雅致、从容', url: '/worksheet-backgrounds/chinese-study.webp', swatch: '#f6efe2' },
  { id: 'active-sports', name: '活力运动', description: '健康、朝气', url: '/worksheet-backgrounds/active-sports.webp', swatch: '#e2f6f5' },
] as const;

const VALID_THEMES = new Set<WorksheetBackgroundTheme>([
  ...WORKSHEET_BACKGROUND_OPTIONS.map(option => option.id),
  'custom',
]);

export function normalizeWorksheetBackgroundTheme(value: unknown): WorksheetBackgroundTheme {
  return typeof value === 'string' && VALID_THEMES.has(value as WorksheetBackgroundTheme)
    ? value as WorksheetBackgroundTheme
    : DEFAULT_WORKSHEET_BACKGROUND;
}

export function resolveWorksheetBackground(
  theme: WorksheetBackgroundTheme,
  customUrl: string | null,
): string | null {
  if (theme === 'custom') return customUrl;
  return WORKSHEET_BACKGROUND_OPTIONS.find(option => option.id === theme)?.url ?? null;
}
