import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ThemeName } from '@pointless/shared';

// Works from both src/ (tsx) and dist/ (compiled) — themes/ sits beside them.
const THEME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../themes');

export const THEMES: Record<ThemeName, { label: string; blurb: string }> = {
  boardroom: { label: 'Boardroom', blurb: 'Light, restrained, enterprise-friendly. The default.' },
  midnight: { label: 'Midnight', blurb: 'Dark, quiet, for low-light rooms.' },
};

export const DEFAULT_THEME: ThemeName = 'boardroom';

export function isTheme(name: string): name is ThemeName {
  return name in THEMES;
}

const cache = new Map<string, string>();

export function getThemeCss(theme: ThemeName): string {
  const hit = cache.get(theme);
  if (hit) return hit;
  const css =
    fs.readFileSync(path.join(THEME_DIR, `${theme}.css`), 'utf8') +
    '\n' +
    fs.readFileSync(path.join(THEME_DIR, 'base.css'), 'utf8');
  cache.set(theme, css);
  return css;
}

/** Every theme's tokens plus the base — lets one page render mixed-theme slides. */
export function getAllThemesCss(): string {
  const hit = cache.get('__all__');
  if (hit) return hit;
  const tokens = (Object.keys(THEMES) as ThemeName[])
    .map((t) => fs.readFileSync(path.join(THEME_DIR, `${t}.css`), 'utf8'))
    .join('\n');
  const css = tokens + '\n' + fs.readFileSync(path.join(THEME_DIR, 'base.css'), 'utf8');
  cache.set('__all__', css);
  return css;
}
