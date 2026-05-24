# Host the Angular SPA on Cloudflare Pages

Gones will use Supabase for backend services and does not need a custom always-on web server. We decided to host the Angular single-page application on Cloudflare Pages because expected traffic is very low, the free tier is sufficient, GitHub integration and SPA fallback support are straightforward, and Supabase separately provides Auth, PostgreSQL, and access control.
