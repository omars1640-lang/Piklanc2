import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = file => readFileSync(resolve(root, file), "utf8");
const failures = [];
const warnings = [];

function requirePattern(file, pattern, message) {
  if (!pattern.test(read(file))) failures.push(`${file}: ${message}`);
}

function forbidPattern(file, pattern, message) {
  if (pattern.test(read(file))) failures.push(`${file}: ${message}`);
}

requirePattern("firestore.rules", /function isAdmin\(\)[\s\S]{0,300}status == "active"/, "admin access must require an active account");
requirePattern("storage.rules", /function isAdmin\(\)[\s\S]{0,400}status == "active"/, "Storage admin access must require an active account");
requirePattern("storage.rules", /adminRoles[\s\S]{0,300}get\("active", true\) != false/, "Storage must reject disabled admin roles");
requirePattern("firestore.rules", /match \/launchSubscribers\/\{subscriberId\}[\s\S]{0,120}allow create: if false;/, "launch signup must be server-only");
requirePattern("firestore.rules", /match \/supportTickets\/\{ticketId\}[\s\S]{0,120}allow create: if false;/, "support ticket creation must be server-only");
requirePattern("firestore.rules", /match \/orders\/\{orderId\}[\s\S]{0,400}allow update: if false;/, "financial order state changes must be server-only");
requirePattern("firestore.rules", /match \/reviews\/\{reviewId\}[\s\S]{0,300}allow create: if false;/, "order reviews must be server-verified");
requirePattern("firestore.rules", /match \/articleViews\/\{viewId\}[\s\S]{0,100}allow read, write: if false;/, "article views must be counted server-side");
requirePattern("firestore.rules", /match \/promoCodes\/\{codeId\}[\s\S]{0,500}allow update: if hasAdminPermission\("promotions\.manage"\);/, "promo code consumption must be server-only");
forbidPattern("firestore.rules", /match \/promoCodes\/\{codeId\}[\s\S]{0,120}allow get: if true;/, "promo code documents can contain private usage data and must not be public");
requirePattern("storage.rules", /match \/payout-evidence\/[\s\S]{0,350}allow create, update: if false;/, "withdrawal evidence must be immutable to clients");
requirePattern("firebase.json", /Content-Security-Policy/, "hosting must define a CSP");
requirePattern("firebase.json", /X-Content-Type-Options/, "hosting must disable MIME sniffing");
requirePattern("js/messages.js", /parsed\.protocol === "https:"[\s\S]{0,120}firebasestorage\.googleapis\.com/, "attachment links must be restricted to trusted HTTPS Storage URLs");
requirePattern("firestore.rules", /imageUrl\.matches\("\^https:\/\/firebasestorage/, "service image URLs must use trusted Storage hosting");
requirePattern("functions/lib/public-endpoints.js", /category === "dispute"[\s\S]{0,500}buyerUid[\s\S]{0,100}freelancerUid/, "support disputes must be bound to an order participant");
requirePattern("functions/lib/email.js", /admin_mail_[\s\S]{0,800}count >= 100/, "admin email must have a server-side daily limit");
requirePattern("functions/lib/email.js", /\["piklance\.com", "www\.piklance\.com"\]\.includes/, "admin email action links must be same-brand HTTPS URLs");
requirePattern("js/admin-dashboard.js", /function safeCsvCell[\s\S]{0,240}const neutralized =/, "CSV exports must neutralize spreadsheet formulas");
requirePattern("maintenance.html", /parsed\.origin===location\.origin/, "maintenance return URLs must remain same-origin");
requirePattern("firestore.rules", /request\.resource\.data\.name == userAfter\(userId\)\.name/, "public display names must be bound to the private owner profile");
forbidPattern("js/messages.js", /innerHTML\s*=\s*`[^`]*\$\{error\./s, "runtime errors must not be injected into HTML");

for (const file of ["js/admin-dashboard.js", "js/admin-operations.js"]) {
  forbidPattern(file, /innerHTML\s*=\s*`[^`]*\$\{(?:badge\.|code\.|log\.|auditDescription\(|value\})/s, "untrusted Firestore data must not be interpolated into innerHTML");
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules", "_backup_20260709", "_restore_preview", "_pre_restore_safety"].includes(entry.name)) return [];
      return walk(full);
    }
    return statSync(full).size <= 2_000_000 ? [full] : [];
  });
}

const sourceFiles = walk(root).filter(file => [".js", ".mjs", ".html", ".json", ".rules", ".yml", ".yaml"].includes(extname(file)) || file.endsWith(".rules"));
const secretPatterns = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
  [/\bgh[opusr]_[A-Za-z0-9_]{30,}\b/, "GitHub token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key outside approved Firebase config"]
];
for (const file of sourceFiles) {
  const relativeFile = relative(root, file).replaceAll("\\", "/");
  const source = readFileSync(file, "utf8");
  for (const [pattern, label] of secretPatterns) {
    if (label.startsWith("Google") && relativeFile === "js/firebase.js") continue;
    if (pattern.test(source)) failures.push(`${relativeFile}: possible committed ${label}`);
  }
  const firebaseImports = [...source.matchAll(/firebasejs\/(\d+\.\d+\.\d+)\//g)].map(match => match[1]);
  if (firebaseImports.some(version => version !== "12.16.0")) {
    failures.push(`${relativeFile}: outdated or mixed Firebase browser SDK import`);
  }
}

const functionsSource = sourceFiles
  .filter(file => relative(root, file).replaceAll("\\", "/").startsWith("functions/lib/") && extname(file) === ".js")
  .map(file => readFileSync(file, "utf8")).join("\n");
if (/enforceAppCheck:\s*false/.test(functionsSource)) failures.push("Functions: hard-coded App Check bypass found");
if (!/ENFORCE_APP_CHECK/.test(functionsSource)) failures.push("Functions: deploy-time App Check enforcement switch is missing");

const firebaseSource = read("js/firebase.js");
if (/appCheckSiteKey:\s*""/.test(firebaseSource)) warnings.push("App Check is prepared but needs a reCAPTCHA Enterprise site key before ENFORCE_APP_CHECK=true");
if (/'unsafe-inline'/.test(read("firebase.json"))) warnings.push("CSP still permits inline scripts during the compatibility migration; externalize inline page modules to remove it");

if (warnings.length) {
  console.warn("Security warnings:\n" + warnings.map(item => `- ${item}`).join("\n"));
}
if (failures.length) {
  console.error("Security audit failed:\n" + failures.map(item => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`Security audit passed (${sourceFiles.length} files scanned, ${warnings.length} deployment warning(s)).`);
