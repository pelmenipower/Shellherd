import { z } from 'zod';

// zod's JIT probe (new Function) would trip script-src 'self'; the lazy probe needs this before the first parse.
// Imported first in main.tsx so it runs before any module that builds or parses a schema.
z.config({ jitless: true });
