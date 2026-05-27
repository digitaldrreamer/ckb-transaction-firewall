#!/usr/bin/env node
/**
 * Assembles the Transaction Firewall governance UI into a single self-contained
 * HTML file at dist/lib/gui-bundle.html.
 *
 * The bundle includes React, ReactDOM, and Babel standalone fetched from
 * unpkg CDN (cached after first build).  JSX source files in src/lib/gui/ are
 * inlined verbatim — edit those files to change the UI.
 *
 * The sentinel comment <!-- LIVE_DATA_PLACEHOLDER --> is preserved so that
 * gui-server.ts can swap in per-request live data without re-reading the file.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import https from "node:https";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT   = join(__dir, "..");
const GUI    = join(ROOT, "src", "lib", "gui");
const CACHE  = join(ROOT, ".gui-vendor-cache");
const OUT    = join(ROOT, "dist", "lib", "gui-bundle.html");

mkdirSync(join(ROOT, "dist", "lib"), { recursive: true });
mkdirSync(CACHE, { recursive: true });

// ── vendor scripts (fetched once, cached) ────────────────────────────────────

const VENDOR = [
  {
    name: "react.js",
    url: "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
    sha256: null, // set after first successful fetch to pin the version
  },
  {
    name: "react-dom.js",
    url: "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
    sha256: null,
  },
  {
    name: "babel.js",
    url: "https://unpkg.com/@babel/standalone@7.27.1/babel.min.js",
    sha256: null,
  },
];

function fetchFile(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    function get(u) {
      https.get(u, { headers: { "User-Agent": "ckb-firewall-build/1" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode + " for " + u)); return; }
        res.on("data", c => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      }).on("error", reject);
    }
    get(url);
  });
}

async function getVendor(v) {
  const cachePath = join(CACHE, v.name);
  if (existsSync(cachePath)) {
    return readFileSync(cachePath, "utf8");
  }
  process.stdout.write("  Fetching " + v.url + " … ");
  const buf = await fetchFile(v.url);
  writeFileSync(cachePath, buf);
  console.log("done (" + Math.round(buf.length / 1024) + " KB)");
  return buf.toString("utf8");
}

// ── source files (inlined verbatim) ──────────────────────────────────────────

// Load order matters: ui → proposal-card → pages → modals → app
const SOURCES = [
  "ui.jsx",
  "proposal-card.jsx",
  "pages.jsx",
  "modals.jsx",
  "app.jsx",
];

// ── Google Fonts link ─────────────────────────────────────────────────────────

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?" +
  "family=Hanken+Grotesk:ital,wght@0,400;0,500;0,600;0,700;1,400&" +
  "family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,700;1,6..72,400;1,6..72,700&" +
  "family=JetBrains+Mono:wght@400;500&display=swap";

// ── assemble ──────────────────────────────────────────────────────────────────

console.log("Building GUI bundle…");

const [react, reactDom, babel] = await Promise.all(VENDOR.map(getVendor));

const css    = readFileSync(join(GUI, "styles.css"), "utf8");
const jsxSrcs = SOURCES.map(f => readFileSync(join(GUI, f), "utf8"));

const scriptBlocks = jsxSrcs
  .map((src, i) => `<script type="text/babel" data-type="module">\n${src}\n</script>`)
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Transaction Firewall — Governance</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${FONTS_HREF}" rel="stylesheet">
  <style>
${css}
  </style>
</head>
<body>
  <div id="root"></div>
  <!-- LIVE_DATA_PLACEHOLDER -->
  <script>${react}</script>
  <script>${reactDom}</script>
  <script>${babel}</script>
${scriptBlocks}
</body>
</html>`;

writeFileSync(OUT, html, "utf8");

const kb = Math.round(html.length / 1024);
console.log("Wrote " + OUT + " (" + kb + " KB)");
