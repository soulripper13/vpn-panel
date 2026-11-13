'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CANDIDATE_SNIS,
  lookupIp,
  getCandidates,
  testSingleSni,
  runBatchBenchmark,
} = require('../src/services/sni-tester');

test('SNI Tester: Curated candidates exist and have required properties', () => {
  assert.ok(Array.isArray(CANDIDATE_SNIS));
  assert.ok(CANDIDATE_SNIS.length >= 10);

  for (const item of CANDIDATE_SNIS) {
    assert.ok(item.domain, 'Candidate must have domain');
    assert.ok(item.dest, 'Candidate must have dest');
    assert.ok(Array.isArray(item.regions), 'Candidate must have regions array');
    assert.ok(Array.isArray(item.recommendedFor), 'Candidate must have recommendedFor array');
  }
});

test('SNI Tester: Regional candidate filtering', () => {
  const ruCandidates = getCandidates('RU');
  assert.ok(ruCandidates.length > 0);
  assert.ok(ruCandidates.some((c) => c.domain.includes('yandex') || c.domain.includes('tele2') || c.domain.includes('nvidia')));

  const irCandidates = getCandidates('IR');
  assert.ok(irCandidates.length > 0);
  assert.ok(irCandidates.some((c) => c.domain.includes('digikala') || c.domain.includes('aparat')));

  const cnCandidates = getCandidates('CN');
  assert.ok(cnCandidates.length > 0);
  assert.ok(cnCandidates.some((c) => c.domain.includes('microsoft') || c.domain.includes('apple')));

  const allCandidates = getCandidates('ALL');
  assert.equal(allCandidates.length, CANDIDATE_SNIS.length);
});

test('SNI Tester: Geolocation handles private and local IPs cleanly', async () => {
  const localRes = await lookupIp('127.0.0.1');
  assert.ok(localRes);
  assert.equal(localRes.isLocal, true);
  assert.equal(localRes.countryCode, 'LAN');

  const lanRes = await lookupIp('192.168.1.100');
  assert.ok(lanRes);
  assert.equal(lanRes.isLocal, true);

  const emptyRes = await lookupIp(null);
  assert.equal(emptyRes, null);
});

test('SNI Tester: testSingleSni safely handles non-existent or invalid domains without throwing', async () => {
  const res = await testSingleSni('not-real-sni-test.invalid', 443, 1000);
  assert.ok(res);
  assert.equal(res.success, false);
  assert.equal(res.dns.resolved, false);
  assert.equal(res.rating, 'INCOMPATIBLE');
  assert.ok(res.error);
});

test('SNI Tester: runBatchBenchmark processes list and returns sorted array', async () => {
  const batch = [
    { domain: 'invalid-sni-domain-a-123.com', label: 'Test A' },
    { domain: 'invalid-sni-domain-b-456.com', label: 'Test B' },
  ];
  const results = await runBatchBenchmark(batch, 2);
  assert.equal(results.length, 2);
  assert.ok(typeof results[0].score === 'number');
  assert.ok(typeof results[1].score === 'number');
});
