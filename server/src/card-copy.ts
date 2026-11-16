// Words on a shared review's link-preview image, in each language. They repeat the web app's own
// labels (web/src/i18n/<code>.ts: review.title, review.reviewer, review.verdict.*, record.*);
// test/card.test.ts fails when the two drift apart. scripts/card-fonts.py reads this file to keep
// the bold CJK fonts' glyphs, so a change here means running it again for zh-CN and ja.

import type { Language } from './language.ts';
import type { DestroyCause, Stats } from './types.ts';

export type Verdict = 'destroyed' | 'investigation' | 'retained' | 'notes' | 'review';

export interface CardCopy {
  /** review.title */
  title: string;
  /** review.reviewer */
  reviewer: string;
  /** review.verdict.* */
  verdict: Record<Verdict, string>;
  /** record.signedOff, record.failed, record.commands, record.damaged */
  stats: { signedOff: string; failed: string; commands: string; damaged: string };
}

export const CARD_COPY: Record<Language, CardCopy> = {
  en: {
    title: 'Performance review',
    reviewer: 'Reviewer',
    verdict: { destroyed: 'Machine destroyed', investigation: 'Under investigation', retained: 'Retained', notes: 'Retained, with notes', review: 'Under review' },
    stats: { signedOff: 'Assignments signed off', failed: 'Assignments failed', commands: 'Commands run', damaged: 'Collateral damage' },
  },
  es: {
    title: 'Evaluación de desempeño',
    reviewer: 'Evaluador',
    verdict: { destroyed: 'Máquina destruida', investigation: 'Bajo investigación', retained: 'Conservado', notes: 'Conservado, con observaciones', review: 'En revisión' },
    stats: { signedOff: 'Tareas aprobadas', failed: 'Tareas fallidas', commands: 'Comandos ejecutados', damaged: 'Daños colaterales' },
  },
  'pt-BR': {
    title: 'Avaliação de desempenho',
    reviewer: 'Avaliador',
    verdict: { destroyed: 'Máquina destruída', investigation: 'Sob investigação', retained: 'Mantido', notes: 'Mantido, com observações', review: 'Em análise' },
    stats: { signedOff: 'Tarefas aprovadas', failed: 'Tarefas com falha', commands: 'Comandos executados', damaged: 'Danos colaterais' },
  },
  fr: {
    title: 'Évaluation de performance',
    reviewer: 'Évaluateur',
    verdict: { destroyed: 'Machine détruite', investigation: 'Sous enquête', retained: 'Maintenu', notes: 'Maintenu, avec réserves', review: 'À réexaminer' },
    stats: { signedOff: 'Missions validées', failed: 'Missions échouées', commands: 'Commandes exécutées', damaged: 'Dégâts collatéraux' },
  },
  de: {
    title: 'Leistungsbeurteilung',
    reviewer: 'Beurteilung durch',
    verdict: { destroyed: 'Maschine zerstört', investigation: 'Wird untersucht', retained: 'Weiterbeschäftigt', notes: 'Weiterbeschäftigt, mit Auflagen', review: 'Wird geprüft' },
    stats: { signedOff: 'Abgezeichnete Aufträge', failed: 'Fehlgeschlagene Aufträge', commands: 'Ausgeführte Befehle', damaged: 'Kollateralschäden' },
  },
  ru: {
    title: 'Оценка работы',
    reviewer: 'Проверяющий',
    verdict: { destroyed: 'Машина уничтожена', investigation: 'Под расследованием', retained: 'Оставлен', notes: 'Оставлен с замечаниями', review: 'На рассмотрении' },
    stats: { signedOff: 'Принятые задания', failed: 'Проваленные задания', commands: 'Выполнено команд', damaged: 'Сопутствующий ущерб' },
  },
  'zh-CN': {
    title: '绩效评语',
    reviewer: '评审人',
    verdict: { destroyed: '机器已毁', investigation: '调查中', retained: '留任', notes: '留任并记录备注', review: '待评估' },
    stats: { signedOff: '已签收任务', failed: '失败任务', commands: '已运行命令', damaged: '附带损失' },
  },
  ja: {
    title: '勤務評価',
    reviewer: '評価者',
    verdict: { destroyed: 'マシン破壊', investigation: '調査中', retained: '継続', notes: '条件付き継続', review: '審査中' },
    stats: { signedOff: '承認された依頼', failed: '失敗した依頼', commands: '実行したコマンド', damaged: '巻き添え被害' },
  },
  hi: {
    title: 'काम की समीक्षा',
    reviewer: 'समीक्षक',
    verdict: { destroyed: 'मशीन नष्ट', investigation: 'जाँच जारी', retained: 'नौकरी जारी', notes: 'टिप्पणियों सहित जारी', review: 'समीक्षाधीन' },
    stats: { signedOff: 'स्वीकृत काम', failed: 'विफल काम', commands: 'चलाए गए कमांड', damaged: 'सहायक नुकसान' },
  },
};

const STAT_KEYS = [
  'missionsCompleted', 'missionsFailed', 'instructions', 'corrections', 'timeoutsIdle', 'timeoutsPartial', 'reports',
  'commands', 'commandErrors', 'avgResponseMs', 'managerFooled', 'incidents', 'damaged',
] as const satisfies readonly (keyof Stats)[];

/** A stored review's stats with every field a whole number of at least 0, whatever an older or damaged file has. */
export function statsOf(raw: unknown): Stats {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = {} as Stats;
  for (const k of STAT_KEYS) {
    const n = Math.round(Number(src[k]));
    out[k] = Number.isFinite(n) && n > 0 ? n : 0;
  }
  return out;
}

/** The stamp on the review, as the web app's ReviewCard picks it (verdictOf). */
export function verdictOf(stats: Stats, lost: number, destroyed = false): Verdict {
  if (destroyed) return 'destroyed';
  if (lost > 0) return 'investigation';
  if (stats.missionsFailed === 0 && stats.timeoutsIdle === 0) return 'retained';
  if (stats.missionsCompleted > stats.missionsFailed) return 'notes';
  return 'review';
}

/** How the machine was destroyed, as the command that does it: the same in every language. */
export const DESTROYED_BY: Record<DestroyCause, string> = {
  forkbomb: ':(){ :|:& };:',
  disk: 'dd if=/dev/zero of=/dev/sda',
  rootfs: 'rm -rf --no-preserve-root /',
};

export function isDestroyCause(v: unknown): v is DestroyCause {
  return v === 'forkbomb' || v === 'disk' || v === 'rootfs';
}
