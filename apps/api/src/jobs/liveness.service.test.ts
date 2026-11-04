import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPage } from './liveness.service';

const url = 'https://jobs.example.com/123';
const longText = 'We are hiring a React developer to build great products with our team. '.repeat(10);
const page = (body: string) => `<html><body><p>${body}</p></body></html>`;

test('a missing page means the job is closed', () => {
  assert.equal(classifyPage(404, url, ''), 'closed');
  assert.equal(classifyPage(410, url, ''), 'closed');
});

test('a blocked or failing page is unknown, never closed', () => {
  for (const status of [403, 429, 500, 503, 999]) assert.equal(classifyPage(status, url, page('Error')), 'unknown');
  assert.equal(classifyPage(200, url, page(`Just a moment... ${longText}`)), 'unknown');
});

test('clear wording on the page means closed', () => {
  for (const text of [
    'Unfortunately, this job is no longer available.',
    'This job posting has expired and is no longer accepting applications.',
    'This job post is closed and the position is probably filled.',
    'This position has been filled.',
    'Diese Stelle ist nicht mehr verfügbar.',
  ]) {
    assert.equal(classifyPage(200, url, page(`${text} ${longText}`)), 'closed', text);
  }
});

test('Greenhouse redirect for a closed job means closed', () => {
  assert.equal(classifyPage(200, 'https://boards.greenhouse.io/acme?error=true', page(longText)), 'closed');
});

test('closed wording inside a script is ignored', () => {
  const html = `<script>if (text.includes("This position is no longer active")) hide();</script>${page(longText)}`;
  assert.equal(classifyPage(200, url, html), 'open');
});

test('a very short page built by JavaScript is unknown', () => {
  assert.equal(classifyPage(200, url, '<div id="root"></div>'), 'unknown');
});

test('a normal job page is open', () => {
  assert.equal(classifyPage(200, url, page(longText)), 'open');
});
