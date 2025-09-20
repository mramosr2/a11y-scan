A11y Site Scanner — Headless API
================================

What this is
A small Node + Playwright + axe-core server that loads a URL, runs an automated accessibility scan, simulates Tab to capture focus order, checks for unfocusable interactive elements, and samples text contrast. You can deploy it anywhere that supports Docker (Render, Fly.io, Railway, your VPS).

Local run without Docker
1. Install Node 18+.
2. Run: npm install
3. Install Playwright Chromium and dependencies: npx playwright install --with-deps chromium
4. Start: npm start  (server listens on http://localhost:3000)
5. Test: curl -X POST http://localhost:3000/scan -H "content-type: application/json" -d '{"url":"https://example.com"}'

Local run with Docker
1. Build: docker build -t a11y-site-scanner .
2. Run: docker run --rm -p 3000:3000 a11y-site-scanner
3. Test: curl as above to localhost:3000.

Deploy (Docker-friendly platforms like Render/Fly/Railway)
1. Create a new web service from this repo, set port to 3000.
2. Ensure the service has at least 1GB RAM for Playwright on big pages.
3. Optional environment variables: none required.
4. After deploy, note the public URL, e.g., https://your-app.onrender.com

OpenAPI for ChatGPT Actions
Use the provided openapi.json. Replace https://YOUR_DOMAIN with your service URL.

Security and etiquette
Only scan pages you have permission to test. Respect robots and site terms. Rate-limit your scans. This tool captures only page errors, focus order, and summary results; do not store personal data.

Mapping to your GPT
In Create a GPT → Configure → Actions, upload openapi.json, set server to your URL, and save. Add to your GPT instructions: "When a user provides a URL, call the 'scan' Action and summarize results into our JSON contract with WCAG mappings and minimal fixes."

Notes
• The contrast sampler is a heuristic; for precise results, let the GPT perform targeted checks on specific selectors after the initial scan.
• Focus traps are guessed when Tab order repeats quickly or stalls; confirm manually.# a11y-scan
# a11y-scan
