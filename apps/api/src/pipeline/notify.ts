export interface DigestJob {
  title: string;
  company: string;
  location: string;
  score: number | null;
}

export interface DigestInput {
  newlyReady: DigestJob[];
  errors: string[];
  dashboardUrl?: string;
}

const MAX_JOBS = 15;
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The morning message, or null when there is nothing worth a notification. */
export function buildDigest({ newlyReady, errors, dashboardUrl }: DigestInput): string | null {
  const waiting = errors.some((e) => /quota/i.test(e));
  const otherProblems = errors.filter((e) => !/quota/i.test(e)).length;
  if (!newlyReady.length && !waiting && !otherProblems) return null;

  const lines: string[] = [];
  if (newlyReady.length) {
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
    if (!res.ok) console.error(`Telegram message failed: HTTP ${res.status}`);
    return res.ok;
  } catch {
    console.error('Telegram message failed: could not reach Telegram');
    return false;
  }
}
