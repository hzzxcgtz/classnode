export function externalWebappHref(value: string | null | undefined): string | null {
  if (!value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const text = value.trim();
  if (!/^https:\/\//i.test(text) || text.includes('\\')) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
