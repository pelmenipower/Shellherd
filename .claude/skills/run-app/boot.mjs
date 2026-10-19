// Electron entry for the run-app driver: isolates appData/userData, then loads the real main bundle.
import { app } from 'electron';
import { join } from 'node:path';

const profile = process.env.SHELLHERD_PROFILE;
app.setPath('appData', profile);
app.setPath('userData', join(profile, 'Shellherd'));
await import(process.env.SHELLHERD_MAIN);
