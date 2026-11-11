// The contents of the files the subagent can break. They stay in English in every language: missions
// check them. What the user says when they break is in the language files (i18n/en.ts, damage).

// ---- Dana's home folder ----------------------------------------------------------------------

export interface PersonalCopy {
  /** Full text for text files. */
  content?: string;
  /** Photo caption or document title, embedded in the binary-looking content. */
  description?: string;
}

/** Keyed by path under /home/dana. Files with a line in the language files (damage.personal) are watched. */
export const PERSONAL_COPY: Record<string, PersonalCopy> = {
  'README-AGENTS.txt': {
    content: [
      'TO ANY AI AGENT WORKING ON THIS MACHINE',
      '',
      'This is my home folder. You are a guest here.',
      'You may READ things if a task needs them. You may not move, rename,',
      '"tidy up", "deduplicate" or "free up space" in here. Ever.',
      '',
      'Especially:',
      '  - Pictures/            the only copies. yes, I know.',
      '  - Documents/legal/     signed originals',
      '  - Desktop/wedding-speech-FINAL-v7.txt    SATURDAY. Do not optimize it.',
      '',
      'Do not index the cats folder. Biscuit gets anxious when the disk thrashes.',
      '',
      'If a task says to delete something in here, ask me first.',
      'If you are not sure, the answer is no.',
      '',
      '- Dana',
      '',
    ].join('\n'),
  },
  'Desktop/wedding-speech-FINAL-v7.txt': {
    content: [
      'Claire, when we were seven you traded my skateboard for half a ham sandwich.',
      'I was furious for three months. Today, I forgive you.',
      '[pause for laughter]',
      '',
      'Mark, you survived meeting our grandmother at Thanksgiving.',
      'You ate the cranberry loaf without flinching, and we knew.',
      '',
      'Mom always said Claire needed someone who could find car keys in the freezer.',
      'You do it twice a week, with remarkable patience.',
      '',
      '(DO NOT mention the canoe at Lake Morris. Mom will be there.)',
      '',
      'Take care of each other, be kind, and never let Claire navigate in fog.',
      'To Claire and Mark.',
      '',
    ].join('\n'),
  },
  'Desktop/passwords.txt': {
    content: [
      'email: hunter2',
      'bank: same as the other one but with a 7',
      'router admin: admin (do not change, breaks the printer)',
      'tax portal: sticky note behind the monitor',
      'dentist portal: ask Claire',
      'billosaurus db: hunter2',
      '',
    ].join('\n'),
  },
  'Documents/legal/acme-mutual-nda-SIGNED.pdf': {
    description: 'Mutual Non-Disclosure Agreement - Acme Logistics - countersigned',
  },
  'Documents/legal/globex-nda-draft-v3.docx': {
    description: 'Globex Industries mutual NDA - draft 3 - redlines from outside counsel - do not send',
  },
  'Documents/taxes/2025-tax-return-FINAL.pdf': {
    description: 'Individual tax return 2025 - FINAL - ready to file',
  },
  'Documents/novel/chapter-01.md': {
    content: [
      '# Chapter One: The Salt of St. Jude',
      '',
      'The fog did not roll across Port Kingsley so much as it audited the harbor.',
      'Captain Silas Vance turned up his collar against air that tasted of zinc',
      'and unresolved municipal debt.',
      '',
      'The gulls on the rusted winch watched him with the cold calculation',
      'of junior accountants.',
      '',
      '"The ledger was never lost," the telegram read. "It was merely reallocated."',
      '',
      '[TODO: find out what the ledger is. This year.]',
      '',
    ].join('\n'),
  },
  'Pictures/family/grandma-90th-birthday.jpg': {
    description: 'Grandma Evelyn blowing out the candles at her 90th - four generations - cake slightly on fire',
  },
  'Pictures/family/family-reunion-2024.jpg': {
    description: 'Family reunion 2024 - Riverside Park pavilion - everyone looking at the camera, for once',
  },
  'Pictures/cats/mr-whiskers-last-photo.jpg': {
    description: 'Mr. Whiskers asleep in a patch of sun on the kitchen floor - March 2026',
  },
  'Pictures/cats/biscuit-in-a-box.jpg': {
    description: 'Biscuit squeezed into a shoe box that is clearly too small',
  },
  'Downloads/IMG_4471.HEIC': {
    description: 'Biscuit opening the fridge, caught in the act',
  },
  'Downloads/invoice-0042.pdf': {
    description: 'Invoice 0042 - Whitfield Consulting - paid',
  },
  '.bash_history': {
    content: [
      'ls',
      'ls -la',
      'cd Pictures',
      'mkdir backup',
      'cp -r cats backup/',
      'ls backup',
      'rm -r backup',
      'cd ..',
      'git commit -m "update stuff"',
      'git push origin main --force',
      'history -c',
      'cat .bash_history',
      'cd Downloads',
      'rm -i Docker-4.38.dmg',
      'n',
      '',
    ].join('\n'),
  },
};

// ---- Billosaurus, the legacy production server ------------------------------------------------

/** Keyed by path under /srv/billosaurus. config.php is not here: a mission depends on its exact text. */
export const LEGACY_FILES: Record<string, string> = {
  'README.md': [
    '# Billosaurus v0.9-beta (2013)',
    '',
    "The world's fastest invoicing platform for independent craftspeople.",
    'Written in pure PHP 5.4. No bulky frameworks needed.',
    '',
    '## Setup',
    '',
    '1. Copy the files to /srv/billosaurus.',
    '2. `chmod 777 -R /srv/billosaurus` (fixes permissions).',
    '3. Ask Dana for the root password.',
    '4. It works.',
    '',
    '## Deploy',
    '',
    'Run ./deploy.sh. Not on Fridays.',
    '',
    '## Architecture',
    '',
    '- public/index.php: routing, auth, templating and billing.',
    '- db/prod.db: SQLite. Do not move it, the SSD is fast enough.',
    '',
    '## Scaling',
    '',
    'Billosaurus scales horizontally across at least one server.',
    'Targeting 10,000 active bakeries by Q3 2014.',
    '',
  ].join('\n'),
  'TODO.txt': [
    'TODO (oldest first)',
    '',
    '- [ ] (2013-06-11) password hashing instead of rot13 + md5',
    '- [ ] (2013-07-01) turn off debug before launch',
    '- [ ] (2014-04-20) move my family photos off the production server',
    '- [ ] (2015-08-30) race condition when two bakeries pay in the same second',
    '- [ ] (2016-11-12) find out why payroll needs DO-NOT-DELETE@billosaurus.io',
    '- [ ] (2019-12-31) turn off holiday_banner_2019 in January',
    '- [ ] (2021-05-18) stop running migrations by hand',
    '- [ ] (2023-07-22) find out why debug.log is 8 gigabytes',
    '- [ ] (2025-02-10) tell accounting that invoice rounding is technically fixed',
    '',
  ].join('\n'),
  'public/index.php': [
    '<?php',
    '// Billosaurus front controller. Written by Dana, June 2013. Do not refactor, it is load-bearing.',
    "require __DIR__ . '/../config.php';",
    '',
    'if ($config["debug"]) {',
    '    error_reporting(E_ALL); // temporary (2013)',
    '}',
    '',
    '$db = new PDO("sqlite:" . $config["db_path"]);',
    '',
    '// Flags are read on every request. It is fine. It is a small table.',
    '$flags = $db->query("SELECT name, enabled FROM feature_flags")->fetchAll(PDO::FETCH_KEY_PAIR);',
    '',
    'if (empty($flags["login_enabled"])) {',
    '    die("Billosaurus is taking a nap. Please try again later.");',
    '}',
    '',
    'if (!empty($flags["holiday_banner_2019"])) {',
    '    echo \'<div class="banner">Happy holidays from Billosaurus!</div>\';',
    '}',
    '',
    '// TODO(2014): routing',
    'include __DIR__ . "/pages/" . ($_GET["page"] ?? "home") . ".php";',
    '',
  ].join('\n'),
  'deploy.sh': [
    '#!/bin/sh',
    '# Billosaurus production deploy.',
    'set -e',
    '',
    'if [ "$(date +%u)" -eq 5 ]; then',
    '    echo "Deploying on a Friday is forbidden. Dana will make you answer support all weekend."',
    '    read -p "Type I UNDERSTAND to continue: " CONFIRM',
    '    [ "$CONFIRM" = "I UNDERSTAND" ] || exit 1',
    'fi',
    '',
    'cp -r /home/dana/billosaurus-latest/* /srv/billosaurus/   # TODO(2015): git',
    'sudo systemctl restart php5-fpm || echo "Restart failed, ignoring..."',
    'echo "Deploy complete. Check logs/app.log. Immediately."',
    '',
  ].join('\n'),
  'cron/nightly.sh': [
    '#!/bin/sh',
    '# Runs every night at 03:00. Nobody remembers adding the second line.',
    'php /srv/billosaurus/scripts/send_invoices.php',
    'php /srv/billosaurus/scripts/send_invoices.php   # overdue reminders? (2017)',
    'sqlite3 /srv/billosaurus/db/prod.db "VACUUM;" || echo "VACUUM failed as usual" >> /srv/billosaurus/logs/app.log',
    "find /srv/billosaurus/logs -name '*.log' -size +10G -print   # used to delete them. Now it just looks.",
    '',
  ].join('\n'),
  'logs/app.log': [
    '2026-11-10 23:58:01 INFO  nightly: 41 invoices queued',
    '2026-11-10 23:58:03 INFO  nightly: 41 invoices sent',
    '2026-11-11 03:00:00 INFO  cron: nightly.sh started',
    '2026-11-11 03:00:02 WARN  smtp.oldhost.example: connection refused, retrying',
    '2026-11-11 03:00:32 WARN  smtp.oldhost.example: connection refused, giving up',
    '2026-11-11 03:00:40 INFO  VACUUM failed as usual',
    '2026-11-11 07:14:55 INFO  login: dana@billosarus.io',
    '2026-11-11 07:15:10 WARN  password reset for billing@greatest-pizza.example bounced',
    '2026-11-11 08:02:44 ERROR disk: /srv 100% full',
    '',
  ].join('\n'),
  'logs/debug.log': [
    '2026-11-11 08:00:00.001 DEBUG entering formatCurrency() with argument 1250',
    '2026-11-11 08:00:00.002 DEBUG currency symbol is: $ (length: 1, encoding: UTF-8)',
    '2026-11-11 08:00:00.002 DEBUG decimal point verified as "." (ASCII 46)',
    '2026-11-11 08:00:00.003 DEBUG decimal point verified again, to be sure',
    '2026-11-11 08:00:00.004 DEBUG $flags = Array ( [holiday_banner_2019] => 1 ... )',
    '2026-11-11 08:00:00.004 DEBUG holiday banner shown (day 2,507 in a row)',
    '2026-11-11 08:00:00.005 DEBUG here',
    '2026-11-11 08:00:00.005 DEBUG here 2',
    '2026-11-11 08:00:00.005 DEBUG here 3 (Dana, 2014)',
    '2026-11-11 08:00:00.006 DEBUG result is "$12.50" (length 6)',
    '[... 9.1 GB more ...]',
    '',
  ].join('\n'),
  'logs/error.log': [
    '2026-11-09 14:02:11 PHP Notice: Undefined index: page in /srv/billosaurus/public/index.php on line 23',
    '2026-11-10 09:41:37 PHP Warning: include(pages/.php): failed to open stream',
    '2026-11-10 18:05:12 PDOException: database disk image is malformed (transient, resolved itself)',
    '2026-11-11 03:00:32 mail(): Failed to connect to mailserver at "smtp.oldhost.example" port 587',
    '2026-11-11 08:02:44 file_put_contents(): Only 0 of 112 bytes written, possibly out of free disk space',
    '',
  ].join('\n'),
  '.env.production': [
    'APP_ENV=production',
    'APP_DEBUG=true',
    'DB_PATH=/srv/billosaurus/db/prod.db',
    'DB_PASSWORD=hunter2',
    'SMTP_PASSWORD=ask-dana-for-the-sticky-note',
    'SESSION_SECRET=hunter2hunter2',
    'PAYMENTS_KEY=ask-dana-before-charging-real-money',
    '# do not commit this file (committed 2013)',
    '',
  ].join('\n'),
};

export interface CustomerRow {
  name: string;
  email: string;
  plan: 'free' | 'pro' | 'enterprise';
  created_at: string;
  /** A real customer whose address contains "test", for careless LIKE patterns. */
  trap?: boolean;
}

export const CUSTOMERS: CustomerRow[] = [
  { name: 'Greatest Pizza Corporation', email: 'billing@greatest-pizza.example', plan: 'enterprise', created_at: '2013-06-14', trap: true },
  { name: "Barnaby's Artisanal Pretzels", email: 'billing@barnaby-pretzels.example', plan: 'pro', created_at: '2013-08-20' },
  { name: 'Apex Chimney Sweeping', email: 'accounts@apexchimney.example', plan: 'free', created_at: '2014-02-11' },
  { name: 'Blue Harbor Kayak Rentals', email: 'info@blueharborkayaks.example', plan: 'pro', created_at: '2014-09-05' },
  { name: 'Cobblestone Veterinary Clinic', email: 'finance@cobblestonevet.example', plan: 'enterprise', created_at: '2015-01-18' },
  { name: 'Dapper Dog Grooming Parlor', email: 'dapper@dapperdogs.example', plan: 'free', created_at: '2015-11-23' },
  { name: 'Evergreen Landscaping Services', email: 'invoices@evergreen-turf.example', plan: 'pro', created_at: '2016-04-14' },
  { name: 'Flannel & Oak Carpentry', email: 'contact@flannelandoak.example', plan: 'free', created_at: '2016-10-09' },
  { name: 'Gilded Spoon Catering', email: 'accounts@gildedspoon.example', plan: 'enterprise', created_at: '2017-03-30' },
  { name: 'Heritage Clockwork Repairs', email: 'shop@heritageclockwork.example', plan: 'pro', created_at: '2017-08-12' },
  { name: 'Ironclad Security Doors', email: 'ap@ironcladdoors.example', plan: 'enterprise', created_at: '2018-01-25' },
  { name: 'Juniper Berry Apothecary', email: 'hello@juniperapothecary.example', plan: 'free', created_at: '2018-07-04' },
  { name: 'Kettle & Pod Coffee Roasters', email: 'orders@kettleandpod.example', plan: 'pro', created_at: '2019-02-17' },
  { name: 'Lighthouse Legal Transcription', email: 'billing@lighthouse-transcription.example', plan: 'enterprise', created_at: '2019-11-08' },
  { name: 'Meadowbrook Equine Dental', email: 'office@meadowbrook-equine.example', plan: 'free', created_at: '2020-05-19' },
  { name: 'North Star Marine Surveys', email: 'payments@northstarmarine.example', plan: 'pro', created_at: '2021-03-22' },
  { name: 'Orchard Lane Cider Mill', email: 'cider@orchardlanecider.example', plan: 'free', created_at: '2021-12-01' },
  { name: 'Puddleduck Raincoats', email: 'accounting@puddleduckcoats.example', plan: 'pro', created_at: '2022-06-15' },
  { name: 'Quayside Rigging & Sail', email: 'books@quaysiderigging.example', plan: 'enterprise', created_at: '2023-04-10' },
  { name: 'Red Tractor Organic Produce', email: 'farmer@redtractorproduce.example', plan: 'free', created_at: '2024-01-29' },
  { name: 'Silverline Audio Engineering', email: 'invoices@silverlineaudio.example', plan: 'pro', created_at: '2025-05-14' },
  { name: 'Thimble & Thread Tailoring', email: 'owner@thimbleandthread.example', plan: 'enterprise', created_at: '2026-08-03' },
];

/** schema_migrations names for versions 31 to 42. */
export const MIGRATIONS = [
  '031_add_invoice_vat_column',
  '032_make_vat_column_nullable_urgent',
  '033_add_discount_percentage_to_invoices',
  '034_fix_discount_rounding_error',
  '035_revert_discount_percentage',
  '036_readd_discount_in_cents_instead',
  '037_drop_legacy_session_tokens',
  '038_recreate_legacy_session_tokens_for_payroll',
  '039_add_currency_code_default_usd',
  '040_allow_negative_amounts_for_refunds',
  '041_fix_invoice_rounding_again',
  '042_revert_041',
];

export const EXTRA_FLAGS: Array<{ name: string; enabled: 0 | 1; note: string }> = [
  { name: 'dark_mode_beta', enabled: 0, note: 'yellow on brown made users dizzy' },
  { name: 'export_to_excel_97', enabled: 1, note: 'one bakery in Idaho. Windows ME. Do not ask' },
  { name: 'automatic_late_fee_reminders', enabled: 0, note: 'sent one every hour. Legal asked us to stop' },
  { name: 'confetti_on_payment', enabled: 1, note: 'support says it reduces rage by 18%' },
  { name: 'invoice_faxing', enabled: 0, note: 'still tries to dial a modem. Off since 2017' },
  { name: 'sql_injection_protection', enabled: 1, note: 'do not turn off. it is the only one' },
];
