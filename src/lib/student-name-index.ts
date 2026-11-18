import { pinyin } from 'pinyin-pro';

/** Name-only transliteration keeps surname readings (e.g. 单、曾、区) distinct. */
export function studentNameIndex(name: string) {
  const normalizedName = name.trim().normalize('NFKC').toLowerCase();
  const initials = /^[a-z\s.'-]+$/i.test(normalizedName)
    ? (normalizedName.match(/[a-z]+/g) ?? []).map(word => word[0]).join('').toUpperCase()
    : pinyin(normalizedName, { pattern: 'first', toneType: 'none', type: 'array', surname: 'head' })
    .flatMap(token => (token.match(/[a-z]+/gi) ?? []).map(word => word[0]))
    .join('').toUpperCase();
  return { normalizedName, initials, initial: /^[A-Z]/.test(initials) ? initials[0] : '#' };
}

export function matchesStudentName(index: ReturnType<typeof studentNameIndex>, query: string): boolean {
  const search = query.trim().normalize('NFKC').toLowerCase();
  return !search || index.normalizedName.includes(search)
    || (/^[a-z\s]+$/.test(search) && index.initials.includes(search.replace(/\s/g, '').toUpperCase()));
}
