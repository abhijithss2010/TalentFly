import type { BuildInfo } from './build-info';
import {
  captureCurrentTab,
  MAX_JOB_DESCRIPTION_LENGTH,
  type JobCapture,
} from './job-capture';

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function renderPopup(
  root: HTMLElement,
  pwaOrigin: string,
  buildInfo: BuildInfo,
  captureJob: () => Promise<JobCapture> = captureCurrentTab,
): void {
  const header = createElement('header', 'popup-header');
  const logo = createElement('img', 'popup-logo');
  logo.src = '/talentfly-mark.svg';
  logo.alt = '';

  const brand = createElement('span', 'popup-brand');
  brand.append(document.createTextNode('Talent'));
  const brandAccent = createElement('span', '', 'Fly');
  brand.append(brandAccent);

  header.append(logo, brand, createElement('span', 'popup-caption', 'ROLE WORKSPACE'));

  const content = createElement('section', 'popup-content');
  content.append(
    createElement('p', 'popup-eyebrow', 'A THOUGHTFUL NEXT STEP'),
    createElement('h1', 'popup-title', 'Make your next move count.'),
    createElement(
      'p',
      'popup-description',
      'Find a role that feels right. TalentFly helps you see where your experience fits.',
    ),
  );

  const captureCard = createElement('section', 'capture-card');
  const captureHeading = createElement('h2', 'capture-card-title');
  captureHeading.append(
    createElement('span', 'capture-icon', '↗'),
    document.createTextNode('Explore a job posting'),
  );
  captureCard.append(
    captureHeading,
    createElement(
      'p',
      'capture-card-copy',
      'Capture visible job details from this tab. The editable preview stays here and is not sent or saved.',
    ),
    createElement('p', 'origin-label', `Workspace: ${pwaOrigin}`),
  );

  const captureButton = createElement('button', 'capture-button', 'Capture this page');
  captureButton.type = 'button';
  const captureStatus = createElement('p', 'capture-status');
  captureStatus.setAttribute('role', 'status');
  captureStatus.hidden = true;

  const captureError = createElement('p', 'capture-error');
  captureError.setAttribute('role', 'alert');
  captureError.hidden = true;

  const preview = createElement('section', 'capture-preview');
  preview.setAttribute('aria-labelledby', 'preview-heading');
  preview.hidden = true;
  const previewHeading = createElement('h3', 'preview-title', 'Review captured details');
  previewHeading.id = 'preview-heading';
  preview.append(previewHeading);

  function addTextField(
    fieldName: keyof Pick<JobCapture, 'title' | 'company' | 'location'>,
    labelText: string,
  ): HTMLInputElement {
    const label = createElement('label', 'preview-label', labelText);
    const input = createElement('input', 'preview-input');
    input.type = 'text';
    input.name = fieldName;
    input.maxLength = 200;
    input.addEventListener('input', () => {
      if (captured) {
        captured[fieldName] = input.value;
      }
    });
    label.append(input);
    preview.append(label);
    return input;
  }

  const titleInput = addTextField('title', 'Job title');
  const companyInput = addTextField('company', 'Company');
  const locationInput = addTextField('location', 'Location');
  const descriptionLabel = createElement('label', 'preview-label', 'Job description');
  const descriptionInput = createElement('textarea', 'preview-textarea');
  descriptionInput.name = 'description';
  descriptionInput.rows = 11;
  descriptionInput.maxLength = MAX_JOB_DESCRIPTION_LENGTH;
  descriptionInput.addEventListener('input', () => {
    if (captured) {
      captured.description = descriptionInput.value;
    }
  });
  descriptionLabel.append(descriptionInput);
  preview.append(descriptionLabel);

  const sourceUrl = createElement('p', 'preview-source');
  preview.append(sourceUrl);
  const trimButton = createElement('button', 'preview-secondary-button', 'Trim description whitespace');
  trimButton.type = 'button';
  trimButton.addEventListener('click', () => {
    descriptionInput.value = descriptionInput.value
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    descriptionInput.dispatchEvent(new Event('input'));
  });

  const clearButton = createElement('button', 'preview-secondary-button', 'Clear preview');
  clearButton.type = 'button';
  clearButton.addEventListener('click', () => {
    captured = null;
    preview.hidden = true;
    captureError.hidden = true;
    captureStatus.textContent = 'Preview cleared. Page content was not saved or sent.';
    captureStatus.hidden = false;
  });
  preview.append(trimButton, clearButton);

  let captured: JobCapture | null = null;
  captureButton.addEventListener('click', async () => {
    captureButton.disabled = true;
    captureButton.textContent = 'Capturing…';
    captureError.hidden = true;
    captureStatus.textContent = 'Reading visible page content…';
    captureStatus.hidden = false;
    try {
      captured = await captureJob();
      titleInput.value = captured.title;
      companyInput.value = captured.company;
      locationInput.value = captured.location;
      descriptionInput.value = captured.description;
      sourceUrl.textContent = `Source page: ${captured.sourceUrl}`;
      preview.hidden = false;
      captureStatus.textContent = captured.descriptionTruncated
        ? `Preview ready. The description was limited to ${MAX_JOB_DESCRIPTION_LENGTH.toLocaleString()} characters.`
        : 'Preview ready. Edit any field before using it.';
    } catch (error) {
      captureStatus.hidden = true;
      captureError.textContent =
        error instanceof Error ? error.message : 'The active page could not be captured.';
      captureError.hidden = false;
    } finally {
      captureButton.disabled = false;
      captureButton.textContent = 'Capture this page';
    }
  });

  captureCard.append(captureButton, captureStatus, captureError, preview);
  content.append(captureCard);

  const openLink = createElement('a', 'open-pwa', 'Open TalentFly');
  const pwaUrl = new URL(pwaOrigin);
  pwaUrl.searchParams.set('extensionVersion', buildInfo.version);
  pwaUrl.searchParams.set('extensionCommit', buildInfo.commit);
  pwaUrl.searchParams.set('extensionBuiltAt', buildInfo.builtAt);
  pwaUrl.hash = 'dashboard';
  openLink.href = pwaUrl.toString();
  openLink.target = '_blank';
  openLink.rel = 'noopener noreferrer';
  const arrow = createElement('span', '', '→');
  arrow.setAttribute('aria-hidden', 'true');
  openLink.append(arrow);

  const footer = createElement('footer', 'popup-footer');
  footer.append(
    createElement('span', 'footer-dot'),
    createElement(
      'span',
      'footer-build',
      `Your workspace stays on this device · Extension v${buildInfo.version} (${buildInfo.commit})`,
    ),
  );

  root.replaceChildren(header, content, openLink, footer);
}
