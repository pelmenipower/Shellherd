import '@fontsource-variable/inter';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SecondaryWindow } from './SecondaryWindow';
import './styles.css';

// Detached windows are opened by the main process with ?role=secondary.
const secondary = new URLSearchParams(window.location.search).get('role') === 'secondary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {secondary ? <SecondaryWindow /> : <App />}
  </React.StrictMode>,
);
