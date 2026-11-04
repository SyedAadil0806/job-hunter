import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { RunNowService } from './run-now.service';

const realFetch = globalThis.fetch;
const envBackup = { ...process.env };
let calls: { url: string; method: string; body?: string; auth?: string }[] = [];

function fakeGitHub(latestStatus: string, dispatchStatus = 204, listStatus = 200) {
  calls = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body, auth: init?.headers?.Authorization });
    if (url.endsWith('/dispatches')) return new Response(null, { status: dispatchStatus });
    return new Response(JSON.stringify({ workflow_runs: [{ status: latestStatus }] }), { status: listStatus });
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.GITHUB_REPO = 'me/job-hunter';
  process.env.GITHUB_DISPATCH_TOKEN = 'secret-key';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...envBackup };
});

test('reports not set up, without calling GitHub, when the key is missing', async () => {
  delete process.env.GITHUB_DISPATCH_TOKEN;
  fakeGitHub('completed');
  assert.deepEqual(await new RunNowService().status(), { enabled: false, running: false });
  await assert.rejects(new RunNowService().start(), /not set up/);
  assert.equal(calls.length, 0);
});

test('starts the daily workflow on main with the key', async () => {
  fakeGitHub('completed');
  assert.deepEqual(await new RunNowService().start(), { started: true });
  const dispatch = calls.find((c) => c.method === 'POST')!;
  assert.match(dispatch.url, /repos\/me\/job-hunter\/actions\/workflows\/daily-job-hunt\.yml\/dispatches$/);
  assert.deepEqual(JSON.parse(dispatch.body!), { ref: 'main' });
  assert.equal(dispatch.auth, 'Bearer secret-key');
});

test('refuses to start a second run while one is going', async () => {
  for (const status of ['queued', 'in_progress']) {
    fakeGitHub(status);
    await assert.rejects(new RunNowService().start(), /already going/);
    assert.equal(calls.some((c) => c.method === 'POST'), false, status);
  }
});

test('shows whether a run is going', async () => {
  fakeGitHub('in_progress');
  assert.deepEqual(await new RunNowService().status(), { enabled: true, running: true });
  fakeGitHub('completed');
  assert.deepEqual(await new RunNowService().status(), { enabled: true, running: false });
});

test('a refused key gives a clear error that does not contain the key', async () => {
  fakeGitHub('completed', 403);
  await assert.rejects(new RunNowService().start(), (e: Error) => {
    assert.match(e.message, /GITHUB_DISPATCH_TOKEN/);
    assert.doesNotMatch(e.message, /secret-key/);
    return true;
  });
});
