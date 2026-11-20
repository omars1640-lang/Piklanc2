const { copyFileSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { PUBLIC_PAGES } = require("../functions/lib/public-page-config");
const root = path.resolve(__dirname, "..");
const destination = path.join(root, "functions/public-pages");
mkdirSync(destination, { recursive: true });
for (const route of PUBLIC_PAGES) {
  const file = route === "/" ? "index.html" : route.slice(1);
  copyFileSync(path.join(root, file), path.join(destination, file));
}
// Keep a source fingerprint so deployment/tests catch stale copies, not a second editable UI.
const { createHash } = require("node:crypto");
const hashes = Object.fromEntries(PUBLIC_PAGES.map(route => {
  const file = route === "/" ? "index.html" : route.slice(1);
  return [file, createHash("sha256").update(readFileSync(path.join(destination, file))).digest("hex")];
}));
writeFileSync(path.join(destination, "manifest.json"), JSON.stringify(hashes, null, 2) + "\n");
console.log(`Prepared ${PUBLIC_PAGES.length} current public-page templates for Functions.`);
