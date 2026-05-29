# Gones frontend-only backend bridge notes

The current Gones MVP runs fully in the Angular frontend. Leagues, Authorized Users, and the local session are persisted in browser `localStorage` through `ApplicationBackend`.

## Future NestJS backend path

When backend work starts:

1. Implement the API routes represented by `src/app/backend/nest-api-backend.service.ts`.
2. Move auth, role checks, persistence, validation, imports/exports, and concurrency enforcement into NestJS.
3. Provide the Nest adapter for `APP_BACKEND` so existing Angular components continue to use the same bridge.
4. Add server-side tests for authorization, stale document saves, import/restore validation, and Admin User management.
5. Keep Gones Export/Gones Restore as the user-facing backup and portability path.

Until then, local sign-in with `admin@example.com` is a browser-local convenience for editing; it is not a production security boundary.
