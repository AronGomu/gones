# Host the Angular SPA on Cloudflare Pages

Gones currently runs as a static frontend-only Angular application. We decided to host the single-page application on Cloudflare Pages because expected traffic is very low, the free tier is sufficient, GitHub integration and SPA fallback support are straightforward, and the later Nest.js backend can be deployed independently when it exists.
