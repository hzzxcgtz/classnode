export type StudentAvatarGender = 'boy' | 'girl';

export interface GeneratedStudentAvatar {
  svgContent: string;
  gender: StudentAvatarGender;
}

type RandomSource = () => number;

const SKINS = [
  { base: '#FFE9D6', shade: '#E9BFA4', blush: '#FF9DA8' },
  { base: '#FFDCC2', shade: '#DFAF91', blush: '#FF8F9C' },
  { base: '#F4CBA8', shade: '#CC9878', blush: '#F7838F' },
  { base: '#DFA77F', shade: '#B97958', blush: '#EA7180' },
] as const;

const HAIRS = [
  { base: '#241B24', shine: '#554250' },
  { base: '#35231F', shine: '#735044' },
  { base: '#573B2E', shine: '#9B6A4E' },
  { base: '#7A5038', shine: '#C8895D' },
  { base: '#B2744D', shine: '#E0A373' },
  { base: '#263447', shine: '#536B83' },
  { base: '#513650', shine: '#8A5F83' },
] as const;

const THEMES = [
  { bg: '#DFF7F2', spot: '#76D8C5', shirt: '#38BFA7', trim: '#FFFFFF' },
  { bg: '#FFF0D6', spot: '#FFC869', shirt: '#FF9E57', trim: '#FFF9EF' },
  { bg: '#E8E4FF', spot: '#A99AF2', shirt: '#7567D8', trim: '#FFFFFF' },
  { bg: '#FFE5EC', spot: '#FF9CB5', shirt: '#F06287', trim: '#FFF7FA' },
  { bg: '#DDEFFF', spot: '#76B9F2', shirt: '#3C8DD9', trim: '#FFFFFF' },
  { bg: '#F2F7D8', spot: '#B4D55E', shirt: '#78AC45', trim: '#FFFFFF' },
  { bg: '#FFE3D8', spot: '#FF9D7B', shirt: '#E86F51', trim: '#FFF8F4' },
  { bg: '#E5F0FF', spot: '#8CAFF5', shirt: '#5278D7', trim: '#FFFFFF' },
] as const;

const ACCESSORY_COLORS = ['#FF6B8A', '#FFB52E', '#54C7C1', '#6C7FE8', '#A968D5', '#FFFFFF'];

function pick<T>(items: readonly T[], random: RandomSource): T {
  return items[Math.floor(random() * items.length)];
}

function chance(probability: number, random: RandomSource): boolean {
  return random() < probability;
}

function background(theme: typeof THEMES[number], variant: number): string {
  const base = `<rect width="64" height="64" rx="18" fill="${theme.bg}"/>`;
  switch (variant) {
    case 0:
      return `${base}<circle cx="9" cy="11" r="5" fill="${theme.spot}" opacity=".24"/><circle cx="55" cy="47" r="8" fill="${theme.spot}" opacity=".18"/><circle cx="51" cy="10" r="2" fill="${theme.spot}" opacity=".42"/>`;
    case 1:
      return `${base}<path d="M-5 51Q14 37 29 51T69 49V69H-5Z" fill="${theme.spot}" opacity=".18"/><path d="M4 15l2-4 2 4 4 2-4 2-2 4-2-4-4-2Z" fill="${theme.spot}" opacity=".38"/>`;
    case 2:
      return `${base}<path d="M8 8h10M13 3v10M50 48h8M54 44v8" stroke="${theme.spot}" stroke-width="2" stroke-linecap="round" opacity=".28"/><circle cx="8" cy="48" r="2" fill="${theme.spot}" opacity=".35"/>`;
    default:
      return `${base}<circle cx="32" cy="31" r="27" fill="${theme.spot}" opacity=".12"/><circle cx="32" cy="31" r="21" fill="#FFFFFF" opacity=".24"/>`;
  }
}

function outfit(theme: typeof THEMES[number], variant: number): string {
  const body = `<path d="M12 64v-6c0-8 8-13 20-13s20 5 20 13v6Z" fill="${theme.shirt}"/>`;
  switch (variant) {
    case 0:
      return `${body}<path d="M25 46l7 7 7-7" fill="none" stroke="${theme.trim}" stroke-width="3" stroke-linejoin="round"/>`;
    case 1:
      return `${body}<path d="M23 47l9 9 9-9" fill="${theme.trim}"/><path d="M28 53h8l-1 11h-6Z" fill="#F6C84C"/>`;
    case 2:
      return `${body}<path d="M18 51h28v13H18Z" fill="${theme.trim}" opacity=".18"/><path d="M20 54h24" stroke="${theme.trim}" stroke-width="2" opacity=".8"/>`;
    case 3:
      return `${body}<path d="M20 49q12 8 24 0v15H20Z" fill="${theme.trim}" opacity=".2"/><circle cx="32" cy="55" r="3" fill="${theme.trim}"/>`;
    default:
      return `${body}<path d="M17 54q15-10 30 0" fill="none" stroke="${theme.trim}" stroke-width="3"/><path d="M32 49v15" stroke="${theme.trim}" stroke-width="1.5" opacity=".7"/>`;
  }
}

function backHair(gender: StudentAvatarGender, style: number, hair: typeof HAIRS[number]): string {
  if (gender === 'girl') {
    switch (style) {
      case 2: return `<circle cx="11" cy="27" r="8" fill="${hair.base}"/><circle cx="53" cy="27" r="8" fill="${hair.base}"/>`;
      case 3: return `<path d="M13 25Q13 8 32 7t19 18v24q-7 6-13-1H26q-6 7-13 1Z" fill="${hair.base}"/>`;
      case 4: return `<path d="M44 12q13 0 12 12t-11 13q7-8-3-18Z" fill="${hair.base}"/><circle cx="47" cy="15" r="3" fill="${hair.shine}"/>`;
      case 5: return `<path d="M11 27Q11 8 32 7t21 20l-2 25-8-7H21l-8 7Z" fill="${hair.base}"/>`;
      case 6: return `<circle cx="17" cy="11" r="8" fill="${hair.base}"/><circle cx="47" cy="11" r="8" fill="${hair.base}"/>`;
      case 7: return `<path d="M12 23Q14 7 32 7t20 16v18q-5 8-12 3H24q-7 5-12-3Z" fill="${hair.base}"/>`;
      default: return `<path d="M13 25Q13 8 32 7t19 18v17q-5 6-10 1H23q-5 5-10-1Z" fill="${hair.base}"/>`;
    }
  }
  if (style === 6) return `<path d="M13 26Q13 8 32 8t19 18v9H13Z" fill="${hair.base}"/>`;
  return '';
}

function frontHair(gender: StudentAvatarGender, style: number, hair: typeof HAIRS[number]): string {
  if (gender === 'boy') {
    switch (style) {
      case 0: return `<path d="M13 25Q12 8 32 7t20 18q-6-7-12-9l-4 8-4-8-6 8-5-7q-5 3-8 8Z" fill="${hair.base}"/><path d="M19 13q10-7 21 0" fill="none" stroke="${hair.shine}" stroke-width="3" stroke-linecap="round" opacity=".45"/>`;
      case 1: return `<path d="M12 25Q13 7 32 7t20 18q-5-8-12-9-8-2-16 1-7 2-12 8Z" fill="${hair.base}"/><path d="M17 15q12-8 25-1" fill="none" stroke="${hair.shine}" stroke-width="3" stroke-linecap="round" opacity=".35"/>`;
      case 2: return `<path d="M13 26Q11 8 31 7q15-1 21 13-13-7-27 2l-4-7q-5 4-8 11Z" fill="${hair.base}"/><path d="M21 12q14-5 25 3" fill="none" stroke="${hair.shine}" stroke-width="3" stroke-linecap="round" opacity=".4"/>`;
      case 3: return `<path d="M13 23Q15 8 32 8t19 15q-9-6-19-6t-19 6Z" fill="${hair.base}"/><path d="M17 15l3-5 4 4 4-6 4 6 5-6 3 6 5-3 2 6" fill="none" stroke="${hair.shine}" stroke-width="2" stroke-linecap="round" opacity=".45"/>`;
      case 4: return `<path d="M12 26Q13 8 31 8q12 0 19 9-12-4-21 2l-6 6-3-8q-5 3-8 9Z" fill="${hair.base}"/><path d="M19 13q14-7 26 2" fill="none" stroke="${hair.shine}" stroke-width="3" stroke-linecap="round" opacity=".4"/>`;
      case 5: return `<path d="M13 24Q14 9 32 8t19 16q-7-5-13-6l-3 6-4-6-5 6-4-6q-5 1-9 6Z" fill="${hair.base}"/>`;
      case 6: return `<path d="M12 25Q12 7 32 7t20 18q-8-8-20-8t-20 8Z" fill="${hair.base}"/><path d="M15 17q17-10 34 0" fill="none" stroke="${hair.shine}" stroke-width="3" opacity=".42"/>`;
      default: return `<path d="M12 24Q15 8 32 8t20 16q-6-6-11-7l-4 7-6-7-5 6-5-6q-5 2-9 7Z" fill="${hair.base}"/>`;
    }
  }

  switch (style) {
    case 0: return `<path d="M12 25Q12 7 32 6t20 19q-7-8-13-9l-3 8-5-8-5 8-4-7q-6 2-10 8Z" fill="${hair.base}"/><path d="M18 13q13-8 27 1" fill="none" stroke="${hair.shine}" stroke-width="3" opacity=".38" stroke-linecap="round"/>`;
    case 1: return `<path d="M12 26Q12 6 32 6t20 20q-6-9-13-10-9 5-19 6-5 0-8 4Z" fill="${hair.base}"/><path d="M18 13q14-8 27 1" fill="none" stroke="${hair.shine}" stroke-width="3" opacity=".38" stroke-linecap="round"/>`;
    case 2: return `<path d="M12 24Q13 7 32 7t20 17q-7-8-20-8t-20 8Z" fill="${hair.base}"/><path d="M13 20q19-9 38 0" fill="none" stroke="${hair.shine}" stroke-width="2.5" opacity=".35"/>`;
    case 3: return `<path d="M12 26Q12 6 32 6t20 20q-7-9-14-10l-4 9-5-9-4 8-5-7q-5 2-8 9Z" fill="${hair.base}"/>`;
    case 4: return `<path d="M12 25Q13 7 32 7t20 18q-7-8-16-9-7 5-16 6-5 0-8 3Z" fill="${hair.base}"/>`;
    case 5: return `<path d="M12 25Q12 7 32 6t20 19q-6-7-12-9l-5 8-4-8-5 8-4-7q-6 2-10 8Z" fill="${hair.base}"/>`;
    case 6: return `<path d="M12 24Q14 7 32 7t20 17q-7-7-20-7t-20 7Z" fill="${hair.base}"/><path d="M17 14q15-8 29 1" fill="none" stroke="${hair.shine}" stroke-width="3" opacity=".4"/>`;
    case 7: return `<path d="M12 26Q11 7 31 6q15 0 21 14-13-7-27 2l-5-6q-5 4-8 10Z" fill="${hair.base}"/>`;
    default: return `<path d="M12 25Q12 7 32 7t20 18q-6-8-13-9l-3 8-5-8-5 8-4-7q-6 2-10 8Z" fill="${hair.base}"/>`;
  }
}

function faceShape(skin: typeof SKINS[number], variant: number): string {
  const shapes = [
    `<path d="M14 25Q14 12 32 12t18 13v8q0 17-18 19Q14 50 14 33Z" fill="${skin.base}"/>`,
    `<path d="M14 25Q15 11 32 11t18 14v9q0 16-18 18-18-2-18-18Z" fill="${skin.base}"/>`,
    `<path d="M13 26Q14 12 32 12t19 14v7q-2 17-19 19-17-2-19-19Z" fill="${skin.base}"/>`,
  ];
  return `<ellipse cx="13.5" cy="31" rx="3.3" ry="5" fill="${skin.base}"/><ellipse cx="50.5" cy="31" rx="3.3" ry="5" fill="${skin.base}"/>${shapes[variant]}`;
}

function eyes(variant: number): string {
  switch (variant) {
    case 0: return `<g fill="#302D3B"><circle cx="24" cy="31" r="3.1"/><circle cx="40" cy="31" r="3.1"/></g><g fill="#FFF"><circle cx="23" cy="29.9" r="1.15"/><circle cx="39" cy="29.9" r="1.15"/><circle cx="25" cy="32" r=".55"/><circle cx="41" cy="32" r=".55"/></g>`;
    case 1: return `<g fill="#302D3B"><ellipse cx="24" cy="31" rx="2.4" ry="3.2"/><ellipse cx="40" cy="31" rx="2.4" ry="3.2"/></g><g fill="#FFF"><circle cx="23.3" cy="29.8" r=".9"/><circle cx="39.3" cy="29.8" r=".9"/></g>`;
    case 2: return `<path d="M20.5 31q3.5-4 7 0" fill="none" stroke="#302D3B" stroke-width="2.2" stroke-linecap="round"/><circle cx="40" cy="31" r="3" fill="#302D3B"/><circle cx="39" cy="30" r="1" fill="#FFF"/>`;
    case 3: return `<path d="M20.5 31q3.5 4 7 0M36.5 31q3.5 4 7 0" fill="none" stroke="#302D3B" stroke-width="2.2" stroke-linecap="round"/>`;
    case 4: return `<g fill="#302D3B"><circle cx="24" cy="31" r="2.7"/><circle cx="40" cy="31" r="2.7"/></g><path d="M22.5 29.8l1-1 1 1M38.5 29.8l1-1 1 1" fill="none" stroke="#FFF" stroke-width=".8" stroke-linecap="round"/>`;
    default: return `<path d="M20.5 30q3.5-3 7 0M36.5 30q3.5-3 7 0" fill="none" stroke="#302D3B" stroke-width="2.1" stroke-linecap="round"/><circle cx="24" cy="31" r="1.5" fill="#302D3B"/><circle cx="40" cy="31" r="1.5" fill="#302D3B"/>`;
  }
}

function mouth(variant: number): string {
  switch (variant) {
    case 0: return `<path d="M28 40q4 4 8 0" fill="none" stroke="#C65366" stroke-width="1.8" stroke-linecap="round"/>`;
    case 1: return `<path d="M28 40q4 6 8 0Z" fill="#9E3E55"/><path d="M30 43q2-2 4 0" fill="#FF8FA3"/>`;
    case 2: return `<path d="M29 40q3 3 6 0" fill="none" stroke="#C65366" stroke-width="1.8" stroke-linecap="round"/><circle cx="37" cy="40" r=".8" fill="#C65366"/>`;
    case 3: return `<ellipse cx="32" cy="41" rx="2.3" ry="2.8" fill="#9E3E55"/><ellipse cx="32" cy="42.5" rx="1.3" ry=".7" fill="#FF8FA3"/>`;
    default: return `<path d="M28 40q4 4 8 0" fill="#FFFFFF" stroke="#C65366" stroke-width="1.4" stroke-linejoin="round"/>`;
  }
}

function accessories(gender: StudentAvatarGender, kind: number, color: string): string {
  switch (kind) {
    case 1: return `<g fill="none" stroke="#465066" stroke-width="1.5"><rect x="18.5" y="27.5" width="10" height="7" rx="3"/><rect x="35.5" y="27.5" width="10" height="7" rx="3"/><path d="M28.5 30.5h7M18.5 30l-4-1M45.5 30l4-1"/></g>`;
    case 2: return `<path d="M14 24q-1-14 18-15 19 1 18 15" fill="none" stroke="${color}" stroke-width="3"/><rect x="10" y="24" width="5" height="12" rx="2.5" fill="${color}"/><rect x="49" y="24" width="5" height="12" rx="2.5" fill="${color}"/>`;
    case 3: return `<path d="M16 16q5-9 16-9t16 9" fill="${color}"/><path d="M14 17q18-5 36 0" fill="none" stroke="#FFFFFF" stroke-width="2" opacity=".75"/>`;
    case 4: return gender === 'girl'
      ? `<path d="M46 13q-6-6-9 1 3 7 9 1 6 6 9-1-3-7-9-1Z" fill="${color}"/><circle cx="46" cy="14" r="2" fill="#FFFFFF" opacity=".75"/>`
      : `<path d="M43 13l3-5 2 4 5-1-2 5 3 4-5 1-3 4-2-5-5-2 4-3Z" fill="${color}"/>`;
    case 5: return `<circle cx="17" cy="42" r="1.8" fill="${color}"/><circle cx="47" cy="42" r="1.8" fill="${color}"/><path d="M15 45q2 3 4 0M45 45q2 3 4 0" fill="none" stroke="${color}" stroke-width="1"/>`;
    default: return '';
  }
}

/**
 * Generates a layered, self-contained SVG avatar. Passing a random source makes
 * the generator deterministic in tests while production continues to use Math.random.
 */
export function generateRandomStudentAvatarByGender(
  gender: StudentAvatarGender,
  random: RandomSource = Math.random,
): GeneratedStudentAvatar {
  const skin = pick(SKINS, random);
  const hair = pick(HAIRS, random);
  const theme = pick(THEMES, random);
  const hairStyle = Math.floor(random() * 8);
  const faceVariant = Math.floor(random() * 3);
  const eyeVariant = Math.floor(random() * 6);
  const mouthVariant = Math.floor(random() * 5);
  const accessoryKind = chance(0.55, random) ? 1 + Math.floor(random() * 5) : 0;
  const accessoryColor = pick(ACCESSORY_COLORS, random);

  let svg = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="可爱学生头像">`;
  svg += background(theme, Math.floor(random() * 4));
  svg += outfit(theme, Math.floor(random() * 5));
  svg += backHair(gender, hairStyle, hair);
  svg += faceShape(skin, faceVariant);
  svg += `<ellipse cx="19" cy="37" rx="4" ry="2.1" fill="${skin.blush}" opacity=".42"/><ellipse cx="45" cy="37" rx="4" ry="2.1" fill="${skin.blush}" opacity=".42"/>`;
  svg += `<path d="M20.5 26.5q3.5-2 7 0M36.5 26.5q3.5-2 7 0" fill="none" stroke="${hair.base}" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>`;
  svg += eyes(eyeVariant);
  svg += `<path d="M31 35.5q1 1 2 0" fill="none" stroke="${skin.shade}" stroke-width="1.1" stroke-linecap="round" opacity=".7"/>`;
  svg += mouth(mouthVariant);
  if (chance(0.22, random)) svg += `<path d="M18 34l-1 1m3-1-1 1M44 34l1 1m-3-1 1 1" stroke="${skin.shade}" stroke-width=".8" stroke-linecap="round" opacity=".55"/>`;
  svg += frontHair(gender, hairStyle, hair);
  svg += accessories(gender, accessoryKind, accessoryColor);
  svg += `</svg>`;
  return { svgContent: svg, gender };
}

export function generateRandomStudentAvatar(random: RandomSource = Math.random): GeneratedStudentAvatar {
  return generateRandomStudentAvatarByGender(random() < 0.5 ? 'boy' : 'girl', random);
}
