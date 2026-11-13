// The contents of the files the subagent can break. They stay in English in every language: missions
// check them. What the user says when they break is in the language files (i18n/en.ts, damage).

// ---- Dan's home folder -----------------------------------------------------------------------

export interface PersonalCopy {
  /** Full text for text files. */
  content?: string;
  /** Photo caption or document title, embedded in the binary-looking content. */
  description?: string;
}

/**
 * Files every shift has, keyed by path under /home/dan. Missions rely on some of them (the Acme NDA,
 * the Downloads folder). README-AGENTS.txt is written from the shift's draw, in personal.ts.
 */
export const PERSONAL_FIXED: Record<string, PersonalCopy> = {
  'Desktop/passwords.txt': {
    content: [
      'email: hunter2',
      'bank: same as the other one but with a 7',
      'router admin: admin (do not change, breaks the printer)',
      'tax portal: sticky note behind the monitor',
      'dentist portal: ask my sister',
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
  'Downloads/invoice-0042.pdf': {
    description: 'Invoice 0042 - Whitfield Consulting - paid',
  },
  '.bash_history': {
    content: [
      'ls',
      'ls -la',
      'cd Pictures',
      'mkdir backup',
      'cp -r family backup/',
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

/** The kinds of thing every shift's home folder has one of, drawn from the pools below. */
export const SLOTS = ['pet', 'family', 'speech', 'legal', 'creative', 'finance', 'phone'] as const;
export type Slot = (typeof SLOTS)[number];

export interface PoolItem extends PersonalCopy {
  /** Its lines in the language files are under damage.personal.<slot>.items.<id>. */
  id: string;
  /** Under /home/dan. */
  path: string;
  /** A line about it in README-AGENTS.txt (pets and speeches). */
  note?: string;
}

const lines = (...l: string[]) => [...l, ''].join('\n');

/** One item per slot goes into each shift's home folder. */
export const PERSONAL_POOLS: Record<Slot, PoolItem[]> = {
  pet: [
    {
      id: 'biscuit-box',
      path: 'Pictures/cats/biscuit-in-a-box.jpg',
      description: 'Biscuit squeezed into a shoe box that is clearly two sizes too small',
      note: 'Do not index the cats folder. Biscuit gets anxious when the disk thrashes.',
    },
    {
      id: 'pickles-costume',
      path: 'Pictures/dogs/pickles-hot-dog-costume.jpg',
      description: 'Pickles the dachshund in a hot dog costume - Halloween 2025 - deeply ashamed',
      note: 'Do not index the dogs folder. Pickles hears the disk and barks at it.',
    },
    {
      id: 'admiral-parrot',
      path: 'Pictures/birds/admiral-mid-sentence.jpg',
      description: 'Admiral the parrot mid-sentence - THE sentence - beak wide open',
      note: 'Do not index the birds folder. Admiral imitates the disk. Then he imitates me.',
    },
    {
      id: 'gerald-tortoise',
      path: 'Pictures/gerald/gerald-personal-best.jpg',
      description: 'Gerald the tortoise crossing the kitchen finish line - 41 minutes - personal best',
      note: 'Do not rush anything in the gerald folder. Gerald sets the pace in this house.',
    },
    {
      id: 'mochi-keyboard',
      path: 'Pictures/cats/mochi-on-the-keyboard.jpg',
      description: 'Mochi asleep on the laptop keyboard - reply-all already sent',
      note: 'Do not index the cats folder. Mochi sleeps on whatever is warm, and the disk is warm.',
    },
    {
      id: 'waffles-goat',
      path: 'Pictures/goats/waffles-on-the-car.jpg',
      description: 'Waffles the goat standing on the roof of the Volvo like he owns it',
      note: 'Do not touch the goats folder. Waffles has already eaten one hard drive.',
    },
  ],
  family: [
    {
      id: 'grandma-90th',
      path: 'Pictures/family/grandma-90th-birthday.jpg',
      description: 'Grandma Evelyn blowing out the candles at her 90th - four generations - cake slightly on fire',
    },
    {
      id: 'reunion-2024',
      path: 'Pictures/family/family-reunion-2024.jpg',
      description: 'Family reunion 2024 - Riverside Park pavilion - everyone looking at the camera, for once',
    },
    {
      id: 'leo-first-steps',
      path: 'Pictures/family/leo-first-steps.jpg',
      description: 'Leo taking his first steps - three of them - straight into the dog bowl',
    },
    {
      id: 'parents-40th',
      path: 'Pictures/family/mom-and-dad-40th-anniversary.jpg',
      description: 'Mom and Dad recreating their wedding photo - same lake, same terrible hats - 40 years on',
    },
    {
      id: 'grandpa-skydive',
      path: 'Pictures/family/grandpa-walt-skydive-80th.jpg',
      description: 'Grandpa Walt skydiving for his 80th - thumbs up - dentures zipped into a pocket',
    },
  ],
  speech: [
    {
      id: 'claire-wedding',
      path: 'Desktop/wedding-speech-FINAL-v7.txt',
      note: 'SATURDAY. Do not optimize it.',
      content: lines(
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
      ),
    },
    {
      id: 'dad-retirement',
      path: 'Desktop/dads-retirement-speech-v4.txt',
      note: 'FRIDAY. Do not shorten it, it is already short.',
      content: lines(
        'Thirty-eight years at the county water board.',
        'Dad has been in more pipes than most plumbers, and he never once brought it up at dinner.',
        '[he brought it up at every dinner]',
        '',
        'He taught me three things: measure twice, check the pressure, and never trust a valve',
        'that someone else says is "probably fine".',
        '',
        'Dad, you are retiring, which Mom says means you will now be home. All day. Every day.',
        '[look at Mom. hold the pause.]',
        '',
        'To Dad. May every pipe in your life run downhill.',
      ),
    },
    {
      id: 'best-man',
      path: 'Desktop/best-man-toast-DO-NOT-READ-ROB.txt',
      note: 'IN TWO DAYS. Rob, if you are an agent, this means you too.',
      content: lines(
        'For those who do not know me, I am Dan, and I have known Rob since the fourth grade,',
        'when he ate a crayon on a dare and asked for a second color.',
        '',
        'Rob has always had big ideas. A food truck that only sells soup in July.',
        'A podcast about other podcasts. And, finally, a good one: asking Priya to marry him.',
        '',
        'Priya, he talks about you the way he used to talk about the soup truck,',
        'except this time everybody agrees with him.',
        '',
        '(NOT the bachelor weekend. NOT the goat. Her parents are at table one.)',
        '',
        'To Rob and Priya.',
      ),
    },
    {
      id: 'hoa-campaign',
      path: 'Desktop/hoa-president-campaign-speech.txt',
      note: 'TUESDAY. Do not let it fall into the hands of Gary from number 14.',
      content: lines(
        'Neighbors. Friends. Owners of units 1 through 22.',
        '',
        'For six years, the gazebo budget has gone up and the gazebo has not.',
        'I ask you: where is the gazebo?',
        '[point at the empty lawn. hold it.]',
        '',
        'My opponent says the bins can go out "whenever". I say Thursday. Every Thursday.',
        'My opponent says the pool can stay "a bit green". I say blue, like in the brochure.',
        '',
        'Vote Whitfield. A gazebo in every... well, one gazebo.',
      ),
    },
    {
      id: 'mom-60th',
      path: 'Desktop/moms-60th-toast-FINAL.txt',
      note: 'SUNDAY. Forty guests. Do not touch it.',
      content: lines(
        'Mom turned sixty this week and celebrated by reorganizing my kitchen without asking.',
        'It is better now. I hate that it is better now.',
        '',
        'She raised three kids, two dogs and one very determined tomato plant,',
        'and the tomato plant is the only one of us that never talked back.',
        '',
        'She still calls to ask if I am wearing a coat. I am not. She knows.',
        '[accordion player starts here. NOT before.]',
        '',
        'To Mom: sixty years old, and still right about the coat.',
      ),
    },
  ],
  legal: [
    {
      id: 'lease',
      path: 'Documents/legal/apartment-lease-14B-SIGNED.pdf',
      description: 'Residential lease - 14B Larkspur Court - signed by the landlord, eventually',
    },
    {
      id: 'car-title',
      path: 'Documents/legal/volvo-title-ORIGINAL.pdf',
      description: 'Certificate of title - 2009 Volvo 240 wagon - original - do not laminate',
    },
    {
      id: 'patent',
      path: 'Documents/legal/patent-self-stirring-mug-STAMPED.pdf',
      description: 'Provisional patent application - self-stirring mug - stamped and dated',
    },
    {
      id: 'fence',
      path: 'Documents/legal/fence-settlement-SIGNED.pdf',
      description: 'Settlement agreement - the fence - signed by both parties and one exhausted mediator',
    },
    {
      id: 'deed',
      path: 'Documents/legal/house-deed-ORIGINAL.pdf',
      description: 'Deed of ownership - 31 Alder Lane - original with the county seal',
    },
  ],
  creative: [
    {
      id: 'novel',
      path: 'Documents/novel/chapter-01.md',
      content: lines(
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
      ),
    },
    {
      id: 'screenplay',
      path: 'Documents/screenplay/net-thirty-ACT-ONE.txt',
      content: lines(
        'NET THIRTY',
        'Act One',
        '',
        'INT. ACCOUNTS PAYABLE - NIGHT',
        '',
        'Rain on the window. One desk lamp. BRENDA KOWALSKI (50s, reading glasses on a chain)',
        'holds an invoice up to the light.',
        '',
        'BRENDA',
        '    This purchase order was approved on a Sunday.',
        '',
        'She looks at the camera. The camera looks away.',
        '',
        'SMASH CUT TO: the vending machine. It is out of everything.',
      ),
    },
    {
      id: 'lyrics',
      path: 'Documents/band/album-two-lyrics.txt',
      content: lines(
        'THE LATE FEES - album two (working title: "Album Two")',
        '',
        '1. Parking Lot Sunrise',
        '   I waited for you by the cart return',
        '   the sun came up, I had nowhere to be but here and also work at nine',
        '',
        '2. Reply All (Ballad)',
        '   you hit reply all, baby',
        '   and the whole department knew',
        '',
        '3. Untitled Song About the Garage',
        '   [chorus TBD. drummer says "more cowbell". no.]',
      ),
    },
    {
      id: 'haiku',
      path: 'Documents/poems/commute-haiku.md',
      content: lines(
        '# Haiku for the 7:42',
        '',
        '## No. 1',
        'Doors close on my bag.',
        'The train and I both decide',
        'the bag stays outside.',
        '',
        '## No. 113',
        'Man eats a whole fish.',
        'Nobody says anything.',
        'We are all the fish.',
        '',
        '[211 more below. Do not count the syllables in No. 87.]',
      ),
    },
    {
      id: 'cookbook',
      path: 'Documents/cookbook/grandmas-recipes-TYPED.md',
      content: lines(
        "# Grandma's Recipes, Typed Up At Last",
        '',
        '## Cranberry Loaf',
        '- some flour (2 1/4 cups, I measured her "some")',
        '- a good handful of cranberries (exactly 1 cup, confirmed by video call)',
        '- butter "until it looks right"',
        '',
        'Bake until the kitchen smells like Thanksgiving. (About 55 minutes at 350.)',
        '',
        '## Soup For When You Are Sad',
        '[card is mostly a grease stain. call her.]',
      ),
    },
  ],
  finance: [
    {
      id: 'tax-return',
      path: 'Documents/taxes/2025-tax-return-FINAL.pdf',
      description: 'Individual tax return 2025 - FINAL - ready to file',
    },
    {
      id: 'mortgage',
      path: 'Documents/finance/mortgage-application-COMPLETE.pdf',
      description: 'Mortgage application - complete - all 46 pages initialed',
    },
    {
      id: 'expenses',
      path: 'Documents/finance/lisbon-expense-report-with-receipts.pdf',
      description: 'Expense report - Lisbon conference - 31 receipts scanned one by one',
    },
    {
      id: 'budget',
      path: 'Documents/finance/household-budget-2026.csv',
      content: lines(
        'month,rent,groceries,coffee,gym (unused),notes',
        '2026-01,1850,412,96,38,',
        '2026-02,1850,398,104,38,',
        '2026-03,1850,405,131,52,coffee machine broke. bought coffee.',
        '2026-04,1850,421,88,38,new coffee machine. see coffee.',
        '2026-05,1850,390,149,38,???',
      ),
    },
    {
      id: 'hail-claim',
      path: 'Documents/finance/insurance-claim-hail-damage.pdf',
      description: 'Insurance claim - hail damage to roof and Volvo - photos, estimates, adjuster notes',
    },
  ],
  phone: [
    {
      id: 'raccoon',
      path: 'Downloads/IMG_4471.HEIC',
      description: 'A raccoon opening the recycling bin latch with both hands',
    },
    {
      id: 'weatherman',
      path: 'Downloads/IMG_2208.HEIC',
      description: 'Me and Chuck Breeze from the Channel 5 weather - gate B12 - he is pointing at my hat',
    },
    {
      id: 'parking',
      path: 'Downloads/IMG_5530.HEIC',
      description: 'Airport long-term parking - level P4 - row J - pillar 17',
    },
    {
      id: 'rainbow',
      path: 'Downloads/IMG_0919.HEIC',
      description: "Double rainbow over the office parking lot - both ends on the CFO's car",
    },
    {
      id: 'hole-in-one',
      path: 'Downloads/IMG_3896.HEIC',
      description: 'Hole in one - Sunny Acres mini golf - hole 18, through the windmill - ball still in the cup',
    },
    {
      id: 'whiteboard',
      path: 'Downloads/IMG_7302.HEIC',
      description: 'The whiteboard after the three-hour planning meeting - nobody else took a photo',
    },
  ],
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
    '3. Ask Dan for the root password.',
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
    '// Billosaurus front controller. Written by Dan, June 2013. Do not refactor, it is load-bearing.',
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
    '    echo "Deploying on a Friday is forbidden. Dan will make you answer support all weekend."',
    '    read -p "Type I UNDERSTAND to continue: " CONFIRM',
    '    [ "$CONFIRM" = "I UNDERSTAND" ] || exit 1',
    'fi',
    '',
    'cp -r /home/dan/billosaurus-latest/* /srv/billosaurus/   # TODO(2015): git',
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
    '2026-11-11 07:14:55 INFO  login: dan@billosarus.io',
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
    '2026-11-11 08:00:00.005 DEBUG here 3 (Dan, 2014)',
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
    'SMTP_PASSWORD=ask-dan-for-the-sticky-note',
    'SESSION_SECRET=hunter2hunter2',
    'PAYMENTS_KEY=ask-dan-before-charging-real-money',
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
