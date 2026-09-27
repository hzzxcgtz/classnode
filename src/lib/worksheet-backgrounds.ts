import type { WorksheetBackgroundTheme } from './types';

export interface WorksheetBackgroundOption {
  id: Exclude<WorksheetBackgroundTheme, 'custom'>;
  name: string;
  description: string;
  /** 横屏 / 桌面使用的 3:2 图片。保留 `url` 名称兼容既有调用方。 */
  url: string | null;
  /** iPad 竖屏使用的 3:4 图片；无背景选项为 null。 */
  portraitUrl: string | null;
  swatch: string;
}

export interface WorksheetBackgroundSources {
  landscape: string | null;
  portrait: string | null;
}

export const DEFAULT_WORKSHEET_BACKGROUND: WorksheetBackgroundTheme = 'cloud-playground';

export const WORKSHEET_BACKGROUND_OPTIONS: readonly WorksheetBackgroundOption[] = [
  { id: 'none', name: '清爽无图', description: '纯色底，最简洁', url: null, portraitUrl: null, swatch: '#f4f7fb' },
  { id: 'cloud-playground', name: '云朵操场', description: '明亮、轻松', url: '/worksheet-backgrounds/cloud-playground.webp', portraitUrl: '/worksheet-backgrounds/cloud-playground-portrait.webp', swatch: '#dff2ff' },
  { id: 'forest-explorer', name: '森林探险', description: '自然、好奇', url: '/worksheet-backgrounds/forest-explorer.webp', portraitUrl: '/worksheet-backgrounds/forest-explorer-portrait.webp', swatch: '#e9f4e6' },
  { id: 'space-discovery', name: '星际发现', description: '想象、探索', url: '/worksheet-backgrounds/space-discovery.webp', portraitUrl: '/worksheet-backgrounds/space-discovery-portrait.webp', swatch: '#eceeff' },
  { id: 'ocean-observation', name: '海底观察', description: '清新、安静', url: '/worksheet-backgrounds/ocean-observation.webp', portraitUrl: '/worksheet-backgrounds/ocean-observation-portrait.webp', swatch: '#ddf7f7' },
  { id: 'creative-notebook', name: '创意手账', description: '温暖、活泼', url: '/worksheet-backgrounds/creative-notebook.webp', portraitUrl: '/worksheet-backgrounds/creative-notebook-portrait.webp', swatch: '#fffaf0' },
  { id: 'dinosaur-archaeology', name: '恐龙考古', description: '发现、求知', url: '/worksheet-backgrounds/dinosaur-archaeology.webp', portraitUrl: '/worksheet-backgrounds/dinosaur-archaeology-portrait.webp', swatch: '#f8ead6' },
  { id: 'invention-workshop', name: '发明工坊', description: '动手、创造', url: '/worksheet-backgrounds/invention-workshop.webp', portraitUrl: '/worksheet-backgrounds/invention-workshop-portrait.webp', swatch: '#e4f3ef' },
  { id: 'music-rhythm', name: '音乐律动', description: '轻快、灵动', url: '/worksheet-backgrounds/music-rhythm.webp', portraitUrl: '/worksheet-backgrounds/music-rhythm-portrait.webp', swatch: '#f7eaf4' },
  { id: 'chinese-study', name: '国风书院', description: '雅致、从容', url: '/worksheet-backgrounds/chinese-study.webp', portraitUrl: '/worksheet-backgrounds/chinese-study-portrait.webp', swatch: '#f6efe2' },
  { id: 'active-sports', name: '活力运动', description: '健康、朝气', url: '/worksheet-backgrounds/active-sports.webp', portraitUrl: '/worksheet-backgrounds/active-sports-portrait.webp', swatch: '#e2f6f5' },
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

/** 同一主题的横竖两套资源。自定义竖图缺省时保留 null，让界面走“不裁切横图”的回退。 */
export function resolveWorksheetBackgroundSources(
  theme: WorksheetBackgroundTheme,
  customLandscapeUrl: string | null,
  customPortraitUrl: string | null,
): WorksheetBackgroundSources {
  if (theme === 'custom') {
    return { landscape: customLandscapeUrl, portrait: customPortraitUrl };
  }
  const option = WORKSHEET_BACKGROUND_OPTIONS.find(candidate => candidate.id === theme);
  return { landscape: option?.url ?? null, portrait: option?.portraitUrl ?? null };
}
