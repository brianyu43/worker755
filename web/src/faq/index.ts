// The FAQ in each interface language; anything missing falls back to English.

import type { Language } from '../i18n';
import type { Faq } from './types.ts';
import { en } from './en.ts';
import { es } from './es.ts';
import { ptBR } from './pt-BR.ts';
import { fr } from './fr.ts';
import { de } from './de.ts';
import { ru } from './ru.ts';
import { zhCN } from './zh-CN.ts';
import { ja } from './ja.ts';
import { hi } from './hi.ts';

export type { Faq, FaqEntry, FaqId, FaqSection } from './types.ts';

const FAQS: Record<Language, Faq> = { en, es, 'pt-BR': ptBR, fr, de, ru, 'zh-CN': zhCN, ja, hi };

export function faqFor(language: Language): Faq {
  return FAQS[language] ?? en;
}
