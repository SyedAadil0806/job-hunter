import { SearchConfig } from '../config/search-config.schema';

/** A job as it comes out of any source, before it is stored. */
export interface RawJob {
  source: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
  isRemote: boolean;
  url: string;
  description: string;
  salary?: string;
  tags: string[];
  postedAt?: Date;
}

export interface JobSource {
  /** Short id stored on each job, e.g. "remotive". */
  readonly name: string;
  /** Human name shown in the dashboard (used for attribution). */
  readonly label: string;
  /** False when a needed API key is missing; the source is then skipped. */
  isEnabled(): boolean;
  fetchJobs(config: SearchConfig): Promise<RawJob[]>;
}

export const REMOTE_WORDS = /\b(remote|anywhere|worldwide|work from home|wfh)\b/i;
