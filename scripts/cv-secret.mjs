// Prints cv/base-cv.json as one line, ready to paste into the BASE_CV_JSON secret.
// Usage: npm run cv:secret
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = resolve(process.cwd(), 'cv/base-cv.json');
let cv;
try {
  cv = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
  console.error(`Could not read ${path}: ${e.message}`);
  console.error('Copy cv/base-cv.example.json to cv/base-cv.json and fill it in first.');
  process.exit(1);
}

const required = ['name', 'title', 'contact', 'summary', 'skills', 'experience'];
const missing = required.filter((k) => !(k in cv));
if (missing.length) {
  console.error(`base-cv.json is missing: ${missing.join(', ')}`);
  process.exit(1);
}
for (const [i, e] of (cv.experience ?? []).entries()) {
  if (!Array.isArray(e.bullets) || !e.bullets.length) {
    console.error(`experience[${i}] needs at least one bullet`);
    process.exit(1);
  }
}

console.log(JSON.stringify(cv));
console.error('\n↑ Copy the line above into GitHub > Settings > Secrets > Actions > BASE_CV_JSON (and into Render).');
