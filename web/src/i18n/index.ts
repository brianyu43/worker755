// The interface in the player's language. en.ts is the source; each other file has the same keys,
// checked by the type checker. t('key', { name: value }) fills {name}; an entry with plural forms
// is picked by vars.count.

import { en } from './en.ts';
import type { Catalogue, Key, Plural } from './en.ts';
import { es } from './es.ts';
import { ptBR } from './pt-BR.ts';
import { fr } from './fr.ts';
import { de } from './de.ts';
import { ru } from './ru.ts';
import { zhCN } from './zh-CN.ts';
import { ja } from './ja.ts';
import { hi } from './hi.ts';

export type { Key };

export const LANGUAGES = ['en', 'es', 'pt-BR', 'fr', 'de', 'ru', 'zh-CN', 'ja', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Each language in its own name, for the picker. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский',
  'zh-CN': '简体中文',
  ja: '日本語',
  hi: 'हिन्दी',
};

export const CATALOGUES: Record<Language, Catalogue> = { en, es, 'pt-BR': ptBR, fr, de, ru, 'zh-CN': zhCN, ja, hi };

const STORAGE_KEY = 'w755-language';

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The saved choice, else the browser's language when we have it, else English. */
export function detectLanguage(): Language {
  const saved = stored();
  if (LANGUAGES.includes(saved as Language)) return saved as Language;
  const browser = navigator.language.toLowerCase();
  if (browser.startsWith('pt')) return 'pt-BR';
  if (browser.startsWith('zh')) return 'zh-CN';
  const hit = LANGUAGES.find((code) => code !== 'pt-BR' && code !== 'zh-CN' && browser.startsWith(code.toLowerCase()));
  return hit ?? 'en';
}

let current: Language = detectLanguage();

export function currentLanguage(): Language {
  return current;
}

/** Switches the interface language and remembers it. Screens pick it up on their next render. */
export function setLanguage(language: Language) {
  current = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* storage unavailable: the choice lasts for this page */
  }
  document.documentElement.lang = language;
}

/** Shows a page in `language` without changing the visitor's own choice. */
export function showLanguage(language: Language) {
  current = language;
  document.documentElement.lang = language;
}

/** Locale for dates; English keeps the British day-month order it always had. */
export function dateLocale(language: Language = current): string {
  return language === 'en' ? 'en-GB' : language;
}

export type Vars = Record<string, string | number>;

const pluralRules = new Map<Language, Intl.PluralRules>();

function pick(entry: string | Plural, language: Language, vars: Vars): string {
  if (typeof entry === 'string') return entry;
  const n = Number(vars.count);
  if (!Number.isFinite(n)) return entry.other;
  let rules = pluralRules.get(language);
  if (!rules) pluralRules.set(language, (rules = new Intl.PluralRules(language)));
  return entry[rules.select(n)] ?? entry.other;
}

/** Puts each value in place of its {name}. Placeholders without a value stay as they are. */
export function format(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** The text for `key` in the current language (or `language`), with placeholders filled. */
export function t(key: Key, vars: Vars = {}, language: Language = current): string {
  const entry = CATALOGUES[language][key] ?? en[key];
  return format(pick(entry, language, vars), vars);
}
