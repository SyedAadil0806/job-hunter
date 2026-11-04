import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { SearchConfig } from '../config/search-config.schema';
import { AdzunaSource } from './adzuna.source';
import { GoogleJobsSource } from './google-jobs.source';
import { JoobleSource } from './jooble.source';

const realFetch = globalThis.fetch;
const envBackup = { ...process.env };
let bodies: any[] = [];

function fakeApi(body: unknown) {
  bodies = [];
  globalThis.fetch = (async (_input: any, init?: any) => {
    if (init?.body) bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

const config = {
  queries: ['react developer'],
  joobleLocations: ['Remote'],
  adzunaCountries: ['gb'],
  limits: { maxJobAgeDays: 21 },
} as unknown as SearchConfig;

const joobleJob = (over: object) => ({ id: 1, title: 'React Developer', location: 'Berlin', snippet: 'x', salary: '', source: '', type: 'Full-time', link: 'https://x', company: 'Acme', updated: '2026-11-01', ...over });
const adzunaJob = (over: object) => ({ id: '1', title: 'React Developer', description: 'x', redirect_url: 'https://x', created: '2026-11-01', location: { display_name: 'London' }, ...over });

beforeEach(() => {
  process.env.JOOBLE_API_KEY = 'k';
  process.env.ADZUNA_APP_ID = 'i';
  process.env.ADZUNA_APP_KEY = 'k';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...envBackup };
});

test('Google Jobs reads date, salary, schedule and remote from the plain extensions list', async () => {
  process.env.SERPAPI_KEY = 'k';
  process.env.GOOGLE_MAX_SEARCHES_PER_RUN = '1';
  const googleJob = { job_id: '1', title: 'React Developer', company_name: 'Acme', location: 'Dubai - United Arab Emirates', share_link: 'https://x' };
  fakeApi({
    jobs_results: [
      { ...googleJob, extensions: ['7 days ago', 'AED 4K–AED 5K a month', 'Full-time'] },
      { ...googleJob, job_id: '2', extensions: ['Work from home', 'Full-time', 'No degree mentioned'], detected_extensions: { qualifications: 'No degree mentioned' } },
    ],
  });
  const before = Date.now();
  const [dated, remote] = await new GoogleJobsSource().fetchJobs({ ...config, googleLocations: ['United Arab Emirates'] } as SearchConfig);
  const ageDays = (before - dated.postedAt!.getTime()) / 8.64e7;
  assert.ok(Math.abs(ageDays - 7) < 0.01);
  assert.equal(dated.salary, 'AED 4K–AED 5K a month');
  assert.equal(dated.tags[0], 'Full-time');
  assert.equal(dated.isRemote, false);
  assert.equal(remote.isRemote, true);
  assert.equal(remote.postedAt, undefined);
  assert.equal(remote.salary, undefined);
});

test('Google Jobs morning and evening runs use different searches, and all get used', async (t) => {
  process.env.SERPAPI_KEY = 'k';
  process.env.GOOGLE_MAX_SEARCHES_PER_RUN = '3';
  const queries = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const searched: string[] = [];
  globalThis.fetch = (async (input: any) => {
    searched.push(new URL(String(input)).searchParams.get('q')!);
    return new Response(JSON.stringify({ jobs_results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const start = Date.UTC(2026, 10, 5, 3, 17);
  const runs: string[][] = [];
  for (let run = 0; run < 4; run++) {
    t.mock.method(Date, 'now', () => start + run * 12 * 3.6e6);
    searched.length = 0;
    await new GoogleJobsSource().fetchJobs({ ...config, queries, googleLocations: ['United Arab Emirates'] } as SearchConfig);
    runs.push([...searched]);
    t.mock.restoreAll();
  }
  assert.notDeepEqual(runs[0], runs[1]);
  assert.equal(new Set(runs.flat()).size, queries.length);
});

test('Google Jobs picks the company site, then a big board, and copy sites last', async () => {
  process.env.SERPAPI_KEY = 'k';
  process.env.GOOGLE_MAX_SEARCHES_PER_RUN = '1';
  const option = (title: string) => ({ title: `Apply on ${title}`, link: `https://${title}.example` });
  const googleJob = { title: 'React Developer', company_name: 'Acme', location: 'Dubai', extensions: [] };
  fakeApi({
    jobs_results: [
      { ...googleJob, job_id: '1', apply_options: [option('Jooble'), option('LinkedIn'), option('Acme Careers')] },
      { ...googleJob, job_id: '2', apply_options: [option('Jobrapido'), option('LinkedIn')] },
      { ...googleJob, job_id: '3', apply_options: [option('Jooble')] },
    ],
  });
  const jobs = await new GoogleJobsSource().fetchJobs({ ...config, googleLocations: ['United Arab Emirates'] } as SearchConfig);
  assert.deepEqual(jobs.map((j) => j.url), ['https://Acme Careers.example', 'https://LinkedIn.example', 'https://Jooble.example']);
});

test('Jooble "Remote" search asks for remote jobs but does not trust the search', async () => {
  fakeApi({ jobs: [joobleJob({ id: 1 }), joobleJob({ id: 2, location: 'Remote' })] });
  const jobs = await new JoobleSource().fetchJobs(config);
  assert.equal(bodies[0].keywords, 'react developer remote');
  assert.deepEqual(jobs.map((j) => j.isRemote), [false, true]);
});

test('Adzuna only marks a job remote when it says so clearly', async () => {
  fakeApi({
    results: [
      adzunaJob({ id: '1', description: 'Join remote meetings with our client from our London office.' }),
      adzunaJob({ id: '2', description: 'This is a fully remote position.' }),
      adzunaJob({ id: '3', title: 'Remote React Developer' }),
    ],
  });
  const jobs = await new AdzunaSource().fetchJobs(config);
  assert.deepEqual(jobs.map((j) => j.isRemote), [false, true, true]);
});
