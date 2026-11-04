const USER_AGENT = 'job-hunter/1.0 (personal job search tool)';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch() with a timeout, a User-Agent, JSON parsing and a small retry on 429/5xx. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  { timeoutMs = 20_000, retries = 2 }: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init.headers ?? {}) },
      });
      if (res.status === 429 || res.status >= 500) {
        throw new HttpError(`HTTP ${res.status} from ${new URL(url).host}`, res.status);
      }
      if (!res.ok) {
        // 4xx other than 429 will not get better on retry.
        const body = await res.text().catch(() => '');
        const err = new HttpError(`HTTP ${res.status} from ${new URL(url).host}: ${body.slice(0, 200)}`, res.status);
        (err as HttpError & { fatal: boolean }).fatal = true;
        throw err;
      }
      return (await res.json()) as T;
    } catch (e) {
      lastError = e;
      if ((e as { fatal?: boolean }).fatal || attempt === retries) break;
      await sleep(1500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Rough HTML -> plain text, good enough for job descriptions sent to the AI. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

export function toDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const d = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** "Posted 3 days ago" -> Date. Used for Google Jobs. */
export function relativeToDate(text: string | undefined, now = new Date()): Date | undefined {
  if (!text) return undefined;
  const m = text.toLowerCase().match(/(\d+)\+?\s*(minute|hour|day|week|month)s?\s+ago/);
  if (!m) return /just|today/.test(text.toLowerCase()) ? now : undefined;
  const n = Number(m[1]);
  const unitMs = { minute: 6e4, hour: 3.6e6, day: 8.64e7, week: 6.048e8, month: 2.592e9 }[m[2] as 'day'];
  return new Date(now.getTime() - n * unitMs);
}
