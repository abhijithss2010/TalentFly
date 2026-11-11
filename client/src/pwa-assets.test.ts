import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('PWA shell assets', () => {
  it('provides a branded standalone manifest with an install icon', async () => {
    const manifestText = await readFile('public/manifest.webmanifest', 'utf8');
    const manifest = JSON.parse(manifestText) as {
      display: string;
      icons: { src: string; sizes: string }[];
      name: string;
      theme_color: string;
    };

    expect(manifest.name).toContain('TalentFly');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#f6f7fb');
    expect(manifest.icons[0]).toMatchObject({
      src: '/talentfly-mark.svg',
      sizes: '512x512',
      purpose: 'any maskable',
    });
    expect(await readFile('public/talentfly-mark.svg', 'utf8')).toContain('<svg');
  });

  it('provides a narrow-screen navigation layout without remote font requests', async () => {
    const stylesheet = await readFile('src/index.css', 'utf8');

    expect(stylesheet).toContain('@media (max-width: 760px)');
    expect(stylesheet).toContain('.primary-nav');
    expect(stylesheet).not.toContain('fonts.googleapis.com');
  });

  it('keeps API traffic outside the service-worker cache', async () => {
    const serviceWorker = await readFile('sw.template.js', 'utf8');

    expect(serviceWorker).toContain("url.pathname.startsWith('/api/')");
    expect(serviceWorker).toContain('BUILD_ASSETS.includes(url.pathname)');
    expect(serviceWorker).toContain("event.data?.type === 'SKIP_WAITING'");
    expect(serviceWorker).toContain('__BUILD_ASSETS__');
  });
});
