import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = path => readFileSync(resolve(root, path), "utf8");

const admin = read("js/admin-operations.js");
const blog = read("js/blog-content.js");
const rules = read("firestore.rules");
const functions = read("functions/lib/articles.js");

assert.doesNotMatch(admin, /getDocs\(collection\(db,\s*["']articles["']\)\)/, "Admin must not load the full articles collection");
assert.match(admin, /state\.articleSaving/, "Article submission must have an in-flight lock");
assert.match(admin, /startAfter\(state\.articleCursor\)/, "Admin article list must use cursor pagination");
assert.doesNotMatch(blog, /onSnapshot\(/, "The blog index must not listen to the full articles collection");
assert.doesNotMatch(blog, /articles["'],\s*article\.id,\s*["']likes/, "The blog index must use stored counters rather than N+1 reads");
assert.match(rules, /match \/articleBodies\/\{articleId\}/, "Article bodies need dedicated access rules");
assert.match(functions, /adminOperations\//, "Article writes must be idempotent");
assert.match(functions, /recursiveDelete/, "Permanent deletion must cascade on the server");

console.log("Content scalability regression checks passed.");
