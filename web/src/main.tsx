import React from 'react';
import { createRoot } from 'react-dom/client';
/* the design layer first: tokens, base, kit, help, shell. Every page's own CSS comes after it (the
   pages are imported through App), so a page rule of the same specificity wins over the kit's. */
import './styles/index.css';
import App from './app/App';
import { injectFonts, injectTextures } from './styles/fonts';

/* fonts from JS: their URLs must be relative to nui://w_admin/web/build/ (see styles/fonts.ts) */
injectFonts();
injectTextures();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
