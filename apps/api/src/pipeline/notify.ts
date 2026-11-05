export interface DigestJob {
  title: string;
  company: string;
  location: string;
  score: number | null;
}

export interface DigestInput {
  newJobs: number;
  newlyReady: DigestJob[];
  errors: string[];
  /** False when this run skipped the CV step, so "none good enough" wouldn't be true. */
  tailorRan: boolean;
  dashboardUrl?: string;
}

const MAX_JOBS = 15;
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The message sent after every run. */
export function buildDigest({ newJobs, newlyReady, errors, tailorRan, dashboardUrl }: DigestInput): string {
  const waiting = errors.some((e) => /quota/i.test(e));
  const otherProblems = errors.filter((e) => !/quota/i.test(e)).length;

  const lines: string[] = [];
  if (!newlyReady.length) {
    const found = newJobs === 0 ? 'no new jobs' : `${newJobs} new ${newJobs === 1 ? 'job' : 'jobs'}`;
    const outcome = errors.length || !tailorRan ? 'no new CVs' : newJobs === 0 ? '' : 'none good enough for a CV';
    lines.push(`✅ Run finished: ${[found, outcome].filter(Boolean).join(', ')}`);
  } else {
    lines.push(`🎯 <b>${newlyReady.length} new ${newlyReady.length === 1 ? 'job' : 'jobs'} ready</b>`);
    for (const j of newlyReady.slice(0, MAX_JOBS)) {
      lines.push(`${j.score ?? '-'} – ${escapeHtml(j.title)} @ ${escapeHtml(j.company)}, ${escapeHtml(j.location)}`);
    }
    if (newlyReady.length > MAX_JOBS) lines.push(`…and ${newlyReady.length - MAX_JOBS} more`);
  }
  if (waiting) lines.push('⏳ The AI free limit ran out, so some jobs will finish after it resets.');
  if (otherProblems) lines.push(`⚠️ ${otherProblems} ${otherProblems === 1 ? 'problem' : 'problems'} in this run. See the run page on GitHub.`);
  if (dashboardUrl) lines.push('', `<a href="${escapeHtml(dashboardUrl)}">Open dashboard</a>`);
  return lines.join('\n');
}

/** Never throws: a failed message must not fail the daily run. The token stays out of the logs. */
export async function sendTelegram(text: string): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { description?: string };
      console.error(`Telegram message failed: HTTP ${res.status} ${body.description ?? ''}`);
    }
    return res.ok;
  } catch {
    console.error('Telegram message failed: could not reach Telegram');
    return false;
  }
}
