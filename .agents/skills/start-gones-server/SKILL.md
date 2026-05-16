---
name: start-gones-server
description: Start the Gones Vite development server and report the correct browser URL. Use when the user asks to start, run, serve, open, or check the local Gones application server.
---

# Start Gones Server

Use this skill when the user wants the Gones application server started or wants the local URL.

## Procedure

1. Check whether the dev server is already running:
   ```bash
   ps -ef | grep -E "vite|npm run dev" | grep -v grep || true
   ```

2. If it is not running, start it from the project root:
   ```bash
   nohup npm run dev > /tmp/gones-vite.log 2>&1 & echo $!
   ```

3. Wait briefly, then inspect the log:
   ```bash
   sleep 1; tail -40 /tmp/gones-vite.log
   ```

4. When reporting the URL to the user, always append `/app` to the Vite local URL.
   - If Vite reports `http://127.0.0.1:5173/`, report:
     `http://127.0.0.1:5173/app`
   - If Vite reports another port, keep that host and port and still append `/app`.

## Response format

Reply concisely with:

```text
Server started.
URL: http://127.0.0.1:<port>/app
```

If the server was already running, reply:

```text
Server is already running.
URL: http://127.0.0.1:<port>/app
```
