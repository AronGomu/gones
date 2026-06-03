# Supersede Local Role Allowlist for the Frontend-Only MVP

Gones data remains publicly readable and downloadable. For the first frontend-only MVP, source-data editing is also available directly in the browser without login, authentication, or role-management UI.

This supersedes the earlier local role allowlist decision. Admin and Organizer remain product design concepts for the future backend-backed experience, but the Angular MVP no longer stores authorized users, creates local sessions, gates edit controls by role, or exposes `/admin/users`.

The future Nest.js backend can reintroduce server-owned authentication, authorization, and persistence behind the `ApplicationBackend` bridge when those controls become part of the production scope.
