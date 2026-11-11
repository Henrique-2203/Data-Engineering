import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { EnvBanner } from './components/EnvBanner';
import './styles.css';
import { initAppearance } from './lib/appearance';

// tema antes de desenhar (sem piscar o escuro para quem usa o claro)
initAppearance();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <EnvBanner />
  </StrictMode>,
);
