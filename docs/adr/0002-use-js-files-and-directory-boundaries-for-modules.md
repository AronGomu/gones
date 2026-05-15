# Use JS Files and Directory Boundaries for Modules

Gones will use plain `.js` ES modules and express architectural intent through directories and dependency boundaries rather than `.mjs` extensions. The domain layer should live under `domain/` and remain pure by avoiding imports from page, storage, DOM, browser globals, or navigation code. This keeps `.mjs` from becoming a misleading signal of purity, since the extension only indicates ES module syntax and does not prevent side effects.
