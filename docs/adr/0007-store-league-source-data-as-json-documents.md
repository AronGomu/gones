# Store League Source Data as JSON Documents

Gones source data is already versioned, exported, restored, and recalculated as serializable plain data. We decided to store each League's source data as a versioned JSON document in Supabase for the MVP rather than normalizing Tournaments, Rounds, and Round Entries into separate tables, because expected traffic and edit concurrency are low and JSON storage preserves the current export/restore model with minimal migration risk. Normalized tables can be introduced later if Gones needs richer querying, reporting, or concurrent editing.
