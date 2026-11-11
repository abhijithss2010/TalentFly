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

export function renderPopup(root: HTMLElement, pwaOrigin: string) {
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
      'Job-page capture and resume selection are coming in the next update. Your resume and AI key stay in the PWA.',
    ),
    createElement('p', 'origin-label', `Workspace: ${pwaOrigin}`),
  );
  content.append(captureCard);

  const openLink = createElement('a', 'open-pwa', 'Open TalentFly');
  openLink.href = `${pwaOrigin}/#dashboard`;
  openLink.target = '_blank';
  openLink.rel = 'noopener noreferrer';
  const arrow = createElement('span', '', '→');
  arrow.setAttribute('aria-hidden', 'true');
  openLink.append(arrow);

  const footer = createElement('footer', 'popup-footer');
  footer.append(
    createElement('span', 'footer-dot'),
    createElement('span', '', 'Your workspace stays on this device'),
  );

  root.replaceChildren(header, content, openLink, footer);
}
