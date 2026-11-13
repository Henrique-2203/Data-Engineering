import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { EnvBanner } from './components/EnvBanner';
import './styles.css';
import { isDesktop } from './lib/desktop';
import { initAppearance } from './lib/appearance';

// tema antes de desenhar (sem piscar o escuro para quem usa o claro)
initAppearance();

// app de Windows: os botões "voltar"/"avançar" do mouse não navegam (não há página anterior num app)
if (isDesktop) {
  const stop = (e: MouseEvent) => {
    if (e.button === 3 || e.button === 4) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  window.addEventListener('mouseup', stop, true);
  window.addEventListener('mousedown', stop, true);
  window.addEventListener('auxclick', stop, true);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <EnvBanner />
  </StrictMode>,
);
