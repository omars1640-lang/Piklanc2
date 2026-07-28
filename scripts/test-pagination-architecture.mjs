import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = path => readFileSync(resolve(root, path), "utf8");

const cookie = read("js/cookie-consent.js");
const services = read("js/services-marketplace.js");
const freelancers = read("js/freelancers-marketplace.js");
const home = read("js/home-marketplace.js");
const admin = read("js/admin-dashboard.js");
const operations = read("js/admin-operations.js");
const payments = read("js/admin-payments.js");
const client = read("js/client-dashboard.js");
const freelancerDashboard = read("js/freelancer-dashboard.js");
const messages = read("js/messages.js");

assert.match(cookie, /cookie-consent\.css/, "Cookie consent must load its own stylesheet");
assert.match(services, /startAfter\(state\.cursor\)/, "Services marketplace must use cursor pagination");
assert.match(services, /limit\(FETCH_SIZE \+ 1\)/, "Services marketplace must cap each fetch");
assert.doesNotMatch(services, /getDocs\(collection\(db,\s*["']publicProfiles["']\)\)/, "Services must not load every public profile");
assert.match(freelancers, /startAfter\(state\.cursor\)/, "Freelancers marketplace must use cursor pagination");
assert.match(freelancers, /limit\(FETCH_SIZE \+ 1\)/, "Freelancers marketplace must cap each fetch");
assert.doesNotMatch(home, /getDocs\(query\(collection\(db,\s*["']publicProfiles["']\),\s*where\(["']accountType/, "Homepage must not load all freelancers");
assert.match(home, /getCountFromServer/, "Homepage totals must use aggregate counts");
assert.match(admin, /loadAdminCollectionPage/, "Admin users, chats and audit must support loading more");
assert.match(operations, /loadOperationPage/, "Admin operations must support loading more");
assert.match(payments, /loadMorePayments/, "Admin payments must support loading more");
assert.match(client, /loadClientPage/, "Client dashboard must use paged workspace queries");
assert.match(freelancerDashboard, /loadFreelancerPage/, "Freelancer dashboard must use paged workspace queries");
assert.match(messages, /limitToLast\(MESSAGE_PAGE_SIZE\)/, "Messages must only subscribe to the latest page");
assert.match(messages, /loadOlderMessages/, "Messages must support loading older pages");
assert.match(messages, /loadOlderConversations/, "Conversations must support loading older pages");

console.log("Pagination and progressive-loading regression checks passed.");
