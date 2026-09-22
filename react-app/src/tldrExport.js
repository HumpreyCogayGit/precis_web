import { formatSiteName } from './sources';

// Where the exported post sends readers for the full edition.
export const SITE_URL = 'https://precisnews.vercel.app';

// The export is written to be pasted straight into a Facebook Group post, not
// rendered as Markdown: Facebook shows `**bold**`, `# heading` and `[text](url)`
// literally. So the file uses only what survives a paste -- Unicode bold letters,
// plain-text labels, blank lines between blocks, and bare URLs (which Facebook
// links). No emoji: the post reads as the site does, words only.
// It is still plain text, so it reads fine in any Markdown viewer too.

// Mathematical Sans-Serif Bold: A-Z, a-z and 0-9 each sit in one contiguous run.
const BOLD_UPPER_A = 0x1D5D4;
const BOLD_LOWER_A = 0x1D5EE;
const BOLD_DIGIT_0 = 0x1D7EC;

// Accented letters have no bold code point of their own, so NFD splits them into
// base letter + combining mark first; the base is bolded and the mark rides along.
// NFC afterwards recombines anything that was not bolded.
export const toUnicodeBold = (text = '') => Array.from(String(text).normalize('NFD'), (char) => {
  const code = char.codePointAt(0);
  if (code >= 65 && code <= 90) return String.fromCodePoint(BOLD_UPPER_A + code - 65);
  if (code >= 97 && code <= 122) return String.fromCodePoint(BOLD_LOWER_A + code - 97);
  if (code >= 48 && code <= 57) return String.fromCodePoint(BOLD_DIGIT_0 + code - 48);
  return char;
}).join('').normalize('NFC');

// "Cyber Security" -> "#CyberSecurity": a hashtag stops at the first space.
const hashtag = (text) => `#${String(text).replace(/[^\p{L}\p{N}]+/gu, '')}`;

// Facebook collapses runs of blank lines and trims each line, so every value is
// flattened to one line; a stray newline inside a summary would split the block.
const oneLine = (text = '') => String(text).replace(/\s+/g, ' ').trim();

const formatDate = (value) => {
  const date = value ? new Date(value) : new Date();
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  return valid.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
};

// safeUrl is passed in so the export applies the same http(s) check as the page.
export const buildFacebookPost = ({ title, digest, safeUrl = (url) => url }) => {
  const items = Array.isArray(digest?.items) ? digest.items : [];
  const count = items.length;

  const header = [
    toUnicodeBold(`PRECIS TL;DR — ${title}`),
    formatDate(digest?.generated_at),
    '',
    `${count} ${count === 1 ? 'story' : 'stories'} worth knowing, each in a sentence or two.`,
  ];

  const blocks = items.map((item, index) => {
    const url = safeUrl(item.article_url);
    return [
      toUnicodeBold(`${index + 1}. ${oneLine(item.title)}`),
      oneLine(item.tldr_text),
      `Source: ${formatSiteName(item.site)}`,
      url,
    ].filter(Boolean).join('\n');
  });

  const footer = [
    toUnicodeBold('Read the full digest and more at'),
    SITE_URL,
    '',
    [hashtag(title), '#TLDR', '#PrecisNews'].join(' '),
  ];

  // A blank line between blocks is the only separator: no rules or ornaments.
  return [header.join('\n'), ...blocks, footer.join('\n')].join('\n\n').concat('\n');
};

export const exportFileName = (slug, generatedAt) => {
  const date = generatedAt && !Number.isNaN(new Date(generatedAt).getTime())
    ? new Date(generatedAt)
    : new Date();
  return `precis-tldr-${slug}-${date.toISOString().slice(0, 10)}.md`;
};

export const downloadTextFile = (fileName, text) => {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
