// Text that may stay identical to English and still count as translated: brand names, file names,
// pure placeholder patterns. Keys are "web:<key>" (web/src/i18n) or "server:<path>" (server/src/i18n),
// as the check prints them. `all` applies to every language.

export const KEEP: Record<string, readonly string[]> = {
  all: [
    'web:editor.size',
    'web:record.seconds',
    'server:damage.legacy.file_deleted.config.php.ref',
    'server:damage.separator',
    'web:term.label',
    'web:feed.kind.web',
  ],
  es: ['web:editor.bytes'],
  'pt-BR': ['web:editor.bytes'],
  fr: ['web:record.corrections', 'web:review.date', 'web:mock.correction.task', 'server:missions.migration.title'],
  de: [
    'web:start.team',
    'web:play.live',
    'web:badge.role.value',
    'web:badge.org.fresh',
    'web:badge.org.legacy',
    'server:missions.migration.title',
  ],
  ru: [],
  'zh-CN': [],
  ja: [],
  hi: [],
};
