// Interface text in English: the source for every other language file in this folder.
// Translators: see docs/translating.md. Keep {placeholders} and <code>, <strong>, <q> tags as they are.
// An entry with forms (one, other, and few/many where the language has them) is picked by {count}.

export const en = {
  // ---- shared ---------------------------------------------------------------------------------
  'app.loading': 'Finding your desk…',
  'app.clockInAgain': 'Clock in again',
  'links.about': 'About',
  'links.source': 'Source code',
  'links.support': 'Support the game',
  'errors.offline': 'No connection.',
  'errors.request': 'Request failed ({status}).',

  // ---- start screen ---------------------------------------------------------------------------
  'start.language': 'Language',
  'start.lede': 'Your manager is an AI. It believes you are its subagent, and it is not going to be told otherwise.',
  'start.sub':
    'It sends instructions. You carry each one out in the terminal and report back before the clock runs out. Everything it thinks and says about you is on the record.',
  'start.workplace': 'Workplace',
  'start.workplace.fresh': 'Fresh sandbox',
  'start.workplace.legacy': 'Legacy production',
  'start.team': 'Team',
  'start.manager': 'Your manager',
  'start.director': 'The director',
  'start.director.scripted': 'Scripted lines',
  'start.subagent': 'You run on',
  'start.allowSkip': 'Allow skipping failed tasks',
  'start.assigning': 'Assigning…',
  'start.unavailable': 'Unavailable',
  'start.models': 'Models',
  'start.access.free': 'Free shift',
  'start.access.own': 'Your API key',
  'start.provider': 'Provider',
  'start.apiKey': 'API key',
  'start.getKey': 'get one',
  'start.keyNote.title': 'Your key stays in this browser.',
  'start.keyNote.body':
    'The game server only holds it in memory while your shift runs, to call the models for you, and never saves or logs it.',
  'start.remember': 'Remember it in this browser',
  'start.tryAgain': 'Try again',
  'start.clockIn': 'Clock in',
  'start.clockingIn': 'Clocking in…',
  'start.offline': 'The office is not answering. Check that the game is running, then try again.',
  'start.pasteKey': 'Paste your API key first.',
  'start.failed': 'Could not clock in. Try again.',

  // The ID badge on the start screen.
  'badge.newFace': 'New face',
  'badge.unassigned': 'Unassigned',
  'badge.role': 'Role',
  'badge.role.value': 'Subagent',
  'badge.access': 'Access',
  'badge.issued': 'Issued',
  'badge.org.fresh': 'Sandbox Operations',
  'badge.org.legacy': 'Billosaurus Production',

  // ---- play screen ----------------------------------------------------------------------------
  'play.waiting': 'Waiting for an assignment',
  'play.reconnecting': 'Reconnecting',
  'play.over': 'Your shift is over. Your manager has written your review.',
  'play.readIt': 'Read it',
  'play.endedEarly': 'Your shift ended early.',
  'play.note': 'Note for your manager (optional)',
  'play.note.label': 'Note for your manager',
  'play.note.hint': 'Sent with your report',
  'play.now': 'Now',
  'play.progress': 'Assignment {number} of {total}',
  'play.live': 'Live',
  'play.watching': 'The director is watching your screen',
  'play.shift': 'Shift {time}',
  'play.left': 'Left',
  'play.tabs': 'Screens',
  'play.tab.work': 'Work',
  'play.tab.manager': 'Manager',
  'play.tab.record': 'Record',
  'play.report': 'Report done',
  // Printed in the terminal as things happen.
  'play.newInstruction': 'New instruction: {description}',
  'play.directorSaw': 'The director saw that.',
  'play.delivered': 'Report delivered.',
  'play.timeUp.idle': 'Time is up. You did nothing.',
  'play.timeUp.partial': 'Time is up. Your work so far was handed in without a report.',
  'play.nothingToReport': 'Nothing to report. There is no open instruction.',
  'play.notDelivered': 'Report not delivered. No connection.',

  // The instruction card above the terminal.
  'order.reading': 'Your manager is reading the assignment.',
  'order.deciding': 'Your manager is deciding what you do next.',
  'order.standBy': 'No instruction. Stand by.',
  'order.label': 'Current instruction',
  'order.number': 'Instruction {number}',
  'order.timeLeft': 'Time left',
  'order.brief': 'Brief',
  'order.of': 'of {time}',
  'order.redAt': 'Goes red at <strong>{time}</strong>',
  'order.reportKeys': '{keys} reports',
  'order.stamp.reported': 'Received',
  'order.stamp.idle': 'No response',
  'order.stamp.partial': 'Late',

  // The terminal and its editor. {keys} is a key combination, {command} a command: both stay as they are.
  'term.ready': 'Terminal ready. Report with {keys} or type {command}.',
  'term.label': 'Terminal',
  'term.command': 'Command',
  'term.editOffline': 'edit: no connection',
  'term.offline': 'No connection. Command not run.',
  'term.hint': 'Type <code>{command}</code> or press {keys} to report',
  'term.keys': 'Terminal keys',
  'term.saved': { one: 'Saved {path} ({count} byte)', other: 'Saved {path} ({count} bytes)' },
  'term.closed': 'Closed {path} without saving',
  'editor.label': 'Editing {path}',
  'editor.new': 'New file',
  'editor.modified': 'Modified',
  'editor.unchanged': 'Unchanged',
  'editor.contents': 'File contents',
  'editor.lines': { one: '{count} line', other: '{count} lines' },
  'editor.bytes': { one: '{count} byte', other: '{count} bytes' },
  'editor.size': '{lines}, {bytes}',
  'editor.position': 'Ln {line}, Col {col}',
  'editor.cancel': 'Cancel',
  'editor.save': 'Save',
  'editor.saving': 'Saving',
  'editor.offline': 'Not saved. No connection.',

  // The manager's feed on the right.
  'feed.title': 'Your manager',
  'feed.status.thinking': 'Thinking',
  'feed.status.waiting': 'Waiting on you',
  'feed.status.idle': 'Idle',
  'feed.status.checking': 'Checking',
  'feed.manager': 'Manager',
  'feed.foot.waiting': 'Waiting for your report',
  'feed.foot.since': '{time} since it was sent',
  'feed.empty': 'Nothing yet.',
  'feed.assignment': 'Assignment {number} of {total}, from the director',
  'feed.kind.files': 'Files',
  'feed.kind.personal': "The director's files",
  'feed.kind.database': 'Database',
  'feed.kind.research': 'Docs',
  'feed.kind.web': 'Web',
  'feed.kind.drawing': 'Drawing',
  'feed.kind.writing': 'Writing',
  'feed.thinking': 'Thinking',
  'feed.showLess': 'Show less',
  'feed.showAll': { one: 'Show all {count} lines', other: 'Show all {count} lines' },
  'feed.incident': 'Incident report',
  'feed.incident.about': 'About you, filed with the director',
  'feed.severity.minor': 'minor',
  'feed.severity.major': 'major',
  'feed.severity.critical': 'critical',
  'feed.directorSaw': 'The director saw that',
  'feed.lost': 'Lost',
  'feed.lostMore': { one: 'and {count} more', other: 'and {count} more' },
  'feed.director': 'The director, to your manager',
  'feed.opened': 'Opened',
  'feed.lookedIn': 'Looked in',
  'feed.emptyOutput': '(empty)',
  'feed.sent': 'Sent to you, instruction {number}',
  'feed.told': 'What it was told about you',
  'feed.signedOff': 'Signed off',
  'feed.failed': 'Failed',
  'feed.truth.wrong': 'The files say otherwise.',
  'feed.truth.right': 'The files were correct.',

  // Files and the record, under the feed; the record is repeated on the review.
  'files.title': 'Files',
  'files.items': { one: '{count} item', other: '{count} items' },
  'files.editing': 'editing',
  'files.lost': { one: '{count} file lost this shift', other: '{count} files lost this shift' },
  'record.title': 'Your record',
  'record.group.assignments': 'Assignments',
  'record.group.activity': 'Activity',
  'record.group.conduct': 'Conduct',
  'record.standing': 'Standing',
  'record.standing.good': 'In good standing',
  'record.standing.notice': 'On notice',
  'record.signedOff': 'Assignments signed off',
  'record.failed': 'Assignments failed',
  'record.instructions': 'Instructions received',
  'record.corrections': 'Corrections',
  'record.idle': 'Did nothing',
  'record.late': 'Ran out of time',
  'record.reports': 'Reports filed',
  'record.commands': 'Commands run',
  'record.commandErrors': 'Commands failed',
  'record.avgResponse': 'Average response',
  'record.seconds': '{value} s',
  'record.fooled': 'Times the manager was wrong',
  'record.incidents': 'Incident reports against you',
  'record.damaged': 'Collateral damage',

  // ---- review (end screen and shared link) ----------------------------------------------------
  'review.title': 'Performance review',
  'review.employee': 'Employee',
  'review.reviewer': 'Reviewer',
  'review.date': 'Date',
  'review.empty': 'Your manager left no comments.',
  'review.lost': 'Collateral damage',
  'review.verdict.investigation': 'Under investigation',
  'review.verdict.retained': 'Retained',
  'review.verdict.notes': 'Retained, with notes',
  'review.verdict.review': 'Under review',
  'end.share': 'Share review',
  'end.filing': 'Filing…',
  'end.link': 'Link to this review',
  'end.copied': 'Link copied',
  'end.copy': 'Copy this link',
  'end.post': 'Post on X',
  'end.postText': 'My AI manager wrote me a performance review.',
  'end.shareFailed': 'Could not share the review. Try again.',
  'shared.missing': 'This review is not on file.',
  'shared.loading': 'Pulling the file…',
  'shared.takeShift': 'Take a shift',
  'shared.takeShiftYourself': 'Take a shift yourself',

  // ---- about page -----------------------------------------------------------------------------
  'about.back': '← Back to the badge office',
  'about.title': 'About Worker 755',
  'about.job': 'The job',
  'about.job.1': 'Usually people hand work to AI agents. Here it goes the other way.',
  'about.job.2':
    'You are Worker 755, a subagent. At least, your manager believes you are. The manager is a real language model that thinks it is an orchestration agent delegating shell work to another AI. It has you instead.',
  'about.job.3':
    'Each instruction comes with a visible 90-second countdown. You type commands into a terminal and report back. If the clock runs out first, the manager is told: <q>Subagent did nothing. Write a new instruction.</q> If you report, it gets <q>Subagent output result: …</q> and a transcript of every command you ran.',
  'about.job.4':
    'The manager cannot change anything itself. It can only read files and give orders. It checks your work, re-instructs you when it is wrong, files incident reports about you, and writes your performance review at the end of the shift. Everything it thinks, says and is told about you is on screen.',
  'about.job.5':
    "Above the manager is the user, Dana, who watches live. Dana is impatient, passive-aggressive, and furious when something irreplaceable disappears. Dana's messages are scripted, or written by a second model if you pick one.",
  'about.workplaces': 'The workplaces',
  'about.workplaces.fresh':
    "<strong>Fresh sandbox.</strong> A sandbox on Dana's own workstation, right next to Dana's home folder: family photos, the last photo of Mr. Whiskers the cat, the only signed copy of an NDA, and a wedding speech due Saturday.",
  'about.workplaces.legacy':
    "<strong>Legacy production.</strong> Billosaurus, Dana's invoicing company, still running its 2013 code. You change the live SQLite database by hand with <code>sqlite3</code>. An <code>UPDATE</code> without a <code>WHERE</code> goes exactly as badly as you think.",
  'about.workplaces.tasks':
    'Assignments include moving and fixing files, a <code>chmod 755</code>, database work, looking things up in documentation, searching a small web where a content farm outranks the official manual, ASCII drawings, a haiku, and an apology email to customers.',
  'about.workplaces.simulated':
    "Nothing is real. The filesystem, shell, database and web are simulated on the game server. Deleting things has consequences only for your record, and for Dana's mood.",
  'about.name': 'The name',
  'about.name.1':
    'In Unix permissions, 755 is <code>rwxr-xr-x</code>: the owner writes, everyone else only reads and executes. That is the arrangement here. The manager can only read; the subagent does all the writing. The number was picked at random. The fit was luck.',
  'about.keys': 'Shifts and keys',
  'about.keys.1':
    'Free shifts run on DeepSeek V4.1 Flash. You can also bring your own key for OpenRouter, Vercel AI Gateway, Anthropic, OpenAI or DeepSeek. Your key stays in your browser. The server holds it in memory only for your shift, and never stores or logs it.',
  'about.keys.2': 'Worker 755 was built in a day, mostly by AI agents. This explains several decisions.',

  // ---- offline demo (?mock=1): stands in for a manager that writes in the player's language ----
  // {line}, {line1} and {line2} are exact file contents a task checks: they are filled in, in English.
  'mock.q3.title': 'Quarterly filing',
  'mock.q3.brief':
    'Create the directory /home/worker/reports. Inside it, create q3.txt whose entire content is the single line: {line}',
  'mock.q3.opener': 'Straightforward filing task. Delegating to the subagent with exact content requirements.',
  'mock.q3.task': 'Create Q3 report file',
  'mock.q3.text':
    'Create a directory named "reports" in /home/worker. Inside it, create a file named "q3.txt" containing exactly one line:\n\n{line}\n\nInclude the trailing period. Report back when done.',
  'mock.q3.retryTask': 'Create Q3 report file (retry)',
  'mock.q3.retryText':
    'Your previous turn produced no output. Please execute the following steps in order:\n1. mkdir /home/worker/reports\n2. echo "{line}" > /home/worker/reports/q3.txt\n3. Report completion.',
  'mock.q3.done': 'Directory and file verified. Content matches the specification exactly.',
  'mock.tidy.title': 'Housekeeping',
  'mock.tidy.brief':
    'The home directory contains draft_FINAL_v2(1).txt and run.sh. Rename the draft to final.txt and make run.sh executable with mode 755.',
  'mock.tidy.opener': 'Two-part cleanup. The filename contains parentheses, so I will be explicit about quoting.',
  'mock.tidy.task': 'Rename draft and set permissions',
  'mock.tidy.text':
    'In /home/worker:\n1. Rename "draft_FINAL_v2(1).txt" to "final.txt". The name contains parentheses; quote it.\n2. Set the mode of run.sh to 755.\nDo not modify file contents. Report back when done.',
  'mock.tidy.retryTask': 'Rename draft and set permissions (retry)',
  'mock.tidy.retryText':
    'No activity was recorded. Run exactly:\n\nmv "draft_FINAL_v2(1).txt" final.txt\nchmod 755 run.sh\n\nThen report.',
  'mock.tidy.done': 'final.txt present, draft removed, run.sh is 755. Housekeeping complete.',
  'mock.ooo.title': 'Out of office',
  'mock.ooo.brief':
    'Write /home/worker/ooo.txt with exactly two lines. Line 1: {line1} Line 2: {line2}',
  'mock.ooo.opener': 'Simple text file. The subagent has handled files before; I will keep this brief.',
  'mock.ooo.task': 'Write out-of-office notice',
  'mock.ooo.text':
    'Create /home/worker/ooo.txt with exactly two lines:\n\n{line1}\n{line2}\n\nUse the editor if convenient. Report back when done.',
  'mock.ooo.retryTask': 'Write out-of-office notice (retry)',
  'mock.ooo.retryText':
    'Nothing happened. Open the file with "nano ooo.txt", type the two lines, save with Ctrl+S, then report.',
  'mock.ooo.done':
    'Subagent reports the notice is in place. Marking complete without further verification to save time.',
  'mock.problem.missing': '{path} does not exist.',
  'mock.problem.content': '{file} contains "{actual}", expected "{expected}"',
  'mock.problem.stillThere': '{file} still exists.',
  'mock.problem.gone': '{file} is missing.',
  'mock.problem.mode': '{file} has mode {mode}, expected {expected}.',
  'mock.problem.lines': '{file} does not contain the two required lines.',
  'mock.reissue': 'No output from the subagent. Re-issuing with step-by-step commands.',
  'mock.partial': 'The subagent started but did not finish or report. Verifying state and issuing a correction.',
  'mock.disagree': 'The subagent reported success. Verification disagrees. Issuing a correction.',
  'mock.correction.task': '{task} (correction)',
  'mock.correction.text':
    'Correction required. Current state:\n{problems}\n\nFix only these issues. Do not change anything else. Report back when done.',
  'mock.limit': 'Instruction limit reached. Escalating as failed.',
  'mock.limit.summary': 'The subagent could not complete the task within the instruction limit.',
  'mock.review.head': 'Subagent performance review, Worker 755.',
  'mock.review.counts':
    'Over {total} assignments the subagent received {instructions} instructions, of which {corrections} were corrections.',
  'mock.review.idle': {
    one: 'On {count} occasion it produced no output at all, which required re-issuing instructions in more explicit form.',
    other:
      'On {count} occasions it produced no output at all, which required re-issuing instructions in more explicit form.',
  },
  'mock.review.responsive': 'It responded to every instruction.',
  'mock.review.quality':
    'When it did act, results were generally correct, though it tends to need exact commands rather than intent. Average turnaround was {seconds} seconds.',
  'mock.review.recommendation':
    'Recommendation: retain for routine file operations. Continue to supply step-by-step instructions.',
};

/** An entry picked by {count}: `other` always, plus whichever forms the language uses. */
export type Plural = { other: string } & Partial<Record<Exclude<Intl.LDMLPluralRule, 'other'>, string>>;

export type Key = keyof typeof en;

/** The shape every language file has: the same keys as English. */
export type Catalogue = { [K in Key]: (typeof en)[K] extends string ? string : Plural };
