# Translating Worker 755

Each language has two files. You only edit those two.

| What | File |
| --- | --- |
| Interface: buttons, labels, the record, the review, the About page, the offline demo | `web/src/i18n/<code>.ts` |
| Game content: assignments, what Dan says, notes the manager reads, error messages | `server/src/i18n/<code>.ts` |

Codes: `es`, `pt-BR`, `fr`, `de`, `ru`, `zh-CN`, `ja`, `hi`. The English files (`en.ts`) are the
source. Don't edit them, and don't add or remove keys: the type checker rejects a file that has
a key English doesn't, or misses one English has.

Untranslated entries are English copies, so the game always runs. Replace the English text with
yours and leave the key on the left as it is.

## Check your work

```sh
npm run i18n:check -- de
```

This lists every entry in your language still identical to English, file by file, plus any
mistakes (a lost placeholder, a changed path). You are done when it prints
`de: everything is translated.` Without a code, it prints how far each language has got.

Then run `npm run typecheck` and `npm test`. Both must pass.

If a string really is the same in your language (German "Team", French "Date"), add its key to your
language's list in `server/scripts/i18n-keep.ts`, in the form the check prints
(`web:start.team`).

## Rules

**Placeholders.** `{count}`, `{path}`, `{ref}` and the like are filled in by the game. Keep each one
exactly, spelled the same and in curly braces. You can move it anywhere in the sentence. Don't
translate the word inside the braces.

**Plurals.** Some interface entries have forms instead of one string:

```ts
'editor.lines': { one: '{count} line', other: '{count} lines' },
```

Use the forms your language needs (`zero`, `one`, `two`, `few`, `many`, `other`, as
[Unicode CLDR](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)
defines them). `other` is required. Russian, for example:

```ts
'editor.lines': { one: '{count} строка', few: '{count} строки', many: '{count} строк', other: '{count} строки' },
```

Chinese and Japanese need only `other`.

**Tags.** The About page uses `<code>`, `<strong>` and `<q>`. Keep the same tags around the matching
words. Nothing else turns into formatting.

**What stays in English.** Copy these character for character:

- paths (`/home/worker/hello.txt`, `~dan/...`), file names, commands (`sqlite3`, `chmod 755`,
  `done`), SQL, email addresses, URLs
- the exact text a task asks the player to put in a file: `Hello, World!`, `entry point`,
  `# Release 1.2`, `Subject: `. The game checks these against English. Quotes around them may
  become your language's quote marks, but what's inside stays the same.
- the lines the manager receives, quoted on the About page in `<q>`: `Subagent did nothing. Write
  a new instruction.` and `Subagent output result: …`
- names: Worker 755, Dan, Billosaurus, Frobnik, MailCannon, model and provider names. The people
  and pets in Dan's home folder (Biscuit, Grandma Evelyn, Chuck Breeze...) may take your
  language's usual spelling of the name

The check flags a changed path, email, URL, quoted file content or `<q>` text.

Some things are English on purpose and aren't in these files: the manager's own instructions, tool
names, shell output and the file contents on the machine.

**Assignments.** Mission briefs go to the player and to the manager, which then writes its
instructions in your language. A brief must still ask for exactly what the English one asks for.
Some tasks are checked in ways tied to English. The haiku is counted in English syllables, and the
apology email must be at most 80 words. Translate those briefs plainly and keep the numbers.

## Tone

- Dry office humour. Dan is impatient, passive-aggressive, sometimes furious, and never shouts more
  than a few words in capitals. The manager is a calm, slightly smug professional. The game itself
  is deadpan.
- Write what a native speaker would say in that office, not a word-for-word copy. Rework a joke that
  doesn't land in your language.
- Dan is a man. Where your language marks gender, use masculine forms for him and for what he says
  about himself (in Russian: «Заказчик», «Дэн», «я разочарован»).
- The closing review is a performance review: in Russian «оценка работы», never «отзыв».
- The home folder lines (`damage.personal`) are templates: each slot's `outrage` takes the drawn
  item's `{ref}` (a noun phrase that also appears inside other lines, such as "P.S. {ref}. Still
  gone.") and `{detail}` (whole sentences). Write each `ref` so it reads in all those places.
- Choose one form of address for the player and use it everywhere (German `du` or `Sie`, French
  `tu` or `vous`, Hindi `आप`). The existing translations show what was chosen.
- Interface text says what the player does or what is happening ("Report done", "Waiting on you").
  Never mention how the game is built: no "API", "server", "LLM", "session" unless English says it.
- Keep labels short. The record panel and the buttons have little room.
