import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
/* Side-effect import, and it has to be above App: `useTranslation` throws if no
   i18next instance is initialised, so the instance must exist before the first
   render rather than being created inside a component. */
import './lib/i18n';
import './styles/theme.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from index.html');

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
