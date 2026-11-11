import './popup.css';
import { getExtensionBuildInfo } from './build-info';
import { resolvePwaOrigin } from './pwa-origin';
import { renderPopup } from './popup-ui';

export const EXTENSION_NAME = 'TalentFly';

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('Missing extension popup root element');
}

const pwaOrigin = resolvePwaOrigin(import.meta.env.VITE_TALENTFLY_PWA_ORIGIN, import.meta.env.MODE);
renderPopup(root, pwaOrigin, getExtensionBuildInfo());
