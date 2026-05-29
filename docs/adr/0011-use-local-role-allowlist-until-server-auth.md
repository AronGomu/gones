# Use Local Role Allowlist Until Server Auth Exists

Gones data should be publicly readable and downloadable, while only trusted organizers should modify source data and manage access once a server backend exists. During the frontend-only phase, local sign-in and the Authorized Users list are browser-local convenience controls, not a security boundary.

The bootstrap local Admin User is `admin@example.com`. The future Nest.js backend must replace this with server-owned authentication, authorization, and persistence while keeping the Angular UI behind the same `ApplicationBackend` bridge.
