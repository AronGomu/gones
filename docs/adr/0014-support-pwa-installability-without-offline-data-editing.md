# Support PWA Installability with Browser-Local Data

Gones should remain a web-first Angular SPA, but users may want an app-like launcher experience. We decided to support PWA installability while making it clear that the current data store is browser-local. The service worker may cache application shell assets; users should rely on Gones Export/Gones Restore for backups and data movement until the ASP.NET backend becomes canonical.
