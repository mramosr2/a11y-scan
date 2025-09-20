// server.js (full file, ESM)
// Requires: "type": "module" in package.json

import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({ ok: true, message: "A11y Site Scanner ready. POST /scan { url }" });
});

app.post("/scan", async (req, res) => {
  let browser, context, page;
  try {
    const { url, waitUntil = "networkidle", emulate } = req.body || {};
    if (!url) return res.status(400).json({ error: "url required" });

    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    context = await browser.newContext();
    page = await context.newPage();

    const consoleErrors = [];
    page.on("pageerror", e => consoleErrors.push(String(e)));
    page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });

    if (emulate?.colorScheme) await page.emulateMedia({ colorScheme: emulate.colorScheme });
    if (emulate?.reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto(url, { waitUntil, timeout: 60000 });

    // axe-core works with a Page created from a Context
    const axeResults = await new AxeBuilder({ page }).include("body").analyze();

    // ---- Tab focus order
    const focusOrder = [];
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      await page.keyboard.press("Tab");
      const el = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a) return null;
        const role = a.getAttribute("role") || a.tagName.toLowerCase();
        const name = a.getAttribute("aria-label") || (a.innerText || "").trim().slice(0, 120);
        const visible = !!(a.offsetWidth || a.offsetHeight || a.getClientRects().length);
        const path = [];
        let n = a; 
        while (n && n.nodeType === 1) { path.unshift(`${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}`); n = n.parentElement; }
        const selector = path.join(" > ");
        return { role, name, visible, selector };
      });
      if (!el) break;
      const key = el.selector + "|" + el.name;
      if (seen.has(key)) break;
      seen.add(key);
      focusOrder.push({ index: i + 1, ...el });
    }

    // ---- Unfocusable interactive candidates
    const unfocusableInteractive = await page.evaluate(() => {
      const isFocusable = el => {
        const s = window.getComputedStyle(el);
        if (s.visibility === "hidden" || s.display === "none") return false;
        if (el.hasAttribute("disabled")) return false;
        const ti = el.getAttribute("tabindex");
        if (ti === "-1") return false;
        return el.tabIndex >= 0;
      };
      const hasClick = el => !!(el.onclick || el.getAttribute("role") === "button" || el.getAttribute("onclick"));
      const bad = [];
      document.querySelectorAll("a,button,input,select,textarea,[role='button'],[onclick]").forEach(el => {
        const interactive = hasClick(el) || ["a","button","input","select","textarea","summary"].includes(el.tagName.toLowerCase());
        if (interactive && !isFocusable(el)) bad.push(el.outerHTML.slice(0, 200));
      });
      return bad.slice(0, 100);
    });

    // ---- Quick contrast sampling
    const contrastPairs = await page.evaluate(() => {
      function srgbToLin(c){ c/=255; return c<=0.03928? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }
      function lum(hex){
        const m = /^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i.exec(hex);
        if(!m) return null;
        const [r,g,b]=[parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16)].map(srgbToLin);
        return 0.2126*r + 0.7152*g + 0.0722*b;
      }
      function ratio(fg,bg){ const L1 = lum(fg), L2 = lum(bg); if(L1==null||L2==null) return null;
        const hi = Math.max(L1,L2), lo = Math.min(L1,L2); return Number(((hi+0.05)/(lo+0.05)).toFixed(2)); }
      function toHex(rgb){
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb); if(!m) return null;
        return "#" + [m[1],m[2],m[3]].map(n => Number(n).toString(16).padStart(2,"0")).join("");
      }
      const results = [];
      document.querySelectorAll("*").forEach(el => {
        const style = getComputedStyle(el);
        if (style.visibility !== "visible" || style.display === "none") return;
        if (!el.textContent || !el.textContent.trim()) return;
        const fg = toHex(style.color); 
        let bg = toHex(style.backgroundColor);
        let p = el;
        while(!bg && p && p.parentElement){
          p = p.parentElement;
          bg = toHex(getComputedStyle(p).backgroundColor);
        }
        if (!bg) bg = "#ffffff";
        if (!fg) return;
        const r = ratio(fg,bg); if (!r) return;
        const meets = []; if (r >= 4.5) meets.push("AA"); if (r >= 3) meets.push("Large AA"); if (r >= 7) meets.push("AAA");
        if (r < 4.5) results.push({ selector: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""), fg, bg, ratio: r, meets });
      });
      return results.slice(0, 100);
    });

    const finalUrl = page.url();

    await context.close();
    await browser.close();

    res.json({ finalUrl, axe: axeResults, focusOrder, unfocusableInteractive, contrastPairs, consoleErrors });
  } catch (err) {
    console.error(err);
    try { if (context) await context.close(); } catch {}
    try { if (browser) await browser.close(); } catch {}
    res.status(500).json({ error: String(err), stack: err?.stack });
  }
});

process.on("unhandledRejection", e => console.error("UNHANDLED REJECTION:", e));
process.on("uncaughtException", e => console.error("UNCAUGHT EXCEPTION:", e));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`A11y Site Scanner listening on http://localhost:${PORT}`));
