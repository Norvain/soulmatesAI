import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { ThemeProvider } from './lib/theme-context';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);

const viteEnv = (import.meta as unknown as { env?: { PROD?: boolean } }).env;
if (typeof navigator !== "undefined" && "serviceWorker" in navigator && viteEnv?.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((error) => console.warn("SW registration failed:", error));
  });
}
