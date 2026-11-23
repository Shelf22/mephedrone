import emotes from './emotes.json';

const markdownChars = ['_', '*', '`', '~', '<', '>', '@', '\\'];

export const categories = Object.keys(emotes);

export function removeMarkdown(emote: string): string {
  let formatted = '';
  for (const char of emote) {
    formatted += markdownChars.includes(char) ? `\\${char}` : char;
  }
  return formatted;
}

export type KaomojiResult = { ok: true; content: string } | { ok: false; error: string };

/**
 * Build the message to send.
 * @param category Category name (case-insensitive)
 * @param message Optional text to put before the kaomoji
 * @param index Optional 1-based kaomoji number; random when omitted
 */
export function buildKaomoji(category: string, message?: string, index?: number): KaomojiResult {
  const list: string[] | undefined = (emotes as Record<string, string[]>)[
    category.trim().toLowerCase()
  ];
  if (!list) {
    return {
      ok: false,
      error: `There aren't any kaomoji for that emotion! Pick one of: ${categories.join(', ')}`,
    };
  }

  let emote: string;
  if (index === undefined) {
    emote = list[Math.floor(Math.random() * list.length)];
  } else if (Number.isInteger(index) && index >= 1 && index <= list.length) {
    emote = list[index - 1];
  } else {
    return {
      ok: false,
      error: `${category.trim().toLowerCase()} has ${list.length} kaomoji, use 1-${list.length}.`,
    };
  }

  const text = message?.trim();
  return { ok: true, content: text ? `${text} ${removeMarkdown(emote)}` : removeMarkdown(emote) };
}

export const commandInfo = {
  name: 'kaomoji',
  description: 'Appends a kaomoji to your message!',
  emotionDescription: 'Emotion/category, e.g. joy, love, shrug',
  messageDescription: 'Text to send before the kaomoji',
  indexDescription: 'Specific kaomoji number (random if omitted)',
};
