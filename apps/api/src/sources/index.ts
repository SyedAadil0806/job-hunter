import { AdzunaSource } from './adzuna.source';
import { ArbeitnowSource } from './arbeitnow.source';
import { GoogleJobsSource } from './google-jobs.source';
import { JoobleSource } from './jooble.source';
import { RemoteOkSource } from './remoteok.source';
import { RemotiveSource } from './remotive.source';
import { JobSource } from './source.types';

export * from './source.types';

/** Add a new job site here: implement JobSource and append it. */
export function allSources(): JobSource[] {
  return [
    new RemotiveSource(),
    new RemoteOkSource(),
    new ArbeitnowSource(),
    new AdzunaSource(),
    new JoobleSource(),
    new GoogleJobsSource(),
  ];
}

export const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  allSources().map((s) => [s.name, s.label]),
);
