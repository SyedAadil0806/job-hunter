import { cvPlainText } from './cv.layout';
import { Cv } from './cv.schema';

/**
 * Words as an ATS compares them: lower case, dots dropped inside words
 * ("Node.js" -> "nodejs"), everything else a space.
 */
export function atsTokens(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/(\w)\.(?=\w)/g, '$1')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim()} `;
}

/** Spellings an ATS usually treats as the same skill. */
function variants(keyword: string): string[] {
  const k = atsTokens(keyword).trim();
  if (!k) return [];
  const out = new Set([k]);
  // "ReactJS" / "React.js" <-> "React"
  if (/js$/.test(k) && k.length > 4) out.add(k.slice(0, -2).trim());
  else out.add(`${k}js`);
  // "REST APIs" <-> "REST API"
  if (/s$/.test(k) && k.length > 3) out.add(k.slice(0, -1));
  else out.add(`${k}s`);
  return [...out];
}

export function hasKeyword(text: string, keyword: string): boolean {
  const t = atsTokens(text);
  return variants(keyword).some((v) => t.includes(` ${v} `));
}

export interface KeywordCoverage {
  found: string[];
  missing: string[];
  /** 0-100, or null when the job has no keywords to check. */
  percent: number | null;
}

/** Which of the job's keywords the finished CV actually contains, as a parser would see it. */
export function keywordCoverage(cv: Cv, keywords: string[]): KeywordCoverage {
  const text = cvPlainText(cv);
  const seen = new Set<string>();
  const unique = keywords.map((k) => k.trim()).filter((k) => k && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()));
  const found = unique.filter((k) => hasKeyword(text, k));
  const missing = unique.filter((k) => !found.includes(k));
  return { found, missing, percent: unique.length ? Math.round((found.length / unique.length) * 100) : null };
}
