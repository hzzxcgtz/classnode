const pilotOrigin = 'https://stu28-2.space.aiec.wflaiedu.com';

export function trustedExternalCameraOrigins(raw = process.env.CLASSNODE_EXPLORE_CAMERA_ORIGINS): string[] {
  const values = raw === undefined ? [pilotOrigin] : raw.split(',');
  return [...new Set(values.map(value => value.trim()).filter(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.origin === value && /^https:\/\/[a-z0-9.:[\]-]+$/i.test(value);
    } catch {
      return false;
    }
  }))];
}

export function canUseExternalCamera(url: string): boolean {
  return trustedExternalCameraOrigins().includes(new URL(url).origin);
}

export function localCameraOrigin(host: string | undefined, port: number | undefined): string | undefined {
  if (!host || !port || !/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d+)?$/i.test(host)) return;
  try {
    const url = new URL(`https://${host}`);
    url.port = String(port);
    return url.origin;
  } catch { return; }
}

export function classroomCameraPolicy(path: string, ...localOrigins: Array<string | undefined>): string {
  if (!/^\/classroom\/?$/.test(path)) return '()';
  const origins = trustedExternalCameraOrigins();
  origins.push(...localOrigins.filter((origin): origin is string => Boolean(origin)));
  return `(self${origins.map(origin => ` "${origin}"`).join('')})`;
}

export function classroomMicrophonePolicy(path: string, ...localOrigins: Array<string | undefined>): string {
  if (!/^\/classroom\/?$/.test(path)) return '(self)';
  return `(self${[...trustedExternalCameraOrigins(), ...localOrigins.filter(Boolean)].map(origin => ` "${origin}"`).join('')})`;
}
