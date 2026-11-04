import { BadGatewayException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { USER_AGENT } from '../sources/http';

const WORKFLOW = 'daily-job-hunt.yml';
const ACTIVE = ['queued', 'in_progress', 'waiting', 'requested', 'pending'];

/**
 * Starts the daily GitHub Actions run from the dashboard. The API holds the GitHub
 * key, so it never reaches the browser. The key only needs Actions access to this repo.
 */
@Injectable()
export class RunNowService {
  private get repo() {
    return process.env.GITHUB_REPO?.trim();
  }

  private get key() {
    return process.env.GITHUB_DISPATCH_TOKEN?.trim();
  }

  private github(path: string, init: RequestInit = {}) {
    return fetch(`https://api.github.com/repos/${this.repo}/actions/workflows/${WORKFLOW}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.key}`,
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    });
  }

  private async isRunning(): Promise<boolean> {
    const res = await this.github('/runs?per_page=1');
    if (!res.ok) throw new BadGatewayException(`GitHub refused the request (${res.status}). Check GITHUB_DISPATCH_TOKEN on Render.`);
    const data = (await res.json()) as { workflow_runs?: { status: string }[] };
    return ACTIVE.includes(data.workflow_runs?.[0]?.status ?? '');
  }

  async status(): Promise<{ enabled: boolean; running: boolean }> {
    if (!this.repo || !this.key) return { enabled: false, running: false };
    return { enabled: true, running: await this.isRunning() };
  }

  async start(): Promise<{ started: true }> {
    if (!this.repo || !this.key) throw new ServiceUnavailableException('Run now is not set up. Add GITHUB_REPO and GITHUB_DISPATCH_TOKEN on Render.');
    // A second run would only repeat the same searches and use up the free limits.
    if (await this.isRunning()) throw new ConflictException('A run is already going.');
    const res = await this.github('/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
    if (!res.ok) throw new BadGatewayException(`GitHub refused the request (${res.status}). Check GITHUB_DISPATCH_TOKEN on Render.`);
    return { started: true };
  }
}
