# Store League Source Data as JSON Documents

Gones source data is already versioned, exported, restored, and recalculated as serializable plain data. We decided to keep each League's source data as one versioned JSON document behind the backend bridge rather than normalizing Tournaments, Rounds, and Round Entries immediately. This preserves the current export/restore model and keeps the later ASP.NET backend free to persist the same document shape first, then introduce normalized reporting tables only if richer querying or concurrent editing requires them.
