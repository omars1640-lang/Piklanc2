import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [backend, exportsFile, browser, buyerPage, freelancerPage, adminBrowser, adminPage] = await Promise.all([
  read("functions/lib/account-deletion.js"),
  read("functions/index.js"),
  read("js/account-deletion.js"),
  read("profile.html"),
  read("freelancer-dashboard.html"),
  read("js/admin-dashboard.js"),
  read("dashboard.html")
]);

assert.match(exportsFile, /exports\.deleteOwnAccount\s*=\s*accountDeletion\.deleteOwnAccount/);
assert.match(exportsFile, /exports\.deleteUserAccountByAdmin\s*=\s*accountDeletion\.deleteUserAccountByAdmin/);
assert.match(backend, /assertRecentAuthentication\(request\.auth\)/);
assert.match(backend, /user\.role === "admin"/);
assert.match(backend, /financialDeletionBlockers/);
assert.match(backend, /getAuth\(\)\.deleteUser\(uid\)/);

for (const collection of [
  "users", "publicProfiles", "services", "reviews", "supportTickets", "chats",
  "wallets", "walletLedger", "depositRequests", "withdrawalRequests", "referrals",
  "userBenefits", "accountBenefits", "notifications", "favorites", "payoutMethods"
]) {
  assert.ok(backend.includes(collection), `Missing account-deletion coverage for ${collection}`);
}

for (const prefix of [
  "identity", "profile-images", "service-images", "freelancer-portfolio",
  "portfolio-media", "portfolio-images", "payout-qr"
]) {
  assert.ok(backend.includes(`${prefix}/`), `Missing Storage cleanup for ${prefix}`);
}

assert.match(backend, /where\("referredByUid", "==", uid\)/);
assert.match(backend, /accountDeletedAt/);
assert.match(backend, /accountHolderName: accountName/);
assert.match(backend, /userName: accountName/);
assert.match(backend, /walletLedger/);
assert.doesNotMatch(backend, /deleteStoragePrefix\(`payment-receipts\/\$\{uid\}\//);
assert.doesNotMatch(backend, /deleteStoragePrefix\(`payout-evidence\/\$\{uid\}\//);
assert.match(browser, /reauthenticateWithCredential/);
assert.match(browser, /httpsCallable\(functions, "deleteOwnAccount"/);
assert.match(backend, /requireAdmin\(request, "users\.manage"\)/);
assert.match(backend, /userId === admin\.id/);
assert.match(adminBrowser, /httpsCallable\(functions, "deleteUserAccountByAdmin"/);
assert.match(adminBrowser, /user\.role !== "admin"/);
assert.match(adminBrowser, /reauthenticateWithCredential/);
assert.match(adminPage, /id="decisionEmailConfirmation"/);
assert.match(adminPage, /id="decisionAdminPassword"/);
assert.match(adminPage, /value="delete_user"/);

for (const page of [buyerPage, freelancerPage]) {
  assert.match(page, /id="deleteAccountButton"/);
  assert.match(page, /id="accountDeletionModal"/);
  assert.match(page, /id="deleteAccountConfirmation"/);
  assert.match(page, /id="deleteAccountPassword"/);
}

console.log("Account deletion architecture checks passed.");
