import { i18n } from './i18n';
import '@fontsource-variable/inter';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SecondaryWindow } from './SecondaryWindow';
import { reportActivity } from './activity';
import './styles.css';

// Language changes come from the main process; a reload with stale argv heals itself via getLanguage.
window.desktopApi.onLocaleChanged(state => { void i18n.changeLanguage(state.effective); });
void window.desktopApi.getLanguage()
  .then(state => { if (state.effective !== i18n.language) void i18n.changeLanguage(state.effective); })
  .catch(() => {});

// Main and detached windows both feed the vault auto-lock; the page lives as long as the window.
reportActivity(window, () => window.desktopApi.vaultActivity());

// Detached windows are opened by the main process with ?role=secondary.
const secondary = new URLSearchParams(window.location.search).get('role') === 'secondary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {secondary ? <SecondaryWindow /> : <App />}
  </React.StrictMode>,
);
