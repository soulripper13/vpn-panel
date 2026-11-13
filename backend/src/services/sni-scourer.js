/**
 * services/sni-scourer.js
 * Autonomous Anti-Censorship Web Scourer and Discovery Engine.
 * Dynamically scouts the live web, crawls regional seed hubs, extracts asset/CDN dependencies,
 * and discovers live subdomains of major networks for TLS 1.3 Reality & ShadowTLS camouflage.
 */

'use strict';

const https = require('https');
const http = require('http');
const dns = require('dns').promises;
const { testSingleSni, runBatchBenchmark } = require('./sni-tester');

// Curated high-reputation regional seed hubs that depend on whitelisted CDNs and edge networks
const REGIONAL_SEED_HUBS = {
  RU: [
    'https://ya.ru',
    'https://habr.com/ru/all/',
    'https://vk.com',
    'https://aliexpress.ru',
    'https://speedtest.tele2.ru',
    'https://www.apple.com/ru/',
  ],
  IR: [
    'https://www.aparat.com',
    'https://www.digikala.com',
    'https://snapp.ir',
    'https://telewebion.com',
    'https://cafebazaar.ir',
  ],
  CN: [
    'https://www.apple.com.cn',
    'https://www.bilibili.com',
    'https://www.qq.com',
    'https://www.jd.com',
  ],
  GLOBAL: [
    'https://www.apple.com',
    'https://www.nvidia.com',
    'https://www.cloudflare.com',
    'https://www.fastly.com',
    'https://aws.amazon.com',
    'https://www.samsung.com',
  ],
};

const COMMON_PARENT_DOMAINS = {
  RU: ['yandex.ru', 'vk.com', 'apple.com', 'nvidia.com', 'tele2.ru', 'beeline.ru'],
  IR: ['aparat.com', 'digikala.com', 'snapp.ir', 'telewebion.com', 'apple.com'],
  CN: ['apple.com', 'microsoft.com', 'qq.com', 'bilibili.com'],
  GLOBAL: ['apple.com', 'nvidia.com', 'microsoft.com', 'samsung.com', 'amazon.com', 'cloudflare.com'],
};

const DOMAIN_REGEX = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

/**
 * Fetch HTML of a URL following redirects up to maxRedirects
 */
function fetchHtml(url, maxRedirects = 2) {
  return new Promise((resolve) => {
    if (maxRedirects < 0) return resolve('');

    try {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? https : http;

      const req = client.get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          timeout: 4500,
        },
        (res) => {
          if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
            let nextUrl = res.headers.location;
            if (!nextUrl.startsWith('http')) {
              nextUrl = new URL(nextUrl, url).toString();
            }
            return resolve(fetchHtml(nextUrl, maxRedirects - 1));
          }

          let body = '';
          res.on('data', (c) => {
            body += c;
            // Cap at 600KB to prevent excessive memory consumption
            if (body.length > 600000) {
              req.destroy();
              resolve(body);
            }
          });
          res.on('end', () => resolve(body));
        }
      );

      req.on('error', () => resolve(''));
      req.on('timeout', () => {
        req.destroy();
        resolve('');
      });
    } catch {
      resolve('');
    }
  });
}

/**
 * Extract external domain names referenced in an HTML document
 */
function extractDomainsFromHtml(html, baseHost = '') {
  if (!html || typeof html !== 'string') return [];

  const urlRegex = /https?:\/\/([a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)/gi;
  const matches = [...html.matchAll(urlRegex)].map((m) => m[1].toLowerCase());

  const cleanBaseHost = (baseHost || '').toLowerCase();

  return [...new Set(matches)].filter((domain) => {
    if (domain === cleanBaseHost) return false;
    if (!DOMAIN_REGEX.test(domain)) return false;
    if (domain.includes('localhost') || domain.endsWith('.local') || domain.endsWith('.internal')) return false;
    if (domain.startsWith('127.') || domain.startsWith('10.') || domain.startsWith('192.168.')) return false;
    // Exclude basic schema.org / w3 / ogp metadata namespaces
    if (['www.w3.org', 'ogp.me', 'schema.org'].includes(domain)) return false;
    return true;
  });
}

/**
 * Scour subdomains of a root domain using open hostsearch
 */
async function scourSubdomains(parentDomain, max = 25) {
  const cleanDomain = parentDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase().trim();
  if (!cleanDomain) return [];

  return new Promise((resolve) => {
    const req = https.get(
      `https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(cleanDomain)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          if (res.statusCode !== 200 || body.startsWith('error') || body.includes('API count exceeded')) {
            return resolve([]);
          }
          const lines = body.split('\n').filter(Boolean);
          const hosts = lines
            .map((line) => line.split(',')[0].trim().toLowerCase())
            .filter((h) => DOMAIN_REGEX.test(h));
          const unique = [...new Set(hosts)].slice(0, max);
          resolve(unique);
        });
      }
    );

    req.on('error', () => resolve([]));
    req.on('timeout', () => {
      req.destroy();
      resolve([]);
    });
  });
}

/**
 * Scour a single website URL for external assets and CDN endpoints
 */
async function scourUrl(targetUrl, max = 20) {
  let cleanUrl = targetUrl.trim();
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = `https://${cleanUrl}`;
  }

  let baseHost = '';
  try {
    baseHost = new URL(cleanUrl).hostname;
  } catch {
    return [];
  }

  const html = await fetchHtml(cleanUrl);
  const domains = extractDomainsFromHtml(html, baseHost);
  return domains.slice(0, max);
}

/**
 * Scour regional seed portals for a given region (RU, IR, CN, GLOBAL)
 */
async function scourRegionalSeeds(region = 'GLOBAL', max = 25) {
  const targetRegion = (region || 'GLOBAL').toUpperCase();
  const seeds = REGIONAL_SEED_HUBS[targetRegion] || REGIONAL_SEED_HUBS.GLOBAL;

  const resultsBySeed = await Promise.all(
    seeds.map(async (seedUrl) => {
      try {
        let host = '';
        try {
          host = new URL(seedUrl).hostname;
        } catch {}
        const html = await fetchHtml(seedUrl);
        return extractDomainsFromHtml(html, host);
      } catch {
        return [];
      }
    })
  );

  const merged = [...new Set(resultsBySeed.flat())];
  return merged.slice(0, max);
}

/**
 * Filter out domains that fail DNS resolution (keeps testing fast and reliable)
 */
async function filterResolvingDomains(domains, concurrency = 8) {
  const resolving = [];

  for (let i = 0; i < domains.length; i += concurrency) {
    const chunk = domains.slice(i, i + concurrency);
    const checks = await Promise.all(
      chunk.map(async (domain) => {
        try {
          const ips = await dns.resolve4(domain).catch(() => []);
          if (ips && ips.length > 0) return domain;
          const ipv6 = await dns.resolve6(domain).catch(() => []);
          if (ipv6 && ipv6.length > 0) return domain;
          return null;
        } catch {
          return null;
        }
      })
    );
    resolving.push(...checks.filter(Boolean));
  }

  return resolving;
}

/**
 * Master method: Scours live web candidates, filters resolving hostnames,
 * runs TLS 1.3 / ALPN / SAN benchmark, and returns sorted results.
 */
async function scourAndBenchmark({ mode = 'regional', target = '', region = 'GLOBAL', limit = 15, concurrency = 4 }) {
  let discoveredDomains = [];
  let sourceDesc = '';

  const cleanTarget = (target || '').trim();

  if (mode === 'crawl_url' && cleanTarget) {
    sourceDesc = `Web crawl of ${cleanTarget}`;
    discoveredDomains = await scourUrl(cleanTarget, Math.max(limit * 2, 25));
  } else if (mode === 'subdomains' && cleanTarget) {
    sourceDesc = `Subdomain search for ${cleanTarget}`;
    discoveredDomains = await scourSubdomains(cleanTarget, Math.max(limit * 2, 30));
  } else {
    // Default: regional web assets scout
    const activeRegion = (region || cleanTarget || 'GLOBAL').toUpperCase();
    sourceDesc = `Regional web scout for ${activeRegion}`;
    discoveredDomains = await scourRegionalSeeds(activeRegion, Math.max(limit * 2, 30));

    // If few results returned, supplement with subdomains from major regional edge parents
    if (discoveredDomains.length < 8) {
      const parentList = COMMON_PARENT_DOMAINS[activeRegion] || COMMON_PARENT_DOMAINS.GLOBAL;
      const subChunk = await Promise.all(parentList.slice(0, 2).map((p) => scourSubdomains(p, 10)));
      discoveredDomains = [...new Set([...discoveredDomains, ...subChunk.flat()])];
    }
  }

  if (discoveredDomains.length === 0) {
    return {
      totalDiscovered: 0,
      benchmarkedCount: 0,
      source: sourceDesc,
      results: [],
    };
  }

  // Fast DNS pre-filter
  const liveDomains = await filterResolvingDomains(discoveredDomains, 8);
  const targetBatch = liveDomains.slice(0, limit).map((d) => ({
    domain: d,
    label: `Discovered (${sourceDesc})`,
    category: 'web_discovery',
    desc: `Dynamically scouted from the live web. Validated DNS resolution.`,
  }));

  if (targetBatch.length === 0) {
    return {
      totalDiscovered: discoveredDomains.length,
      benchmarkedCount: 0,
      source: sourceDesc,
      results: [],
    };
  }

  // Run deep TLS handshake benchmark
  const results = await runBatchBenchmark(targetBatch, concurrency);

  return {
    totalDiscovered: discoveredDomains.length,
    benchmarkedCount: results.length,
    source: sourceDesc,
    results: results.map((r) => ({
      ...r,
      isDiscovered: true,
      discoverySource: sourceDesc,
    })),
  };
}

module.exports = {
  fetchHtml,
  extractDomainsFromHtml,
  scourUrl,
  scourSubdomains,
  scourRegionalSeeds,
  filterResolvingDomains,
  scourAndBenchmark,
};
