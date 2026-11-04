import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Cv, CvSchema } from '../cv/cv.schema';
import { SearchConfig, SearchConfigSchema } from './search-config.schema';

/** Repo-level cv/ folder. Same depth from src/ and dist/, so this works in both. */
const CV_DIR = process.env.CV_DIR ?? resolve(__dirname, '..', '..', '..', '..', 'cv');

function readJson(envVar: string, fileName: string): unknown {
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.trim()) {
    try {
      return JSON.parse(fromEnv);
    } catch (e) {
      throw new Error(`${envVar} is set but is not valid JSON: ${(e as Error).message}`);
    }
  }
  const path = resolve(CV_DIR, fileName);
  if (!existsSync(path)) {
    throw new Error(
      `Could not find ${path}. Copy ${fileName.replace('.json', '.example.json')} to ${fileName} ` +
        `and fill it in, or set the ${envVar} env var.`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

let cvCache: Cv | undefined;
let configCache: SearchConfig | undefined;

export function loadBaseCv(): Cv {
  if (!cvCache) cvCache = CvSchema.parse(readJson('BASE_CV_JSON', 'base-cv.json'));
  return cvCache;
}

export function loadSearchConfig(): SearchConfig {
  if (!configCache) configCache = SearchConfigSchema.parse(readJson('SEARCH_CONFIG_JSON', 'search-config.json'));
  return configCache;
}
