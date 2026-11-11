const DEVELOPMENT_ORIGIN = 'http://localhost:5173';

export function resolvePwaOrigin(configuredOrigin: string | undefined, mode: string): string {
  const candidate = configuredOrigin?.trim();

  if (!candidate && mode === 'production') {
    throw new Error(
      'VITE_TALENTFLY_PWA_ORIGIN must be set to the HTTPS PWA origin for production builds.',
    );
  }

  const value = candidate || DEVELOPMENT_ORIGIN;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VITE_TALENTFLY_PWA_ORIGIN must be a valid origin URL.');
  }

  const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('The PWA origin must use HTTPS, except for localhost development.');
  }

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_TALENTFLY_PWA_ORIGIN must contain only an origin, without credentials or a path.');
  }

  return url.origin;
}
