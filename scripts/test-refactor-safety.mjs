import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = path => readFileSync(resolve(root, path), "utf8");
const lines = source => source.split(/\r?\n/).length;

function quotedValues(source) {
  return [...source.matchAll(/["']([a-z]+\.[a-z]+)["']/g)].map(match => match[1]);
}

function sourceBlock(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} block must remain discoverable`);
  return match[1];
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

const accessPolicySource = read("js/access-policy.js");
const accessPolicyUrl = `data:text/javascript;base64,${Buffer.from(accessPolicySource).toString("base64")}`;
const { platformAccessDecision } = await import(accessPolicyUrl);

const accessCases = [
  [{ page: "index.html", maintenanceMode: true, prelaunchMode: false }, "maintenance"],
  [{ page: "index.html", maintenanceMode: true, prelaunchMode: false, role: "admin" }, "allow"],
  [{ page: "index.html", maintenanceMode: false, prelaunchMode: true }, "coming-soon"],
  [{ page: "register.html", maintenanceMode: false, prelaunchMode: true }, "allow"],
  [{ page: "index.html", maintenanceMode: false, prelaunchMode: true, earlyAccess: true }, "allow"],
  [{ page: "coming-soon.html", maintenanceMode: false, prelaunchMode: true, earlyAccess: true }, "platform"],
  [{ page: "register.html", maintenanceMode: false, prelaunchMode: false }, "allow"],
  [{ page: "coming-soon.html", maintenanceMode: false, prelaunchMode: false }, "platform"]
];

for (const [input, expected] of accessCases) {
  assert.equal(platformAccessDecision(input), expected, `Unexpected platform decision for ${JSON.stringify(input)}`);
}

const guard = read("js/platform-guard.js");
assert.match(guard, /configuration\.maintenanceMode === true/, "Maintenance mode must require an explicit true value");
assert.match(guard, /configuration\.prelaunchMode === true/, "Prelaunch mode must require an explicit true value");
assert.match(guard, /platformAccessDecision\(\{ page, maintenanceMode: false, prelaunchMode: false \}\)/, "Platform guard must fail open after launch when settings cannot be read");
assert.doesNotMatch(guard, /prelaunchMode\s*=\s*configuration\.prelaunchMode\s*!==\s*false/, "Missing settings must not reactivate prelaunch mode");

const register = read("register.html");
[
  'id="typeSelection"',
  'id="buyerForm"',
  'id="freelancerForm"',
  'class="type-btn buyer active"',
  'class="type-btn freelancer"',
  'aria-pressed="true"',
  'aria-pressed="false"'
].forEach(contract => assert.ok(register.includes(contract), `Registration contract missing: ${contract}`));
assert.match(register, /if \(!code\) return;/, "Registration access or referral code must remain optional");
assert.doesNotMatch(register, /location\.replace\(["']coming-soon\.html["']\)/, "Public registration must not hard-redirect to the retired countdown page");

const dashboard = read("dashboard.html");
const adminAccess = read("js/admin-access.js");
const adminDashboard = read("js/admin-dashboard.js");
const adminOperations = read("js/admin-operations.js");
const freelancerDashboard = read("js/freelancer-dashboard.js");

const navSections = sortedUnique([...dashboard.matchAll(/data-section=["']([a-z-]+)["']/g)].map(match => match[1]));
const panelSections = new Set([...dashboard.matchAll(/id=["']([a-z-]+)-section["']/g)].map(match => match[1]));
for (const section of navSections) {
  assert.ok(panelSections.has(section), `Admin navigation section ${section} must have a matching panel`);
  assert.match(adminAccess, new RegExp(`\\b${section}\\s*:`), `Admin section ${section} must have an access mapping`);
}

const backendTeam = read("functions/lib/team.js");
const adminTeam = read("js/admin-team.js");
const backendPermissions = sortedUnique(quotedValues(sourceBlock(
  backendTeam,
  /const PERMISSIONS = new Set\(\[([\s\S]*?)\]\);/,
  "Backend permissions"
)));
const uiPermissions = sortedUnique(quotedValues(sourceBlock(
  adminTeam,
  /const permissionGroups = \[([\s\S]*?)\n\];/,
  "Admin permission groups"
)));
assert.deepEqual(uiPermissions, backendPermissions, "Assignable admin permissions must match between the dashboard and Cloud Functions");

const wallet = read("functions/lib/wallet.js");
const orders = read("functions/lib/orders.js");
assert.match(wallet, /const DEPOSIT_MIN = 1;/, "New-lira deposit minimum must remain 1 SYP");
assert.match(wallet, /const DEPOSIT_MAX = 100;/, "New-lira deposit maximum must remain 100 SYP");
assert.match(wallet, /const WITHDRAWAL_MIN = 1;/, "New-lira withdrawal minimum must remain 1 SYP");
assert.match(wallet, /const WITHDRAWAL_MAX = 50;/, "New-lira withdrawal maximum must remain 50 SYP");
assert.match(wallet, /providerId !== ["']sham_cash["']/, "Manual wallet funding must keep Sham Cash as the supported provider");
assert.match(orders, /const REVIEW_DAYS = 15;/, "Order review hold must remain 15 days");
assert.match(orders, /settings\.platformFeePercent/, "Order commission must come from platform settings");
assert.match(orders, /commissionDiscountPercent/, "Order commission must keep account benefit discounts");

const guardedPages = [
  "index.html",
  "services.html",
  "freelancers.html",
  "service-details.html",
  "freelancer-profile.html",
  "register.html"
];
const siteHeader = read("js/site-header.js");
assert.match(siteHeader, /import ["']\.\/platform-guard\.js["']/, "Shared site header must keep loading the platform access guard");
for (const page of guardedPages) {
  const source = read(page);
  const loadsGuard = /js\/platform-guard\.js/.test(source) || /js\/site-header\.js/.test(source);
  assert.ok(loadsGuard, `${page} must load the platform access guard directly or through the shared site header`);
}

const sizeBudgets = [
  ["js/admin-dashboard.js", adminDashboard, 1900],
  ["js/admin-operations.js", adminOperations, 1250],
  ["js/freelancer-dashboard.js", freelancerDashboard, 1300]
];
for (const [path, source, maximum] of sizeBudgets) {
  assert.ok(lines(source) <= maximum, `${path} exceeded its temporary refactoring budget of ${maximum} lines`);
}

console.log(`Refactor safety contracts passed (${accessCases.length} access decisions, ${backendPermissions.length} assignable permissions, ${guardedPages.length} guarded pages).`);
