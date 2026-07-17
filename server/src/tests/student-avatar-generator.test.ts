import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeSvg } from '../services/upload-security.js';
import {
  generateRandomStudentAvatar,
  generateRandomStudentAvatarByGender,
} from '../services/student-avatar-generator.js';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test('student avatar generator creates safe self-contained SVGs for both genders', () => {
  for (const gender of ['boy', 'girl'] as const) {
    for (let seed = 1; seed <= 100; seed++) {
      const avatar = generateRandomStudentAvatarByGender(gender, seededRandom(seed));
      assert.equal(avatar.gender, gender);
      assert.match(avatar.svgContent, /^<svg viewBox="0 0 64 64"/);
      assert.ok(avatar.svgContent.endsWith('</svg>'));
      assert.equal(sanitizeSvg(avatar.svgContent), avatar.svgContent);
      assert.doesNotMatch(avatar.svgContent, /(?:href\s*=|url\s*\(|data:|<script|<style)/i);
    }
  }
});

test('layer combinations provide a highly varied avatar pool', () => {
  const generated = new Set<string>();
  for (let seed = 1; seed <= 1000; seed++) {
    generated.add(generateRandomStudentAvatar(seededRandom(seed)).svgContent);
  }
  assert.ok(generated.size >= 990, `expected at least 990 unique avatars, got ${generated.size}`);
});
