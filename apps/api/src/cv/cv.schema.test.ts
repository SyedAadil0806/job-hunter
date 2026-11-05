import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { CvSchema } from './cv.schema';

test('the example CV in the repo is valid', () => {
  const example = JSON.parse(readFileSync(resolve(__dirname, '../../../../cv/base-cv.example.json'), 'utf8'));
  assert.equal(CvSchema.safeParse(example).success, true);
});
