#!/usr/bin/env node
// Electron and all packaging tools are devDependencies. The shared strict gate
// includes them, along with production, optional and peer dependencies.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
try { require('./audit-ci.js').main() }
catch (error) { console.error(error.message); process.exitCode = 1 }
