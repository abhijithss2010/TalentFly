export const MAX_JOB_DESCRIPTION_LENGTH = 20_000;

export interface JobCapture {
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  description: string;
  descriptionTruncated: boolean;
}

export function extractJobPostingFromPage(
  maxDescriptionLength = 20_000,
): JobCapture {
  const excludedTags = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'SVG',
    'BUTTON',
    'INPUT',
    'SELECT',
    'TEXTAREA',
    'NAV',
    'FOOTER',
    'HEADER',
  ]);
  const blockTags = new Set([
    'ADDRESS',
    'ARTICLE',
    'ASIDE',
    'BLOCKQUOTE',
    'BR',
    'DD',
    'DIV',
    'DL',
    'DT',
    'FIELDSET',
    'FIGCAPTION',
    'FIGURE',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'HR',
    'LI',
    'OL',
    'P',
    'PRE',
    'SECTION',
    'TABLE',
    'TD',
    'TH',
    'TR',
    'UL',
  ]);

  function isVisible(element: Element): boolean {
    let current: Element | null = element;
    while (current) {
      if (
        current.hasAttribute('hidden') ||
        current.getAttribute('aria-hidden') === 'true'
      ) {
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

  function textFrom(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const element = node as Element;
    if (excludedTags.has(element.tagName) || !isVisible(element)) {
      return '';
    }

    const content = Array.from(element.childNodes, textFrom).join('');
    return blockTags.has(element.tagName) ? `\n${content}\n` : content;
  }

  function cleanText(element: Element | null): string {
    if (!element || !isVisible(element)) {
      return '';
    }
    return textFrom(element)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function firstVisibleText(selectors: string[], maxLength = 180): string {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const text = cleanText(element);
        if (text && text.length <= maxLength) {
          return text;
        }
      }
    }
    return '';
  }

  const title =
    firstVisibleText(['main h1', '[role="main"] h1', 'article h1', 'h1']) ||
    document.title.trim();
  const company = firstVisibleText([
    '[itemprop="hiringOrganization"]',
    '[data-testid*="company" i]',
    '[data-test*="company" i]',
    '[class*="company-name" i]',
    '[class*="companyName"]',
    '[class*="employer-name" i]',
  ]);
  const location = firstVisibleText([
    '[itemprop="jobLocation"]',
    '[data-testid*="location" i]',
    '[data-test*="location" i]',
    '[class*="job-location" i]',
    '[class*="jobLocation"]',
  ]);

  const descriptionSelectors = [
    '[itemprop="description"]',
    '[data-testid*="job-description" i]',
    '[data-test*="job-description" i]',
    '[id*="job-description" i]',
    '[class*="job-description" i]',
    '[id*="jobDescription"]',
    '[class*="jobDescription"]',
    '.show-more-less-html__markup',
  ];

  let description = '';
  for (const selector of descriptionSelectors) {
    const candidates = Array.from(document.querySelectorAll(selector))
      .map(cleanText)
      .filter((text) => text.length >= 30)
      .sort((left, right) => right.length - left.length);

    if (candidates.length > 0) {
      description = candidates[0];
      break;
    }
  }

  const nonDescriptionLines = new Set([title, company, location].filter(Boolean));
  if (!description) {
    for (const selector of ['article', 'main', '[role="main"]', 'body']) {
      const candidates = Array.from(document.querySelectorAll(selector))
        .map(cleanText)
        .map((text) =>
          text
            .split('\n')
            .filter((line) => !nonDescriptionLines.has(line.trim()))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim(),
        )
        .filter((text) => text.length >= 30)
        .sort((left, right) => right.length - left.length);

      if (candidates.length > 0) {
        description = candidates[0];
        break;
      }
    }
  }

  const descriptionTruncated = description.length > maxDescriptionLength;
  if (descriptionTruncated) {
    description = description.slice(0, maxDescriptionLength).trimEnd();
  }

  if (!title && !company && !location && !description) {
    throw new Error('No readable job details were found on this page.');
  }
  if (!description) {
    throw new Error('No visible job description was found on this page.');
  }

  return {
    title,
    company,
    location,
    sourceUrl: window.location.href,
    description,
    descriptionTruncated,
  };
}

export async function captureCurrentTab(): Promise<JobCapture> {
  if (!globalThis.chrome?.tabs || !globalThis.chrome.scripting) {
    throw new Error('Job capture is only available in the installed Chrome extension.');
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof activeTab?.id !== 'number') {
    throw new Error('No active browser tab is available to capture.');
  }

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: extractJobPostingFromPage,
      args: [MAX_JOB_DESCRIPTION_LENGTH],
    });
    if (!injection?.result) {
      throw new Error('The active page did not return any job details.');
    }
    return injection.result;
  } catch (error) {
    if (error instanceof Error && error.message.includes('No visible job description')) {
      throw error;
    }
    throw new Error(
      'This page does not allow capture. Open a regular webpage and try again.',
    );
  }
}
