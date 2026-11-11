function reportError(message: string) {
  window.dispatchEvent(new CustomEvent('talentfly:pwa-error', { detail: message }));
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    reportError('Offline support is not available in this browser.');
    return;
  }

  let registration: ServiceWorkerRegistration | undefined;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });

  window.addEventListener('talentfly:apply-update', () => {
    if (!registration?.waiting) {
      reportError('The update is no longer available. Reload to check again.');
      return;
    }

    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  });

  void navigator.serviceWorker
    .register('/sw.js')
    .then(async (serviceWorkerRegistration) => {
      registration = serviceWorkerRegistration;

      if (registration.waiting && navigator.serviceWorker.controller) {
        window.dispatchEvent(new Event('talentfly:update-available'));
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration?.installing;
        if (!installing) return;

        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new Event('talentfly:update-available'));
          }
        });
      });

      await navigator.serviceWorker.ready;
      window.dispatchEvent(new Event('talentfly:offline-ready'));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown service-worker error';
      reportError(`Offline support could not be enabled: ${message}`);
    });
}
