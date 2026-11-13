// The FAQ's shape. Ids are the page's anchors (/faq#key), so they are the same in every language.

export type FaqId =
  | 'what'
  | 'shift'
  | 'workplaces'
  | 'idle'
  | 'skip'
  | 'end-early'
  | 'manager'
  | 'model'
  | 'tone'
  | 'argue'
  | 'run-on'
  | 'director'
  | 'director-files'
  | 'cost'
  | 'providers'
  | 'key'
  | 'stored'
  | 'terminal'
  | 'commands'
  | 'review'
  | 'share'
  | 'shared-page'
  | 'languages'
  | 'phone'
  | 'name'
  | 'who'
  | 'bug';

export interface FaqEntry {
  id: FaqId;
  q: string;
  /** Paragraphs split by a blank line; may use <code>, <strong>, <q> and <a href="…">. */
  a: string;
}

export interface FaqSection {
  title: string;
  items: FaqEntry[];
}

export interface Faq {
  /** One line under the page title. */
  lede: string;
  sections: FaqSection[];
}
