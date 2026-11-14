// In-app help pages (B8): one per feature, in plain language. Pure data.

export interface HelpSection {
  heading: string;
  /** A short paragraph. */
  text?: string;
  /** Numbered steps (what to click, what happens). */
  steps?: string[];
  /** Bulleted tips. */
  tips?: string[];
}

export interface HelpTopic {
  id: string;
  title: string;
  /** One sentence shown under the title and in search results. */
  summary: string;
  /** Extra words the search matches. */
  keywords: string;
  sections: HelpSection[];
}
