export type JobStatus = 'NEW' | 'FILTERED' | 'SCORED' | 'READY' | 'APPLIED' | 'SKIPPED';
export type ApplicationStatus = 'APPLIED' | 'INTERVIEW' | 'OFFER' | 'REJECTED' | 'GHOSTED' | 'WITHDRAWN';
export const APPLICATION_STATUSES: ApplicationStatus[] = ['APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'GHOSTED', 'WITHDRAWN'];

export interface JobSummary {
  id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  isRemote: boolean;
  url: string;
  salary: string | null;
  postedAt: string | null;
  status: JobStatus;
  score: number | null;
  scoreReason: string | null;
  matchedSkills: string[];
  missingSkills: string[];
  redFlags: string[];
  createdAt: string;
  application: { id: string; status: ApplicationStatus; appliedAt: string } | null;
  _count: { cvVersions: number };
}

export interface JobDetail extends Omit<JobSummary, '_count' | 'application'> {
  description: string;
  application: Application | null;
  cvVersions: { id: string; coverLetter: string; model: string; createdAt: string; content: { summary: string } }[];
}

export interface Application {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  notes: string | null;
  appliedAt: string;
  job?: Pick<JobSummary, 'id' | 'title' | 'company' | 'location' | 'isRemote' | 'url' | 'source' | 'score'>;
}

export interface Stats {
  jobs: Partial<Record<JobStatus, number>>;
  applications: Partial<Record<ApplicationStatus, number>>;
  lastRun: { startedAt: string; finishedAt: string | null; newJobs: number; scored: number; tailored: number; errors: string[] } | null;
}

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const TOKEN_KEY = 'jh-token';

export const token = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  },
  set: (t: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* private mode: token lives only for this tab */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function raw(path: string, init: RequestInit = {}, authToken = token.get()): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-api-token': authToken, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      msg = Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? msg);
    } catch {
      /* not json */
    }
    throw new ApiError(msg, res.status);
  }
  return res;
}

const json = async <T>(path: string, init?: RequestInit) => (await raw(path, init)).json() as Promise<T>;

export const api = {
  check: (t: string) => raw('/stats', {}, t).then(() => true),
  stats: () => json<Stats>('/stats'),
  sources: () => json<Record<string, string>>('/sources'),
  jobs: (params: { status?: JobStatus; minScore?: number; q?: string }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, String(v)));
    return json<{ items: JobSummary[]; total: number }>(`/jobs?${qs}`);
  },
  job: (id: string) => json<JobDetail>(`/jobs/${id}`),
  tailor: (id: string) => json<{ id: string }>(`/jobs/${id}/tailor`, { method: 'POST' }),
  skip: (id: string) => json(`/jobs/${id}/skip`, { method: 'POST' }),
  unskip: (id: string) => json(`/jobs/${id}/unskip`, { method: 'POST' }),
  apply: (id: string, notes?: string) => json<Application>(`/jobs/${id}/apply`, { method: 'POST', body: JSON.stringify({ notes }) }),
  applications: () => json<Application[]>('/applications'),
  updateApplication: (id: string, body: { status?: ApplicationStatus; notes?: string }) =>
    json<Application>(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeApplication: (id: string) => json(`/applications/${id}`, { method: 'DELETE' }),
  async downloadCv(id: string, fallbackName: string) {
    const res = await raw(`/jobs/${id}/cv.pdf`);
    const name = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? fallbackName;
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};
