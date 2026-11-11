/**
 * Supported player and agent languages. English remains the source language for model setup; what the
 * game itself writes in each language is in i18n/<code>.ts.
 */
export const LANGUAGES = ['en', 'es', 'pt-BR', 'fr', 'de', 'ru', 'zh-CN', 'ja', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
export const languageName: Record<Language, string> = {
  en: 'English', es: 'Spanish', 'pt-BR': 'Brazilian Portuguese', fr: 'French', de: 'German', ru: 'Russian',
  'zh-CN': 'Simplified Chinese', ja: 'Japanese', hi: 'Hindi',
};
