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
const { extractDomainsFromHtml, filterResolvingDomains } = require('../src/services/sni-scourer');
const SavedSni = require('../src/models/SavedSni');

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

test('SNI Scourer: extractDomainsFromHtml extracts valid hostnames and excludes metadata/locals', () => {
  const sampleHtml = `
    <html>
      <head>
        <link rel="stylesheet" href="https://cdn.example.org/style.css">
        <script src="https://assets.sub.domain.com/app.js"></script>
        <a href="https://www.w3.org/TR/html5">W3C</a>
        <a href="http://127.0.0.1:8080/test">Local IP</a>
        <a href="https://internal.local/api">Internal</a>
        <img src="https://media.validtarget.net/logo.png">
      </head>
    </html>
  `;
  const domains = extractDomainsFromHtml(sampleHtml, 'cdn.example.org');
  assert.ok(domains.includes('assets.sub.domain.com'));
  assert.ok(domains.includes('media.validtarget.net'));
  assert.equal(domains.includes('cdn.example.org'), false); // base host excluded
  assert.equal(domains.includes('www.w3.org'), false); // w3 excluded
  assert.equal(domains.includes('127.0.0.1'), false); // local excluded
  assert.equal(domains.includes('internal.local'), false); // .local excluded
});

test('SNI Scourer: SavedSni model persists, retrieves, and deletes bookmarks', () => {
  const testDomain = `scouted-gem-${Date.now()}.example.com`;
  const saved = SavedSni.upsert({
    domain: testDomain,
    port: 443,
    score: 95,
    rating: 'IDEAL',
    tlsProtocol: 'TLSv1.3',
    alpn: 'h2',
    matchesSan: true,
    latencyMs: 45,
    source: 'web_scourer',
    region: 'RU',
    notes: 'Discovered via web scourer',
  });

  assert.ok(saved.id > 0);
  assert.equal(saved.domain, testDomain);
  assert.equal(saved.score, 95);
  assert.equal(saved.rating, 'IDEAL');

  const found = SavedSni.findByDomain(testDomain);
  assert.ok(found);
  assert.equal(found.id, saved.id);

  const all = SavedSni.getAll('RU');
  assert.ok(all.some((s) => s.domain === testDomain));

  const deleted = SavedSni.delete(saved.id);
  assert.equal(deleted, true);
  assert.equal(SavedSni.findByDomain(testDomain), undefined);
});

