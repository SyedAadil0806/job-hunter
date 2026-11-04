import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { SearchConfigSchema } from '../config/search-config.schema';
import { RawJob } from '../sources/source.types';
import { dedupeKey, prefilter } from './filter';

const config = SearchConfigSchema.parse(
  JSON.parse(readFileSync(resolve(__dirname, '../../../../cv/search-config.json'), 'utf8')),
);
const now = new Date('2026-11-04T00:00:00Z');

const job = (over: Partial<RawJob>): RawJob => ({
  source: 't',
  externalId: '1',
  title: 'React Developer',
  company: 'Acme',
  location: 'Dubai, UAE',
  isRemote: false,
  url: 'https://x',
  description: 'Build things with React.',
  tags: [],
  postedAt: new Date('2026-11-01T00:00:00Z'),
  ...over,
});

test('keeps a junior React role in Dubai', () => {
  assert.deepEqual(prefilter(job({}), config, now), { keep: true });
});

test('drops senior roles', () => {
  const r = prefilter(job({ title: 'Senior React Developer' }), config, now);
  assert.equal(r.keep, false);
});

test('drops on-site roles outside the UAE', () => {
  const r = prefilter(job({ location: 'Berlin, Germany' }), config, now);
  assert.equal(r.keep, false);
});

test('keeps remote roles anywhere, unless region-locked', () => {
  assert.equal(prefilter(job({ location: 'Worldwide', isRemote: true }), config, now).keep, true);
  assert.equal(prefilter(job({ location: 'USA Only', isRemote: true }), config, now).keep, false);
});

test('keeps every work setup inside the UAE, in all seven emirates', () => {
  for (const location of ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah', 'Al Ain, UAE']) {
    assert.equal(prefilter(job({ location }), config, now).keep, true, location);
  }
  assert.equal(prefilter(job({ location: 'Hybrid - Dubai' }), config, now).keep, true);
  assert.equal(prefilter(job({ location: 'Dubai', isRemote: true }), config, now).keep, true);
  assert.equal(prefilter(job({ location: 'Dubai', description: 'Hybrid role, 3 days a week in the office.' }), config, now).keep, true);
});

test('drops hybrid jobs outside the UAE even when the site says remote', () => {
  const remote = { location: 'Palo Alto', isRemote: true };
  assert.equal(prefilter(job({ ...remote, description: 'Hybrid in Palo Alto (Mon / Wed / Thurs)' }), config, now).keep, false);
  assert.equal(prefilter(job({ ...remote, description: 'You work 3 days per week in the office.' }), config, now).keep, false);
  assert.equal(prefilter(job({ ...remote, location: 'Hybrid, Berlin' }), config, now).keep, false);
  assert.equal(prefilter(job({ ...remote, title: 'React Developer (Hybrid)' }), config, now).keep, false);
});

test('keeps a remote job that only mentions hybrid in another sense', () => {
  const description = 'Decide between full stack on-site or a hybrid split with our cloud. Hybrid app experience is a plus.';
  assert.equal(prefilter(job({ location: 'Remote', isRemote: true, description }), config, now).keep, true);
});

test('does not treat a word containing "uae" as the UAE', () => {
  assert.equal(prefilter(job({ location: 'Guaeca, Brazil' }), config, now).keep, false);
});

test('drops Emiratization roles by title or description', () => {
  assert.equal(prefilter(job({ title: 'Junior Software Engineer (Emiratization)' }), config, now).keep, false);
  assert.equal(prefilter(job({ description: 'Part of our Emiratisation programme.' }), config, now).keep, false);
});

test('drops old jobs and non-target titles', () => {
  assert.equal(prefilter(job({ postedAt: new Date('2026-09-01') }), config, now).keep, false);
  assert.equal(prefilter(job({ title: 'Accountant' }), config, now).keep, false);
});

test('dedupe key ignores company suffixes and punctuation', () => {
  assert.equal(
    dedupeKey({ company: 'Acme Tech FZ-LLC', title: 'React Developer (Remote)' }),
    dedupeKey({ company: 'acme tech', title: 'React developer' }),
  );
});
