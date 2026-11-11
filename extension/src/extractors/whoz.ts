import { urlIsOnDomain } from '../supported-site';
import type { ExtractionOutcome, JobExtractor } from './types';

/**
 * whoz.com extraction rules:
 *   title       = `h2.title`
 *   location    = text of `.locations-list`
 *   Reference   = content directly beneath the visible text "Reference" (-> otherFields)
 *   description = all content directly beneath the visible text "Description"
 *   sourceUrl   = the page URL
 *
 * Serialized into the page by `chrome.scripting.executeScript`: keep it self-contained.
 */
export async function extractWhozJob(
  maxDescriptionLength = 20_000,
  timeoutMs = 6_000,
): Promise<ExtractionOutcome> {
  const MAX_FIELD_LENGTH = 200;
  const MAX_OTHER_FIELD_LENGTH = 2_000;
  const POLL_MS = 250;

  const skippedTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
  const blockTags = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'LI', 'OL', 'P', 'PRE',
    'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL',
  ]);

  function isVisible(element: Element): boolean {
    let current: Element | null = element;
    while (current) {
      if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') {
        return false;
      }
      const style = window.getComputedStyle(current);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0'
      ) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  }

  function rawText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node as Element;
    if (skippedTags.has(element.tagName.toUpperCase()) || !isVisible(element)) return '';
    const content = Array.from(element.childNodes, rawText).join('');
    return blockTags.has(element.tagName.toUpperCase()) ? `\n${content}\n` : content;
  }

  function cleanText(element: Element | null): string {
    if (!element || !isVisible(element)) return '';
    return rawText(element)
      .replace(/ /g, ' ')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function singleLine(value: string): string {
    return value.replace(/\s*\n+\s*/g, ', ').replace(/\s+/g, ' ').trim();
  }

  function ownText(element: Element): string {
    return Array.from(element.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/:$/, '')
      .toLowerCase();
  }

  /** Content beneath a visible label: the next non-empty sibling block, climbing a few levels. */
  function contentBeneath(label: Element, takeAllSiblings: boolean): string {
    let node: Element | null = label;
    for (let depth = 0; node && node !== document.body && depth < 4; depth += 1) {
      const blocks: string[] = [];
      for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
        const text = cleanText(sibling);
        if (!text) continue;
        blocks.push(text);
        if (!takeAllSiblings) break;
      }
      if (blocks.length > 0) return blocks.join('\n\n');
      node = node.parentElement;
    }
    return '';
  }

  function valueBeneathText(labelText: string, takeAllSiblings: boolean): string {
    const wanted = labelText.toLowerCase();
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      if (ownText(element) !== wanted || !isVisible(element)) continue;
      const value = contentBeneath(element, takeAllSiblings);
      if (value) return value;
    }
    return '';
  }

  function readTitle(): string {
    for (const element of Array.from(document.querySelectorAll('h2.title'))) {
      const text = singleLine(cleanText(element));
      if (text) return text;
    }
    return '';
  }

  function readLocation(): string {
    for (const element of Array.from(document.querySelectorAll('.locations-list'))) {
      const items = Array.from(element.querySelectorAll('li'))
        .map((item) => singleLine(cleanText(item)))
        .filter(Boolean);
      const text = items.length > 0 ? [...new Set(items)].join(', ') : singleLine(cleanText(element));
      if (text) return text;
    }
    return '';
  }

  const deadline = Date.now() + timeoutMs;
  let title = '';
  let description = '';
  // whoz.com is a single-page app: wait (bounded) until the required fields have rendered.
  for (;;) {
    title = readTitle();
    description = valueBeneathText('Description', true);
    if ((title && description) || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  if (!title) {
    return { ok: false, error: 'The job title was not found on this whoz.com page.' };
  }
  if (!description) {
    return { ok: false, error: 'The job description was not found on this whoz.com page.' };
  }

  const reference = valueBeneathText('Reference', false);
  const descriptionTruncated = description.length > maxDescriptionLength;
  if (descriptionTruncated) {
    description = description.slice(0, maxDescriptionLength).trimEnd();
  }

  return {
    ok: true,
    job: {
      title: title.slice(0, MAX_FIELD_LENGTH),
      company: '',
      location: readLocation().slice(0, MAX_FIELD_LENGTH),
      sourceUrl: window.location.href,
      description,
      descriptionTruncated,
      ...(reference
        ? { otherFields: { Reference: singleLine(reference).slice(0, MAX_OTHER_FIELD_LENGTH) } }
        : {}),
    },
  };
}

export const whozExtractor: JobExtractor = {
  id: 'whoz',
  siteName: 'whoz.com',
  matches: (url) => urlIsOnDomain(url, 'whoz.com'),
  extract: extractWhozJob,
};
