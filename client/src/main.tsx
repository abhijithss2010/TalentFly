import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { registerServiceWorker } from './register-service-worker';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing application root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD) {
  registerServiceWorker();
}
