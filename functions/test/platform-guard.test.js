const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const guardSource = fs.readFileSync(path.join(root, "js/platform-guard.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace("export const platformReady", "const platformReady");
const policySource = fs.readFileSync(path.join(root, "js/access-policy.js"), "utf8").replace(/export /g, "");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function runGuard({ mode, page = "/", config = {}, profile = null, user = null, error = false, hang = false } = {}) {
  const calls = { revealed: false, bootstrapRemoved: false, redirect: "", subscribed: false, callback: null };
  const context = {
    document: {
      documentElement: { dataset: { platformMode: mode }, setAttribute: (key, value) => { if (key === "data-platform-access") calls.revealed = value === "ready"; } },
      getElementById: () => ({ remove: () => { calls.bootstrapRemoved = true; } })
    },
    location: { pathname: page, search: "", hash: "", origin: "https://piklance.com", replace: url => { calls.redirect = url; } },
    onSnapshot: (ref, next, fail) => {
      calls.subscribed = true; calls.callback = next;
      if (!hang) queueMicrotask(() => error ? fail(new Error("simulated offline")) : next({ exists: () => true, data: () => config }));
      return () => {};
    },
    onAuthStateChanged: (auth, callback) => { queueMicrotask(() => callback(user)); return () => {}; },
    getDoc: async () => ({ exists: () => Boolean(profile), data: () => profile }),
    doc: (...parts) => parts, auth: {}, db: {}, URL, URLSearchParams,
    console: { warn() {} }
  };
  const execute = new AsyncFunction(...Object.keys(context), `${policySource}\n${guardSource}\nreturn platformReady;`);
  calls.allowed = await execute(...Object.values(context));
  return calls;
}

test("SSR-open pages are usable even when Firestore never calls back, without disabling live mode changes", async () => {
  const result = await runGuard({ mode: "open", hang: true });
  assert.equal(result.allowed, true);
  assert.equal(result.revealed, true);
  assert.equal(result.bootstrapRemoved, true);
  assert.equal(result.subscribed, true);
  await result.callback({ exists: () => true, data: () => ({ maintenanceMode: true }) });
  assert.ok(result.redirect.startsWith("/maintenance.html"));
});

test("maintenance allows the admin but not an ordinary or early-access account", async () => {
  for (const role of [null, "buyer", "freelancer", "admin"]) {
    const result = await runGuard({ mode: "maintenance", config: { maintenanceMode: true }, user: role ? { uid: "user" } : null, profile: { role, earlyAccess: true } });
    assert.equal(result.allowed, role === "admin");
    assert.equal(result.revealed, role === "admin");
    assert.equal(result.redirect.startsWith("/maintenance.html"), role !== "admin");
  }
});

test("prelaunch preserves admin/early-access admission and the registration flow", async () => {
  for (const [profile, expected] of [[{ role: "admin" }, true], [{ role: "freelancer", earlyAccess: true }, true], [{ role: "buyer" }, false]]) {
    const result = await runGuard({ mode: "prelaunch", config: { prelaunchMode: true }, user: { uid: "user" }, profile });
    assert.equal(result.allowed, expected);
    if (!expected) assert.ok(result.redirect.startsWith("/coming-soon.html"));
  }
  assert.equal((await runGuard({ page: "/register.html", config: { prelaunchMode: true } })).allowed, true);
  assert.equal((await runGuard({ page: "/login.html", config: { maintenanceMode: true } })).allowed, true);
});

test("a failed client read never fails open over the server's maintenance/prelaunch decision", async () => {
  for (const [mode, redirect] of [["maintenance", "/maintenance.html"], ["prelaunch", "/coming-soon.html"]]) {
    const result = await runGuard({ mode, error: true });
    assert.equal(result.allowed, false);
    assert.equal(result.revealed, false);
    assert.ok(result.redirect.startsWith(redirect));
  }
  assert.equal((await runGuard({ error: true })).allowed, true, "legacy post-launch fallback must remain compatible");
});
