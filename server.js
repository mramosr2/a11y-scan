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

app.get("/", (_req, res) => {
  res.type("application/json").send({ ok: true, message: "A11y Site Scanner ready. POST /scan { url }" });
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Serve the OpenAPI spec for GPT Actions
app.get("/openapi.json", (_req, res) => {
  const specPath = path.join(__dirname, "openapi.json");
  if (!fs.existsSync(specPath)) return res.status(404).type("text/plain").send("openapi.json not found");
  res.type("application/json").sendFile(specPath);
});

// Helper: map axe tags → WCAG code and level
function wcagFromTags(tags = [], help = "") {
  const codeTag = tags.find(t => /^wcag\d{3,4}$/i.test(t));            // e.g., wcag131
  const digits = codeTag ? (codeTag.match(/\d{3,4}/) || [])[0] : null; // "131"
  const code = digits
    ? digits.length === 3
      ? `${digits[0]}.${digits[1]}.${digits[2]}`
      : `${digits[0]}.${digits[1]}.${digits[2]}.${digits[3]}`
    : null;

  const levelTag = tags.find(t => /^wcag2(aa|aaa|a)$/i.test(t)) || ""; // wcag2aa, wcag2a, wcag2aaa
  const level = /aaa/i.test(levelTag) ? "AAA" : /aa/i.test(levelTag) ? "AA" : "A";

  const name = help || "";
  const label = code ? `WCAG 2.1 — ${code} ${name} (${level})` : `WCAG 2.1 — ${name || "Unmapped"} (${level})`;
  return { label, level, code };
}

// Scanner that returns the STRICT JSON CONTRACT directly
app.post("/scan", async (req, res) => {
  const { url, waitUntil = "networkidle", emulate } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "missing_url", message: "Body must be { url: string }" });
  }

  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const context = await browser.newContext();
    const page = await context.newPage();

    if (emulate && typeof emulate === "object") {
      const colorScheme = emulate.colorScheme === "dark" ? "dark" : "light";
      const reducedMotion = emulate.reducedMotion ? "reduce" : "no-preference";
      await page.emulateMedia({ colorScheme, reducedMotion });
    }

    await page.goto(url, { waitUntil, timeout: 45000 });

    const axe = await new AxeBuilder({ page }).analyze();

    const wcag_findings = [];
    for (const v of axe.violations || []) {
      const { label } = wcagFromTags(v.tags || [], v.help || "");
      const impactMap = { critical: "error", serious: "error", moderate: "warning", minor: "info" };
      const severity = impactMap[v.impact] || "info";
      const node = (v.nodes && v.nodes[0]) || {};
      const where = Array.isArray(node.target) && node.target.length ? node.target.join(" ") : v.id;
      const details = node.failureSummary || v.help || v.description || v.id;
      wcag_findings.push({ wcag: label, severity, where, details });
    }

    const result = {
      alt_text: { short: "", descriptive: "", long: "" },
      snippets: {
        html_img: "<img src=\"REPLACE\" alt=\"\">",
        markdown: "![ ](REPLACE \"\")"
      },
      wcag_findings,
      contrast_checks: [],           // leave empty unless you compute real ratios
      image_metadata: null,
      notes: wcag_findings.length
        ? `Found ${wcag_findings.length} issues; address the highest-severity items first.`
        : "No violations reported by axe-core on this page."
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "scan_failed", message: String(err) });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`A11y Site Scanner listening on ${PORT}`));
