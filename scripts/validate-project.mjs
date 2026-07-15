import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const htmlFiles = readdirSync(root).filter(file => extname(file) === ".html");
const errors = [];

function cleanReference(value) {
  return value.split("#", 1)[0].split("?", 1)[0].trim();
}

function isLocalReference(value) {
  return value
    && !value.startsWith("#")
    && !value.startsWith("//")
    && !/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(value)
    && !value.includes("${");
}

for (const file of htmlFiles) {
  const source = readFileSync(resolve(root, file), "utf8");
  const ids = [...source.matchAll(/\bid=["']([^"']+)["']/gi)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) errors.push(`${file}: duplicate ids: ${duplicates.join(", ")}`);

  const references = [...source.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)].map(match => match[1]);
  for (const rawReference of references) {
    if (!isLocalReference(rawReference)) continue;
    const reference = cleanReference(rawReference);
    if (!reference || reference.endsWith("/")) continue;
    const projectReference = reference.startsWith("/") ? reference.slice(1) : reference;
    const target = resolve(root, decodeURIComponent(projectReference));
    if (!existsSync(target)) errors.push(`${file}: missing local reference: ${rawReference}`);
  }
}

const requiredFiles = [
  "firebase.json",
  "firestore.rules",
  "storage.rules",
  "js/firebase.js",
  "functions/package-lock.json"
];

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) errors.push(`missing required project file: ${file}`);
}

if (errors.length) {
  console.error(`Project validation failed with ${errors.length} error(s):`);
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Validated ${htmlFiles.length} HTML files and required project files.`);
