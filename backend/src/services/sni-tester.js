/**
 * services/sni-tester.js
 * Comprehensive anti-censorship SNI intelligence and diagnostic testing engine.
 * Evaluates TLS 1.3, ALPN HTTP/2, certificate hygiene, and regional ISP bypass suitability.
 */

'use strict';

const tls = require('tls');
const net = require('net');
const dns = require('dns').promises;
const http = require('http');
const https = require('https');

// In-memory cache for IP geolocation lookups (24 hours TTL)
const geoCache = new Map();
const GEO_TTL_MS = 24 * 60 * 60 * 1000;

// Curated Anti-Censorship SNI Database
const CANDIDATE_SNIS = [
  // ─── Russia (RU) Recommended — Bypasses TSPU / RKN DPI whitelisting ───────────
  {
    domain: 'download.nvidia.com',
    dest: 'download.nvidia.com:443',
    label: 'NVIDIA Driver CDN',
    regions: ['RU', 'GLOBAL'],
    category: 'tech',
    desc: 'Akamai/Fastly CDN edge. 100% unblocked in Russia, excellent throughput, TLS 1.3 & HTTP/2.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'gateway.icloud.com',
    dest: 'gateway.icloud.com:443',
    label: 'Apple iCloud Gateway',
    regions: ['RU', 'IR', 'CN', 'GLOBAL'],
    category: 'tech',
    desc: 'Critical infrastructure for all iOS devices. Never blocked by TSPU/RKN or GFW. TLS 1.3.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'updates.cdn-apple.com',
    dest: 'updates.cdn-apple.com:443',
    label: 'Apple Updates CDN',
    regions: ['RU', 'GLOBAL'],
    category: 'tech',
    desc: 'High-bandwidth Apple CDN. Fully whitelisted and natural appearance in ISP traffic logs.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'swx.cdn.skype.com',
    dest: 'swx.cdn.skype.com:443',
    label: 'Microsoft Skype / Teams CDN',
    regions: ['RU', 'GLOBAL'],
    category: 'tech',
    desc: 'Microsoft corporate communications CDN. High trust score across Russian telecom filters.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'dl.epicgames.com',
    dest: 'dl.epicgames.com:443',
    label: 'Epic Games CDN',
    regions: ['RU', 'GLOBAL'],
    category: 'gaming',
    desc: 'Fastly high-capacity gaming CDN. Generates legitimate-looking high-throughput traffic.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'dl.google.com',
    dest: 'dl.google.com:443',
    label: 'Google Download CDN',
    regions: ['RU', 'IR', 'GLOBAL'],
    category: 'tech',
    desc: 'Google Chrome and Android updates CDN. High resilience across mobile and residential ISPs.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'yastatic.net',
    dest: 'yastatic.net:443',
    label: 'Yandex Static CDN',
    regions: ['RU'],
    category: 'media',
    desc: 'Yandex domestic media CDN. Native Russian IP camouflage with zero censorship risk.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'vk.com',
    dest: 'vk.com:443',
    label: 'VKontakte Social',
    regions: ['RU'],
    category: 'media',
    desc: 'Primary Russian domestic social network. Completely whitelisted by all federal filters.',
    recommendedFor: ['shadowtls', 'reality'],
  },
  {
    domain: 'speedtest.tele2.ru',
    dest: 'speedtest.tele2.ru:443',
    label: 'Tele2 Russia Speedtest',
    regions: ['RU'],
    category: 'telecom',
    desc: 'Domestic mobile operator speedtest node. Ideal for mobile SIM traffic camouflage.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'speedtest.beeline.ru',
    dest: 'speedtest.beeline.ru:443',
    label: 'Beeline Russia Speedtest',
    regions: ['RU'],
    category: 'telecom',
    desc: 'Major Russian mobile/broadband operator test node. Bypasses cellular deep-packet inspection.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'aliexpress.ru',
    dest: 'aliexpress.ru:443',
    label: 'AliExpress Russia',
    regions: ['RU'],
    category: 'tech',
    desc: 'Alibaba Cloud Russian e-commerce edge. Officially whitelisted for cross-border trade.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'speed.hetzner.de',
    dest: 'speed.hetzner.de:443',
    label: 'Hetzner Online Speedtest',
    regions: ['RU', 'GLOBAL'],
    category: 'tech',
    desc: 'Direct European peering node. Exceptional ping and stability for European and Russian VPSs.',
    recommendedFor: ['reality', 'shadowtls'],
  },

  // ─── Iran (IR) Recommended — Bypasses National Information Network (NIN) ─────
  {
    domain: 'digikala.com',
    dest: 'digikala.com:443',
    label: 'Digikala E-Commerce',
    regions: ['IR'],
    category: 'tech',
    desc: "Iran's largest online marketplace. Full national intranet (NIN) whitelisting on MCI & Irancell.",
    recommendedFor: ['shadowtls', 'reality'],
  },
  {
    domain: 'aparat.com',
    dest: 'aparat.com:443',
    label: 'Aparat Video',
    regions: ['IR'],
    category: 'media',
    desc: 'National video streaming platform with unrestricted domestic and international bandwidth.',
    recommendedFor: ['shadowtls', 'reality'],
  },
  {
    domain: 'snapp.ir',
    dest: 'snapp.ir:443',
    label: 'Snapp Superapp',
    regions: ['IR'],
    category: 'tech',
    desc: 'Critical national transit/delivery application. Permitted during severe internet throttling.',
    recommendedFor: ['shadowtls', 'reality'],
  },
  {
    domain: 'telewebion.com',
    dest: 'telewebion.com:443',
    label: 'Telewebion Streaming',
    regions: ['IR'],
    category: 'media',
    desc: 'Official national TV streaming portal. Immune to foreign website filtering.',
    recommendedFor: ['shadowtls', 'reality'],
  },
  {
    domain: 'bazaar.cafebazaar.ir',
    dest: 'bazaar.cafebazaar.ir:443',
    label: 'Cafe Bazaar App Market',
    regions: ['IR'],
    category: 'tech',
    desc: 'Major Iranian Android marketplace CDN. High traffic tolerance.',
    recommendedFor: ['shadowtls', 'reality'],
  },

  // ─── China (CN) Recommended — Bypasses Great Firewall (GFW) ─────────────────
  {
    domain: 'www.microsoft.com',
    dest: 'www.microsoft.com:443',
    label: 'Microsoft Global',
    regions: ['CN', 'GLOBAL'],
    category: 'tech',
    desc: 'Allowed nationwide in mainland China for enterprise Windows/Office compliance.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'azure.microsoft.com',
    dest: 'azure.microsoft.com:443',
    label: 'Microsoft Azure',
    regions: ['CN', 'GLOBAL'],
    category: 'tech',
    desc: 'Enterprise cloud services portal. Highly trusted by China Telecom, Unicom, and Mobile.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'appleid.apple.com',
    dest: 'appleid.apple.com:443',
    label: 'Apple ID Portal',
    regions: ['CN', 'GLOBAL'],
    category: 'tech',
    desc: 'Apple authentication server. Permanent unblocked status with domestic edge routing.',
    recommendedFor: ['reality', 'shadowtls'],
  },

  // ─── Global & General Purpose ──────────────────────────────────────────────
  {
    domain: 'samsung.com',
    dest: 'samsung.com:443',
    label: 'Samsung Global',
    regions: ['GLOBAL', 'RU', 'IR'],
    category: 'tech',
    desc: 'Akamai enterprise edge. Supported globally with robust TLS 1.3 implementation.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'speedtest.net',
    dest: 'speedtest.net:443',
    label: 'Ookla Speedtest',
    regions: ['GLOBAL', 'RU'],
    category: 'telecom',
    desc: 'Standard Ookla diagnostic server. Highly recognized and unflagged by firewalls.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'cdn.jsdelivr.net',
    dest: 'cdn.jsdelivr.net:443',
    label: 'jsDelivr Open Source CDN',
    regions: ['GLOBAL', 'RU', 'CN'],
    category: 'cdn',
    desc: 'Global multi-CDN (Cloudflare/Fastly). Blends in with thousands of web applications.',
    recommendedFor: ['reality', 'shadowtls'],
  },
  {
    domain: 'aws.amazon.com',
    dest: 'aws.amazon.com:443',
    label: 'Amazon Web Services',
    regions: ['GLOBAL', 'CN'],
    category: 'tech',
    desc: 'Amazon AWS public edge portal. High enterprise reputation globally.',
    recommendedFor: ['reality', 'shadowtls'],
  },
];

/**
 * Fetch geolocation and ISP metadata for an IP address with 24-hr cache
 */
async function lookupIp(ip) {
  if (!ip || typeof ip !== 'string') return null;
  const cleanIp = ip.replace(/^.*:/, '').trim(); // clean IPv6 mapped IPv4

  // Check local/private addresses
  if (!cleanIp || cleanIp === '127.0.0.1' || cleanIp === 'localhost' ||
      cleanIp.startsWith('10.') || cleanIp.startsWith('192.168.') ||
      cleanIp.startsWith('172.16.') || cleanIp.startsWith('172.31.')) {
    return {
      ip: cleanIp,
      country: 'Local Network',
      countryCode: 'LAN',
      city: 'Private LAN',
      isp: 'Localhost / Intranet',
      isLocal: true,
    };
  }

  const cached = geoCache.get(cleanIp);
  if (cached && (Date.now() - cached.timestamp < GEO_TTL_MS)) {
    return cached.data;
  }

  try {
    const data = await new Promise((resolve, reject) => {
      const req = http.get(
        `http://ip-api.com/json/${encodeURIComponent(cleanIp)}?fields=status,country,countryCode,city,isp,org,query`,
        { timeout: 3500 },
        (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              if (parsed.status === 'success') {
                resolve({
                  ip: parsed.query || cleanIp,
                  country: parsed.country || 'Unknown',
                  countryCode: (parsed.countryCode || 'XX').toUpperCase(),
                  city: parsed.city || '',
                  isp: parsed.isp || parsed.org || 'Unknown Provider',
                  isLocal: false,
                });
              } else {
                resolve(null);
              }
            } catch (err) {
              resolve(null);
            }
          });
        }
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });

    if (data) {
      geoCache.set(cleanIp, { timestamp: Date.now(), data });
      return data;
    }
  } catch {}

  return {
    ip: cleanIp,
    country: 'Unknown',
    countryCode: 'XX',
    city: '',
    isp: 'Unknown ISP',
    isLocal: false,
  };
}

/**
 * Fetch server's own public IP and geolocation
 */
async function lookupServerIp(configuredIp = null) {
  if (configuredIp && configuredIp !== '127.0.0.1' && !configuredIp.startsWith('10.') && !configuredIp.startsWith('192.168.')) {
    const res = await lookupIp(configuredIp);
    if (res && !res.isLocal) return res;
  }

  const cached = geoCache.get('__server_self__');
  if (cached && (Date.now() - cached.timestamp < GEO_TTL_MS)) {
    return cached.data;
  }

  try {
    const data = await new Promise((resolve) => {
      const req = http.get(
        'http://ip-api.com/json/?fields=status,country,countryCode,city,isp,org,query',
        { timeout: 3500 },
        (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              if (parsed.status === 'success') {
                resolve({
                  ip: parsed.query || '',
                  country: parsed.country || 'Unknown',
                  countryCode: (parsed.countryCode || 'XX').toUpperCase(),
                  city: parsed.city || '',
                  isp: parsed.isp || parsed.org || 'Unknown Provider',
                  isLocal: false,
                });
              } else {
                resolve(null);
              }
            } catch {
              resolve(null);
            }
          });
        }
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });

    if (data) {
      geoCache.set('__server_self__', { timestamp: Date.now(), data });
      return data;
    }
  } catch {}

  return {
    ip: configuredIp || 'Unknown',
    country: 'Server Host',
    countryCode: 'XX',
    city: '',
    isp: 'Hosting Provider',
    isLocal: false,
  };
}

/**
 * Perform comprehensive TLS 1.3 + ALPN + Certificate diagnostic test against an SNI
 */
async function testSingleSni(domain, port = 443, timeoutMs = 4500) {
  const result = {
    domain,
    port: parseInt(port, 10) || 443,
    dest: `${domain}:${port}`,
    testedAt: new Date().toISOString(),
    success: false,
    dns: {
      resolved: false,
      ips: [],
      lookupTimeMs: 0,
    },
    tcp: {
      connected: false,
      connectTimeMs: 0,
    },
    tls: {
      handshakeSuccess: false,
      handshakeTimeMs: 0,
      protocol: '',
      alpn: '',
      supportsTls13: false,
      supportsH2: false,
      cipher: '',
    },
    cert: {
      valid: false,
      matchesDomain: false,
      subjectCn: '',
      issuer: '',
      validFrom: '',
      validTo: '',
      daysRemaining: 0,
    },
    totalLatencyMs: 0,
    score: 0,
    rating: 'INCOMPATIBLE',
    recommendation: '',
    error: null,
  };

  const startTime = Date.now();

  // 1. DNS Resolution
  const dnsStart = Date.now();
  try {
    const ipv4 = await dns.resolve4(domain).catch(() => []);
    result.dns.lookupTimeMs = Date.now() - dnsStart;
    if (ipv4 && ipv4.length > 0) {
      result.dns.resolved = true;
      result.dns.ips = ipv4;
    } else {
      const ipv6 = await dns.resolve6(domain).catch(() => []);
      if (ipv6 && ipv6.length > 0) {
        result.dns.resolved = true;
        result.dns.ips = ipv6;
      }
    }
  } catch (err) {
    result.dns.lookupTimeMs = Date.now() - dnsStart;
    result.error = `DNS resolution failed: ${err.message}`;
    return calculateScore(result);
  }

  if (!result.dns.resolved || result.dns.ips.length === 0) {
    result.error = 'No valid IP addresses resolved for domain';
    return calculateScore(result);
  }

  // 2. TCP + TLS Handshake Probe
  const targetIp = result.dns.ips[0];
  const connectStart = Date.now();

  await new Promise((resolve) => {
    let socket = null;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (socket) {
        socket.removeAllListeners();
        socket.destroy();
      }
    };

    timer = setTimeout(() => {
      result.error = 'Connection timed out';
      cleanup();
      resolve();
    }, timeoutMs);

    try {
      socket = tls.connect(
        {
          host: targetIp,
          port: result.port,
          servername: domain,
          ALPNProtocols: ['h2', 'http/1.1'],
          minVersion: 'TLSv1.2',
          maxVersion: 'TLSv1.3',
          rejectUnauthorized: false, // Extract cert even if hostname mismatch, but verify in code
        },
        () => {
          result.tcp.connected = true;
          result.tcp.connectTimeMs = Date.now() - connectStart;
          result.tls.handshakeSuccess = true;
          result.tls.handshakeTimeMs = Date.now() - connectStart;

          // Extract TLS parameters
          result.tls.protocol = socket.getProtocol() || '';
          result.tls.alpn = socket.alpnProtocol || '';
          result.tls.cipher = socket.getCipher()?.name || '';
          result.tls.supportsTls13 = result.tls.protocol === 'TLSv1.3';
          result.tls.supportsH2 = result.tls.alpn === 'h2';

          // Extract Peer Certificate
          try {
            const cert = socket.getPeerCertificate(true);
            if (cert && cert.subject) {
              result.cert.subjectCn = cert.subject.CN || '';
              result.cert.issuer = cert.issuer?.O || cert.issuer?.CN || 'Unknown CA';
              result.cert.validFrom = cert.valid_from || '';
              result.cert.validTo = cert.valid_to || '';

              if (cert.valid_to) {
                const expiry = new Date(cert.valid_to).getTime();
                const now = Date.now();
                result.cert.daysRemaining = Math.max(0, Math.floor((expiry - now) / (1000 * 60 * 60 * 24)));
                result.cert.valid = result.cert.daysRemaining > 0;
              }

              // Check if domain matches CN or Subject Alternative Names (SANs)
              const sans = (cert.subjectaltname || '')
                .split(',')
                .map((s) => s.trim().replace(/^DNS:/i, '').toLowerCase());
              const normDomain = domain.toLowerCase();

              const matchesSan = sans.some((san) => {
                if (san === normDomain) return true;
                if (san.startsWith('*.')) {
                  const wildSuffix = san.slice(2);
                  return normDomain.endsWith(wildSuffix) && normDomain.split('.').length === san.split('.').length;
                }
                return false;
              });

              result.cert.matchesDomain = matchesSan || (result.cert.subjectCn.toLowerCase() === normDomain);
            }
          } catch {}

          result.success = true;
          cleanup();
          resolve();
        }
      );

      socket.on('error', (err) => {
        result.error = `TLS handshake failed: ${err.message}`;
        cleanup();
        resolve();
      });
    } catch (err) {
      result.error = `Socket error: ${err.message}`;
      cleanup();
      resolve();
    }
  });

  result.totalLatencyMs = Date.now() - startTime;
  return calculateScore(result);
}

/**
 * Score SNI candidate from 0 to 100 based on technical anti-censorship parameters
 */
function calculateScore(res) {
  let score = 0;

  if (res.dns.resolved) score += 15;
  if (res.tcp.connected) score += 15;

  if (res.tls.handshakeSuccess) {
    score += 15;
    // TLS 1.3 is essential for Reality and advanced anti-censorship
    if (res.tls.supportsTls13) score += 20;
    // ALPN HTTP/2 is preferred for XTLS Vision
    if (res.tls.supportsH2) score += 15;
  }

  // Certificate matching
  if (res.cert.valid) score += 10;
  if (res.cert.matchesDomain) score += 10;

  // Latency penalty/bonus
  if (res.totalLatencyMs > 0) {
    if (res.totalLatencyMs < 80) score += 10;
    else if (res.totalLatencyMs < 180) score += 7;
    else if (res.totalLatencyMs < 350) score += 4;
  }

  res.score = Math.min(100, Math.max(0, score));

  // Determine Rating & Recommendations
  if (res.score >= 90 && res.tls.supportsTls13 && res.tls.supportsH2 && res.cert.matchesDomain) {
    res.rating = 'IDEAL';
    res.recommendation = 'Perfect anti-censorship camouflage. Fully supports TLS 1.3, HTTP/2, and valid certificate.';
  } else if (res.score >= 75) {
    res.rating = 'EXCELLENT';
    res.recommendation = 'High performance and reliable camouflage. Fully compatible with Reality and ShadowTLS.';
  } else if (res.score >= 50) {
    res.rating = 'COMPATIBLE';
    res.recommendation = 'Compatible, but higher latency or TLS 1.2 only. Suitable for ShadowTLS.';
  } else {
    res.rating = 'INCOMPATIBLE';
    res.recommendation = res.error || 'Connection failed or domain does not meet security requirements.';
  }

  return res;
}

/**
 * Get curated candidate SNIs with optional regional filtering
 */
function getCandidates(region = 'AUTO', clientCountry = 'GLOBAL') {
  let targetRegion = (region || 'AUTO').toUpperCase();
  if (targetRegion === 'AUTO') {
    targetRegion = (clientCountry || 'GLOBAL').toUpperCase();
  }

  return CANDIDATE_SNIS.filter((item) => {
    if (targetRegion === 'ALL') return true;
    if (item.regions.includes(targetRegion)) return true;
    if (item.regions.includes('GLOBAL')) return true;
    return false;
  });
}

/**
 * Benchmark multiple SNIs concurrently (max 5 parallel connections to prevent local exhaustion)
 */
async function runBatchBenchmark(domains, concurrency = 5) {
  const results = [];
  const list = Array.isArray(domains) ? [...domains] : [];

  for (let i = 0; i < list.length; i += concurrency) {
    const chunk = list.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map((item) => {
        const domain = typeof item === 'string' ? item : item.domain;
        const port = item.port || 443;
        return testSingleSni(domain, port).then((res) => ({
          ...res,
          label: item.label || domain,
          category: item.category || 'general',
          desc: item.desc || '',
        }));
      })
    );
    results.push(...chunkResults);
  }

  // Sort descending by score, then ascending by total latency
  results.sort((a, b) => b.score - a.score || a.totalLatencyMs - b.totalLatencyMs);
  return results;
}

module.exports = {
  CANDIDATE_SNIS,
  lookupIp,
  lookupServerIp,
  testSingleSni,
  getCandidates,
  runBatchBenchmark,
};
