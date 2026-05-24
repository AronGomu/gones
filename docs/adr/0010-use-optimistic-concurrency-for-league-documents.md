# Use Optimistic Concurrency for League Documents

Gones will store each League's source data as a JSON document in Supabase, which makes concurrent edits vulnerable to lost updates if two Organizer Users save the same League at the same time. We decided to use optimistic concurrency with a document version or update timestamp and reject stale saves with a reload-before-saving message, rather than attempting real-time collaborative merging for the MVP.
