import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { handle } from '../src/server.js';

// Minimal req/res pair for handle(): collects status, headers and body.
function call(path, headers = {}) {
  return new Promise((resolve) => {
    const res = new PassThrough();
    const chunks = [];
    res.writeHead = (status, h) => { res.status = status; res.headers = h; };
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.status, headers: res.headers, body: Buffer.concat(chunks) }));
    handle({ url: path, headers }, res);
  });
}

test('static files: whole file with accept-ranges', async () => {
  const r = await call('/styles.css');
  assert.equal(r.status, 200);
  assert.equal(r.headers['accept-ranges'], 'bytes');
  assert.equal(r.body.toString(), readFileSync('web/styles.css', 'utf8'));
});

test('static files: byte ranges (how the browser reads the map archive)', async () => {
  const full = readFileSync('web/styles.css');
  const r = await call('/styles.css', { range: 'bytes=10-19' });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], `bytes 10-19/${full.length}`);
  assert.deepEqual(r.body, full.subarray(10, 20));
  const tail = await call('/styles.css', { range: 'bytes=-5' });
  assert.deepEqual(tail.body, full.subarray(full.length - 5));
  const bad = await call('/styles.css', { range: `bytes=${full.length + 10}-` });
  assert.equal(bad.status, 416);
});

test('static files: no escaping the web folder', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fsrc/server.js']) {
    const r = await call(p);
    assert.equal(r.status, 404, p);
  }
});
