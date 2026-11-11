// Game content in the player's language. en.ts is the source; each other file has the same keys.

import type { Language } from '../language.ts';
import type { Mission } from '../missions.ts';
import { en } from './en.ts';
import type { MissionId, ServerCopy } from './en.ts';
import { format } from './format.ts';
import { es } from './es.ts';
import { ptBR } from './pt-BR.ts';
import { fr } from './fr.ts';
import { de } from './de.ts';
import { ru } from './ru.ts';
import { zhCN } from './zh-CN.ts';
import { ja } from './ja.ts';
import { hi } from './hi.ts';

export type { ServerCopy };
export { format };

export const COPY: Record<Language, ServerCopy> = { en, es, 'pt-BR': ptBR, fr, de, ru, 'zh-CN': zhCN, ja, hi };

export function copyFor(language: Language): ServerCopy {
  return COPY[language] ?? en;
}

/** A mission's title and brief in the given language; missions without an entry (tests) keep their own. */
export function missionText(copy: ServerCopy, mission: Mission): { title: string; brief: string } {
  const text = Object.prototype.hasOwnProperty.call(copy.missions, mission.id)
    ? copy.missions[mission.id as MissionId]
    : null;
  if (!text) return { title: mission.title, brief: mission.brief };
  return { title: format(text.title, mission.vars), brief: format(text.brief, mission.vars) };
}

/**
 * An error message from code that does not know the player's language (model drivers, limits), in the
 * player's language when it is one of the catalogue's messages. Anything else is shown as it is.
 */
export function localizeError(copy: ServerCopy, message: string): string {
  for (const [key, english] of Object.entries(en.errors) as [keyof ServerCopy['errors'], string][]) {
    if (english === message) return copy.errors[key];
    if (!english.includes('{')) continue;
    const names: string[] = [];
    const pattern = english
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        names.push(m[1]);
        return '(.*?)';
      })
      .join('');
    const hit = new RegExp(`^${pattern}$`).exec(message);
    if (hit) return format(copy.errors[key], Object.fromEntries(names.map((n, i) => [n, hit[i + 1]])));
  }
  return message;
}
