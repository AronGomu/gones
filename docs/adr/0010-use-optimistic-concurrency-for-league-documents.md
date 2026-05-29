# Use Optimistic Concurrency for League Documents

Gones stores each League's source data as a versioned JSON document. Even in the frontend-only implementation, saves compare an expected `documentVersion` so the UI keeps the same conflict contract that the later Nest.js backend should enforce. If two editing sessions try to save stale League data, the app rejects the stale save with a reload-before-saving message rather than attempting real-time collaborative merging.
