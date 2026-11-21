import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

function ensureHeadLink(rel: string, href: string): void {
  if (document.head.querySelector(`link[rel="${rel}"]`)) return;
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  document.head.appendChild(link);
}

function registerWebPwaSupport(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const { protocol } = window.location;
  if (protocol !== 'http:' && protocol !== 'https:') return;

  ensureHeadLink('manifest', './manifest.webmanifest');
  ensureHeadLink('apple-touch-icon', './icon.svg');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // 忽略受限网络或禁用 Service Worker 环境下的注册失败
      });
    });
  }
}

registerWebPwaSupport();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
