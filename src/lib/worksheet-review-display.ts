/** Put consecutive numbered points on separate lines; leave prose, decimals and versions intact. */
export function formatReviewText(text: string): string {
  let previous = 0, family = '';
  return text.replace(/(^|[ \t\r\n;；,，。！？:：][ \t]*)(\d{1,2}[.、．)）]|[（(]\d{1,2}[)）]|第?[①-⑳](?:项|点|条)?|[一二三四五六七八九十]{1,3}[、．])/g,
    (matched, boundary: string, marker: string, offset: number) => {
      const following = text[offset + matched.length];
      if (/^\d+[.．]$/.test(marker) && /\d/.test(following ?? '')) return matched;
      const circle = marker.match(/[①-⑳]/)?.[0];
      // Standard references and quoted student answers belong to the surrounding prose.
      if (circle && (marker.startsWith('第') || /[项点条]$/.test(marker) || /^[ \t]*[“‘"'「『]/.test(text.slice(offset + matched.length)))) {
        if (family === 'circle') { previous = 0; family = ''; }
        return matched;
      }
      const chinese = marker.match(/^[一二三四五六七八九十]+/)?.[0];
      const currentFamily = circle ? 'circle' : chinese ? 'chinese' : /^[（(]/.test(marker) ? 'bracket' : 'digit';
      const chineseNumbers = ['','一','二','三','四','五','六','七','八','九','十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十'];
      const current = circle ? circle.charCodeAt(0) - '①'.charCodeAt(0) + 1 : chinese ? chineseNumbers.indexOf(chinese) : Number(marker.match(/\d+/)?.[0]);
      if (current === 1) {
        previous = 1; family = currentFamily;
        return /[:：,，]/.test(boundary) ? `${boundary}\n${marker}` : matched;
      }
      if (!previous || currentFamily !== family || current !== previous + 1) return matched;
      previous = current;
      const preserved = /[。！？\r\n]/.test(boundary) ? boundary : '';
      return `${preserved}${/[\r\n]/.test(boundary) ? '' : '\n'}${marker}`;
    });
}
export function formatReviewAdvice(text: string): string {
  return formatReviewText(text);
}
export function reviewDurationLabel(milliseconds: number | null | undefined): string | null {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function reviewSourceLabel(source: string): string {
  return source === 'teacher' ? '教师主动评分' : '学生自主评分';
}
