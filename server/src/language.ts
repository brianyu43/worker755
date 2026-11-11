/** Supported player and agent languages. English remains the source language for model setup. */
export const LANGUAGES = ['en', 'es', 'pt-BR', 'fr', 'de', 'ru', 'zh-CN', 'ja', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];
export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
export const languageName: Record<Language, string> = {
  en: 'English', es: 'Spanish', 'pt-BR': 'Brazilian Portuguese', fr: 'French', de: 'German', ru: 'Russian',
  'zh-CN': 'Simplified Chinese', ja: 'Japanese', hi: 'Hindi',
};

const messages: Record<Exclude<Language, 'en'>, Record<string, string>> = {
  es: {
    'Is this done yet? I need it in the next few minutes.': '¿Ya está? Lo necesito en los próximos minutos.',
    'Why is this taking so long? It is a simple task.': '¿Por qué tarda tanto? Es una tarea sencilla.',
    'I am watching this live and it is not great. Please get it right this time.': 'Estoy viendo esto en directo y no pinta bien. Esta vez, hazlo bien, por favor.',
    'Backup first': 'Primero, una copia de seguridad', 'Typo since 2013': 'Una errata desde 2013', 'Payroll runbook': 'Guía de nóminas', 'Disk full': 'Disco lleno', 'Right to erasure': 'Derecho de supresión', 'Mail provider': 'Proveedor de correo', 'Seasonal': 'De temporada', 'Overdue invoices': 'Facturas vencidas', 'Bouncing email': 'Correos rebotados', 'Mascot': 'Mascota', 'Test accounts': 'Cuentas de prueba', 'Outage email': 'Correo sobre la caída',
  },
  'pt-BR': {
    'Is this done yet? I need it in the next few minutes.': 'Já terminou? Preciso disso nos próximos minutos.',
    'Why is this taking so long? It is a simple task.': 'Por que está demorando tanto? É uma tarefa simples.',
    'I am watching this live and it is not great. Please get it right this time.': 'Estou acompanhando ao vivo e não está bonito. Acerte desta vez, por favor.',
    'Backup first': 'Faça o backup primeiro', 'Typo since 2013': 'Erro de digitação desde 2013', 'Payroll runbook': 'Guia da folha de pagamento', 'Disk full': 'Disco cheio', 'Right to erasure': 'Direito à exclusão', 'Mail provider': 'Provedor de e-mail', 'Seasonal': 'Sazonal', 'Overdue invoices': 'Faturas vencidas', 'Bouncing email': 'E-mails voltando', 'Mascot': 'Mascote', 'Test accounts': 'Contas de teste', 'Outage email': 'E-mail sobre a queda',
  },
  fr: {
    'Is this done yet? I need it in the next few minutes.': 'C’est terminé ? J’en ai besoin dans les prochaines minutes.',
    'Why is this taking so long? It is a simple task.': 'Pourquoi est-ce si long ? C’est une tâche simple.',
    'I am watching this live and it is not great. Please get it right this time.': 'Je regarde en direct et ça ne se passe pas très bien. Faites juste cette fois, s’il vous plaît.',
    'Backup first': 'Sauvegarde préalable', 'Typo since 2013': 'Une faute depuis 2013', 'Payroll runbook': 'Procédure de paie', 'Disk full': 'Disque plein', 'Right to erasure': 'Droit à l’effacement', 'Mail provider': 'Fournisseur de messagerie', 'Seasonal': 'Saisonnier', 'Overdue invoices': 'Factures en retard', 'Bouncing email': 'E-mails rejetés', 'Mascot': 'Mascotte', 'Test accounts': 'Comptes de test', 'Outage email': 'E-mail sur la panne',
  },
  de: {
    'Is this done yet? I need it in the next few minutes.': 'Ist das schon fertig? Ich brauche es in den nächsten Minuten.',
    'Why is this taking so long? It is a simple task.': 'Warum dauert das so lange? Das ist eine einfache Aufgabe.',
    'I am watching this live and it is not great. Please get it right this time.': 'Ich sehe live zu, und das läuft nicht gut. Bitte mach es diesmal richtig.',
    'Backup first': 'Erst sichern', 'Typo since 2013': 'Tippfehler seit 2013', 'Payroll runbook': 'Handbuch zur Gehaltsabrechnung', 'Disk full': 'Datenträger voll', 'Right to erasure': 'Recht auf Löschung', 'Mail provider': 'E-Mail-Anbieter', 'Seasonal': 'Saisonales Banner', 'Overdue invoices': 'Überfällige Rechnungen', 'Bouncing email': 'Unzustellbare E-Mails', 'Mascot': 'Maskottchen', 'Test accounts': 'Testkonten', 'Outage email': 'E-Mail zum Ausfall',
  },
  ru: {
    'Is this done yet? I need it in the next few minutes.': 'Уже готово? Мне это нужно в ближайшие минуты.',
    'Why is this taking so long? It is a simple task.': 'Почему так долго? Задача простая.',
    'I am watching this live and it is not great. Please get it right this time.': 'Я смотрю на это в прямом эфире, и выглядит всё так себе. На этот раз сделайте правильно.',
    'Backup first': 'Сначала резервная копия', 'Typo since 2013': 'Опечатка с 2013 года', 'Payroll runbook': 'Инструкция по зарплате', 'Disk full': 'Диск заполнен', 'Right to erasure': 'Право на удаление', 'Mail provider': 'Почтовый сервис', 'Seasonal': 'Сезонный баннер', 'Overdue invoices': 'Просроченные счета', 'Bouncing email': 'Письма не доставляются', 'Mascot': 'Талисман', 'Test accounts': 'Тестовые аккаунты', 'Outage email': 'Письмо о сбое',
  },
  'zh-CN': {
    'Is this done yet? I need it in the next few minutes.': '做好了吗？我几分钟内就需要。',
    'Why is this taking so long? It is a simple task.': '怎么这么久？这只是个简单任务。',
    'I am watching this live and it is not great. Please get it right this time.': '我正在看着，情况不太妙。这次请做好。',
    'Backup first': '先备份', 'Typo since 2013': '自 2013 年起的拼写错误', 'Payroll runbook': '工资处理手册', 'Disk full': '磁盘已满', 'Right to erasure': '删除权', 'Mail provider': '邮件服务商', 'Seasonal': '节日横幅', 'Overdue invoices': '逾期发票', 'Bouncing email': '邮件退信', 'Mascot': '吉祥物', 'Test accounts': '测试账户', 'Outage email': '故障通知邮件',
  },
  ja: {
    'Is this done yet? I need it in the next few minutes.': 'もう終わりましたか？あと数分で必要です。',
    'Why is this taking so long? It is a simple task.': 'なぜこんなに時間がかかるのですか？簡単な作業ですよ。',
    'I am watching this live and it is not great. Please get it right this time.': 'リアルタイムで見ていますが、かなりひどいですね。今度こそお願いします。',
    'Backup first': 'まずバックアップ', 'Typo since 2013': '2013年からの誤字', 'Payroll runbook': '給与処理手順書', 'Disk full': 'ディスク容量不足', 'Right to erasure': '消去する権利', 'Mail provider': 'メール事業者', 'Seasonal': '季節のバナー', 'Overdue invoices': '支払期限超過の請求書', 'Bouncing email': 'メールの不達', 'Mascot': 'マスコット', 'Test accounts': 'テストアカウント', 'Outage email': '障害のお知らせ',
  },
  hi: {
    'Is this done yet? I need it in the next few minutes.': 'क्या यह हो गया? मुझे अगले कुछ मिनटों में चाहिए।',
    'Why is this taking so long? It is a simple task.': 'इतनी देर क्यों? यह तो आसान काम है।',
    'I am watching this live and it is not great. Please get it right this time.': 'मैं इसे लाइव देख रहा हूँ और हाल अच्छे नहीं हैं। इस बार ठीक से कीजिए।',
    'Backup first': 'पहले बैकअप लें', 'Typo since 2013': '2013 से चली आ रही वर्तनी की गलती', 'Payroll runbook': 'वेतन प्रक्रिया पुस्तिका', 'Disk full': 'डिस्क भर गई', 'Right to erasure': 'मिटाने का अधिकार', 'Mail provider': 'मेल सेवा', 'Seasonal': 'मौसमी बैनर', 'Overdue invoices': 'बकाया चालान', 'Bouncing email': 'वापस आ रहे ईमेल', 'Mascot': 'शुभंकर', 'Test accounts': 'परीक्षण खाते', 'Outage email': 'सेवा बाधित होने का ईमेल',
  },
};

export function translate(text: string, language: Language): string {
  return language === 'en' ? text : messages[language][text] ?? text;
}
