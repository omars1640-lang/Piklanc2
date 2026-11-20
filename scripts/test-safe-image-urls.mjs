import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../js/safe-image-url.js", import.meta.url), "utf8");
const { safeImageUrl, setSafeImageSource } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const origin = "https://piklance.com";
const storage = "https://firebasestorage.googleapis.com/v0/b/piklance-c2651.firebasestorage.app/o/avatar?alt=media&token=example";
assert.equal(safeImageUrl(storage, origin), storage);
assert.equal(safeImageUrl("assets/avatar.svg", origin), origin + "/assets/avatar.svg");
assert.equal(safeImageUrl("blob:" + origin + "/preview", origin, true), "blob:" + origin + "/preview");
for (const unsafe of [
  "javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "data:image/svg+xml,<svg onload=alert(1)>",
  "https://firebasestorage.googleapis.com.evil.example/image", "https://evil.example/image",
  "https://evil@firebasestorage.googleapis.com/image", "http://firebasestorage.googleapis.com/image",
  "blob:https://evil.example/file", "blob:" + origin + "/preview", "//evil.example/image",
  "/dashboard.html", "assets/../dashboard.html", "", null
]) assert.equal(safeImageUrl(unsafe, origin), "", `Unsafe image accepted: ${unsafe}`);
assert.equal(safeImageUrl("blob:https://evil.example/file", origin, true), "");
globalThis.location = { origin };
const image = { src: "old", removeAttribute(name) { if (name === "src") this.src = ""; } };
assert.equal(setSafeImageSource(image, "javascript:alert(1)"), false);
assert.equal(image.src, "");
assert.equal(setSafeImageSource(image, storage), true);
assert.equal(image.src, storage);
for (const file of ["client-dashboard.js", "freelancer-dashboard.js", "withdrawals.js"]) {
  const code = readFileSync(new URL("../js/" + file, import.meta.url), "utf8");
  assert.ok(code.includes('from "./safe-image-url.js"'), `${file} must share image URL validation`);
}
console.log("Safe image URL tests passed: malicious schemes, hosts and foreign blobs blocked.");
