import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
// 开发使用 public，发行包使用已导出的 frontend；两端读取同一份步骤和实拍图。
export function ipadGuideDirectory(): string {
  const source = path.resolve(directory, '../../../public/guides/ipad-recording');
  return fs.existsSync(path.join(source, 'steps.json')) ? source : path.resolve(directory, '../../frontend/guides/ipad-recording');
}
type GuideStep = { title: string; text: string; note: string; images: { file: string; alt: string; caption: string }[] };
export function ipadGuideSteps(): GuideStep[] {
  return JSON.parse(fs.readFileSync(path.join(ipadGuideDirectory(), 'steps.json'), 'utf8')) as GuideStep[];
}
