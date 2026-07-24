# Gones frontend-only backend bridge notes

The current Gones MVP runs fully in the Angular frontend. Leagues are persisted in browser `localStorage` through `ApplicationBackend`.

## Future ASP.NET backend path

When backend work starts:

1. Implement the API routes represented by `src/app/backend/aspnet-api-backend.service.ts`.
2. Move persistence, validation, imports/exports, concurrency enforcement, and any future auth/role checks into ASP.NET.
3. Provide the ASP.NET adapter for `APP_BACKEND` so existing Angular components continue to use the same bridge.
4. Add server-side tests for stale document saves, import/restore validation, and any future Admin/Organizer access management.
5. Keep Gones Export/Gones Restore as the user-facing backup and portability path.

Until then, the MVP has no login, authentication, or role-management behavior; all edit controls are frontend-only browser-local conveniences.
