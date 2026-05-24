# Use Supabase as the Source of Truth

Gones currently persists source data in browser localStorage, but the Angular/Supabase version needs shared public data that is consistent across Visitors and Organizer Users. We decided Supabase will become the canonical source of truth after migration, while localStorage may only be used for non-canonical UI state. The migrated app may start with an empty database; existing data does not need automatic browser migration, and Gones Export/Gones Restore remain the backup and portability mechanism.
