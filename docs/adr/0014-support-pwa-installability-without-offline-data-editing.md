# Support PWA Installability Without Offline Data Editing

Gones should remain a web-first Angular SPA backed by Supabase, but users may want an app-like launcher experience. We decided to support PWA installability while keeping Supabase as the source of truth and avoiding offline source-data editing or stale offline tournament data for the MVP. The service worker may cache application shell assets, but public League data and Organizer edits should require a live Supabase connection.
