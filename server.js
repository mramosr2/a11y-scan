// server.js
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));

// Root info
app.get("/", (_req, res) => {
  res.type("application/json").send({
    ok: true,
    message: "A11y Site Scanner ready. POST /scan { url }"
  });
});

// Health check for Render
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Serve the OpenAPI spec (needed for GPT Actions "Import from URL")
app.get("/openapi.json", (_req, res) => {
  const specPath = path.join(__dirname, "openapi.json");
  if (!fs.existsSync(specPath)) {
    return res.status(404).type("text/plain").send("openapi.json not found");
  }
  res.type("application/json").sendFile(specPath);
});

// Scanner endpoint (matches your OpenAPI)
app.post("/scan", async (req, res) => {
  const { url, waitUntil = "networkidle", emulate } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "missing_url", message: "Body must be { url: string }" });
  }

  let browser;
  const consoleErrors = [];
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // Optional media emulation, per your schema
    if (emulate && typeof emulate === "object") {
      const colorScheme = emulate.colorScheme === "dark" ? "dark" : "light";
      const reducedMotion = emulate.reducedMotion ? "reduce" : "no-preference";
      await page.emulateMedia({ colorScheme, reducedMotion });
    }

    await page.goto(url, { waitUntil, timeout: 45000 });

    // axe-core analysis
    const axe = await new AxeBuilder({ page }).analyze();

    // very light "focus order" heuristic (ensures array exists for the schema)
    const focusOrder = await page.evaluate(() => {
      const items = [];
      const focusables = Array.from(document.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
      )).filter(el => !el.hasAttribute("disabled"));

      let index = 0;
      for (const el of focusables.slice(0, 100)) {
        const visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const role = el.getAttribute("role") || el.tagName.toLowerCase();
        const name =
          el.getAttribute("aria-label") ||
          el.getAttribute("alt") ||
          (el.textContent || "").trim().slice(0, 120);
        let selector = "";
        if (el.id) selector = `#${el.id}`;
        else if (el.classList.length) selector = `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
        else selector = el.tagName.toLowerCase();

        items.push({ index: index++, selector, role, name, visible });
      }
      return items;
    });

    res.json({
      finalUrl: page.url(),
      axe,
      focusOrder,
      unfocusableInteractive: [],   // optional — left empty for now
      contrastPairs: [],            // optional — left empty for now
      consoleErrors
    });
  } catch (err) {
    res.status(500).json({ error: "scan_failed", message: String(err) });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`A11y Site Scanner listening on ${PORT}`));
