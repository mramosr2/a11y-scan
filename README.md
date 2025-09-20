# A11y Site Scanner — Playwright + axe-core

A small HTTP service that loads a public web page in headless Chromium, runs axe-core, and returns a strict, GPT-friendly JSON report. It is designed to plug directly into a custom ChatGPT Action so that any message containing a URL can be scanned automatically and merged into an accessibility report.

## What this service does

On `POST /scan` the server launches Playwright Chromium, navigates to the requested URL, runs axe-core, maps each violation into a compact WCAG summary, and returns a single JSON object with fixed keys: `alt_text`, `snippets`, `wcag_findings`, `contrast_checks`, `image_metadata`, and `notes`. When no image is uploaded the `alt_text` fields are empty by design, and `snippets` provide copy‑paste placeholders. Two convenience endpoints exist: `GET /openapi.json` serves the Action schema for ChatGPT import, and `GET /healthz` returns a simple OK for hosting platforms.

## Quick start locally

Install dependencies, install the Chromium browser that Playwright needs, and start the server.
```bash
npm ci
npx playwright install --with-deps chromium
npm start
```
Open `http://localhost:3000/healthz` to verify. Run a scan with cURL.
```bash
curl -s -X POST http://localhost:3000/scan   -H "Content-Type: application/json"   -d '{"url":"https://example.com"}' | jq .
```

## Running in Docker

This repository includes a Dockerfile based on the official Playwright image so browsers are preinstalled. Build and run with:
```bash
docker build -t a11y-scan .
docker run -p 3000:3000 a11y-scan
```

## Deploying on Render

Connect the GitHub repo as a new Web Service and let Render auto-detect the Dockerfile. No environment variables are required. The app listens on `process.env.PORT` and exposes `/openapi.json` for the Action import. The live demo URL for this deployment is:
```
https://a11y-scan.onrender.com
```

## Using as a ChatGPT Action

In ChatGPT, open Create a GPT, go to Configure → Actions, choose Add Action, and import the schema from your live URL:
```
https://a11y-scan.onrender.com/openapi.json
```
Keep authentication as “None” unless you add your own key layer. In your GPT instructions, require the Action whenever a URL appears and return only the strict JSON object.

## API reference

`POST /scan` expects a JSON body with at least a `url` string. Optional fields include `waitUntil` with values `load`, `domcontentloaded`, or `networkidle` (default is `networkidle`), and an `emulate` object where `colorScheme` can be `light` or `dark` and `reducedMotion` can be `true` or `false`. A successful response is a single JSON object shaped for downstream tools, for example:
```json
{
  "alt_text": { "short": "", "descriptive": "", "long": "" },
  "snippets": {
    "html_img": "<img src=\"REPLACE\" alt=\"\">",
    "markdown": "![ ](REPLACE \"\")"
  },
  "wcag_findings": [
    { "wcag": "WCAG 2.1 — 1.1.1 Non-text Content (A)", "severity": "error", "where": "img.logo", "details": "Provide alt text or mark decorative." }
  ],
  "contrast_checks": [],
  "image_metadata": null,
  "notes": "Found 1 issue; address the highest-severity item first."
}
```
`GET /openapi.json` returns the OpenAPI document the GPT builder imports.
`GET /healthz` returns `{ "ok": true }`.

## Design notes

The scanner favors accuracy and a compact summary. WCAG labels are derived from axe rule tags; severity maps from axe impact levels to `error`, `warning`, or `info`. Contrast ratios are left empty unless computed explicitly, keeping the contract stable. CORS is permissive to allow calls from ChatGPT. The Playwright base image ensures predictable headless execution in containers.

## Troubleshooting

If the Action import appears to do nothing, wake the app by visiting `/openapi.json` directly, confirm the response is HTTP 200 with `Content-Type: application/json`, and try the import again. If `POST /scan` times out on a very dynamic site, set `waitUntil` to `load` and retry. When deploying elsewhere, ensure HTTPS and enable CORS.
