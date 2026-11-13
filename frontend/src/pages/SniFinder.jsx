import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Radar,
  Globe,
  Server,
  User,
  ShieldCheck,
  ShieldAlert,
  Zap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Copy,
  Check,
  Search,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Info,
  Sliders,
  Cpu,
  Lock,
  Star,
  Bookmark,
  Trash2,
  Sparkles,
  Link2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import api from '../utils/api'

export default function SniFinder() {
  const navigate = useNavigate()

  // Navigation Tabs: 'scourer' | 'curated' | 'saved'
  const [activeTab, setActiveTab] = useState('scourer')

  // Network Locations State
  const [locations, setLocations] = useState(null)
  const [locationsLoading, setLocationsLoading] = useState(true)
  const [selectedRegion, setSelectedRegion] = useState('AUTO')
  const [clientLatencies, setClientLatencies] = useState({})
  const [copiedKey, setCopiedKey] = useState(null)
  const [selectedDetails, setSelectedDetails] = useState(null)

  // 1. Curated Benchmark State
  const [curatedBenchmarking, setCuratedBenchmarking] = useState(false)
  const [curatedResults, setCuratedResults] = useState([])

  // 2. Web Scourer State
  const [scourMode, setScourMode] = useState('regional') // 'regional' | 'subdomains' | 'crawl_url'
  const [scourTarget, setScourTarget] = useState('')
  const [scourRegion, setScourRegion] = useState('AUTO')
  const [scourLimit, setScourLimit] = useState(15)
  const [scouring, setScouring] = useState(false)
  const [scourPhase, setScourPhase] = useState('')
  const [scourResults, setScourResults] = useState([])
  const [scourMeta, setScourMeta] = useState(null)

  // 3. Saved SNIs Library State
  const [savedSnis, setSavedSnis] = useState([])
  const [savedLoading, setSavedLoading] = useState(false)
  const [savedSearch, setSavedSearch] = useState('')

  // 4. Custom Domain Inspection
  const [customDomain, setCustomDomain] = useState('')
  const [customPort, setCustomPort] = useState(443)
  const [customTesting, setCustomTesting] = useState(false)
  const [customResult, setCustomResult] = useState(null)

  // Load locations and saved SNIs on mount
  useEffect(() => {
    fetchLocations()
    fetchSavedSnis()
  }, [])

  const fetchLocations = async () => {
    setLocationsLoading(true)
    try {
      const res = await api.get('/sni-finder/locations')
      if (res.data?.success) {
        setLocations(res.data.data)
      }
    } catch (err) {
      toast.error('Failed to detect network locations: ' + (err.response?.data?.message || err.message))
    } finally {
      setLocationsLoading(false)
    }
  }

  const fetchSavedSnis = async () => {
    setSavedLoading(true)
    try {
      const res = await api.get('/sni-finder/saved')
      if (res.data?.success) {
        setSavedSnis(res.data.data || [])
      }
    } catch {
      // ignore
    } finally {
      setSavedLoading(false)
    }
  }

  // Active target region (resolves AUTO to suggestedRegion or client country)
  const activeRegion = useMemo(() => {
    if (selectedRegion !== 'AUTO') return selectedRegion
    return locations?.suggestedRegion || 'GLOBAL'
  }, [selectedRegion, locations])

  // Probe reachability & latency directly from the client's browser
  const probeClientReachability = async (candidates) => {
    const latencies = { ...clientLatencies }
    for (const item of candidates) {
      const domain = item.domain
      const start = Date.now()
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 2500)
        await fetch(`https://${domain}/favicon.ico?_v=${Date.now()}`, {
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal,
        })
        clearTimeout(timeout)
        latencies[domain] = { reachable: true, latencyMs: Date.now() - start }
      } catch {
        latencies[domain] = { reachable: false, latencyMs: null, blocked: true }
      }
      setClientLatencies({ ...latencies })
    }
  }

  // Run Curated Benchmark
  const handleRunCuratedBenchmark = async (regionOverride = null) => {
    setCuratedBenchmarking(true)
    const targetRegion = regionOverride || selectedRegion
    try {
      const res = await api.post('/sni-finder/benchmark', {
        region: targetRegion,
        clientCountry: locations?.client?.countryCode || 'GLOBAL',
        concurrency: 4,
      })

      if (res.data?.success) {
        const results = res.data.data.results || []
        setCuratedResults(results)
        toast.success(`Benchmarked ${results.length} curated SNIs!`)
        probeClientReachability(results)
      }
    } catch (err) {
      toast.error('Benchmark failed: ' + (err.response?.data?.message || err.message))
    } finally {
      setCuratedBenchmarking(false)
    }
  }

  // Run Live Web Scourer
  const handleRunScourer = async (e) => {
    e?.preventDefault()
    setScouring(true)
    setScourPhase('1/3: Scouring live web assets & DNS records…')
    setScourResults([])
    setScourMeta(null)

    const resolvedRegion = scourRegion === 'AUTO' ? (locations?.suggestedRegion || 'GLOBAL') : scourRegion

    try {
      const timer = setTimeout(() => {
        setScourPhase('2/3: Validating active reachability & IPs…')
      }, 1500)
      const timer2 = setTimeout(() => {
        setScourPhase('3/3: Running deep TLS 1.3 & ALPN handshakes…')
      }, 3500)

      const res = await api.post('/sni-finder/scour', {
        mode: scourMode,
        target: scourTarget,
        region: resolvedRegion,
        limit: parseInt(scourLimit, 10) || 15,
        concurrency: 4,
      })

      clearTimeout(timer)
      clearTimeout(timer2)

      if (res.data?.success) {
        const data = res.data.data
        setScourMeta(data)
        setScourResults(data.results || [])
        toast.success(`Scoured web: discovered ${data.totalDiscovered} domains, validated ${data.benchmarkedCount}!`)
        probeClientReachability(data.results || [])
      }
    } catch (err) {
      toast.error('Web scouring failed: ' + (err.response?.data?.message || err.message))
    } finally {
      setScouring(false)
      setScourPhase('')
    }
  }

  // Auto-run first curated benchmark when locations load
  useEffect(() => {
    if (locations && curatedResults.length === 0 && !curatedBenchmarking) {
      handleRunCuratedBenchmark('AUTO')
    }
  }, [locations])

  // Save / Bookmark SNI
  const handleSaveSni = async (item) => {
    try {
      const payload = {
        domain: item.domain,
        port: item.port || 443,
        score: item.score || 0,
        rating: item.rating || 'IDEAL',
        tlsProtocol: item.tls?.protocol || '',
        alpn: item.tls?.alpn || '',
        matchesSan: Boolean(item.cert?.matchesDomain),
        latencyMs: item.totalLatencyMs || 0,
        source: item.isDiscovered ? 'web_scourer' : 'curated',
        region: activeRegion,
        notes: item.desc || item.recommendation || '',
      }

      const res = await api.post('/sni-finder/saved', payload)
      if (res.data?.success) {
        toast.success(`Saved ${item.domain} to library! ⭐`)
        fetchSavedSnis()
      }
    } catch (err) {
      toast.error('Failed to save SNI: ' + (err.response?.data?.message || err.message))
    }
  }

  // Delete Saved SNI
  const handleDeleteSaved = async (id, domain) => {
    try {
      await api.delete(`/sni-finder/saved/${id}`)
      setSavedSnis((prev) => prev.filter((s) => s.id !== id))
      toast.success(`Removed ${domain}`)
    } catch (err) {
      toast.error('Failed to delete: ' + (err.response?.data?.message || err.message))
    }
  }

  // Test custom domain
  const handleTestCustom = async (e) => {
    e?.preventDefault()
    if (!customDomain.trim()) return

    setCustomTesting(true)
    setCustomResult(null)
    try {
      const cleanDomain = customDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      const res = await api.post('/sni-finder/test-custom', {
        domain: cleanDomain,
        port: parseInt(customPort, 10) || 443,
      })

      if (res.data?.success) {
        setCustomResult(res.data.data)
        toast.success(`Diagnostic test complete for ${cleanDomain}`)
      }
    } catch (err) {
      toast.error('Diagnostic test failed: ' + (err.response?.data?.message || err.message))
    } finally {
      setCustomTesting(false)
    }
  }

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    toast.success(`Copied: ${text}`)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const isAlreadySaved = (domain) => {
    return savedSnis.some((s) => s.domain.toLowerCase() === domain.toLowerCase())
  }

  const getRatingBadge = (rating) => {
    switch (rating) {
      case 'IDEAL':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <Zap className="w-3 h-3 fill-emerald-400 text-emerald-400" />
            IDEAL
          </span>
        )
      case 'EXCELLENT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
            <CheckCircle2 className="w-3 h-3 text-indigo-400" />
            EXCELLENT
          </span>
        )
      case 'COMPATIBLE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            COMPATIBLE
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30">
            <XCircle className="w-3 h-3 text-rose-400" />
            INCOMPATIBLE
          </span>
        )
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Radar className="w-6 h-6 text-indigo-400" />
              Ideal SNI Camouflage Finder & Web Scourer
            </h2>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-indigo-600/30 text-indigo-300 border border-indigo-500/30">
              Anti-Censorship
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Scour the live web or test curated candidates with real TLS 1.3 handshakes, ALPN HTTP/2 negotiation, certificate hygiene, and client-to-server latency.
          </p>
        </div>

        {/* Mode Navigation Tabs */}
        <div className="flex items-center bg-[#14161f] border border-[#2d3148] p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('scourer')}
            className={clsx(
              'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5',
              activeTab === 'scourer'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-300" />
            <span>Web Scourer</span>
            <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-purple-400/20 text-purple-200">
              Live
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('curated')}
            className={clsx(
              'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5',
              activeTab === 'curated'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            <Globe className="w-3.5 h-3.5 text-indigo-300" />
            <span>Curated List</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('saved')}
            className={clsx(
              'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5',
              activeTab === 'saved'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            <Star className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
            <span>Saved Library</span>
            {savedSnis.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/30 font-mono">
                {savedSnis.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Network Intelligence: Dual Endpoint Geolocation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Client Network */}
        <div className="bg-[#14161f] border border-[#2d3148] rounded-2xl p-4 shadow-sm relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-600/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
                <User className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] font-semibold tracking-wider uppercase text-purple-400">
                  Your Client Network
                </span>
                <h4 className="text-sm font-bold text-white">
                  {locationsLoading ? 'Detecting…' : locations?.client?.isp || 'Unknown ISP'}
                </h4>
              </div>
            </div>

            {locations?.client?.countryCode && (
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {locations.client.countryCode}
              </span>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-[#2d3148]/60 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-500 block text-[10px]">Client IP</span>
              <span className="font-mono text-slate-300">
                {locations?.client?.ip || '127.0.0.1'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Location</span>
              <span className="text-slate-300">
                {locations?.client?.country || 'Unknown'} {locations?.client?.city ? `(${locations.client.city})` : ''}
              </span>
            </div>
          </div>

          <div className="mt-3 text-[11px] flex items-center gap-1.5 text-slate-400 bg-slate-900/60 p-2 rounded-lg">
            <Info className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
            <span>
              Target Camouflage Region:{' '}
              <strong className="text-indigo-300 font-semibold">
                {locations?.suggestedRegion === 'RU'
                  ? 'Russia (TSPU DPI Bypass)'
                  : locations?.suggestedRegion === 'IR'
                  ? 'Iran (NIN Intranet Whitelist)'
                  : locations?.suggestedRegion === 'CN'
                  ? 'China (GFW Whitelist)'
                  : 'Global CDNs'}
              </strong>
            </span>
          </div>
        </div>

        {/* VPN Server Network */}
        <div className="bg-[#14161f] border border-[#2d3148] rounded-2xl p-4 shadow-sm relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] font-semibold tracking-wider uppercase text-indigo-400">
                  VPN Server Host
                </span>
                <h4 className="text-sm font-bold text-white">
                  {locationsLoading ? 'Detecting…' : locations?.server?.isp || 'Hosting Datacenter'}
                </h4>
              </div>
            </div>

            {locations?.server?.countryCode && (
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {locations.server.countryCode}
              </span>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-[#2d3148]/60 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-500 block text-[10px]">Server Public IP</span>
              <span className="font-mono text-slate-300">
                {locations?.server?.ip || 'Configured Node'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Datacenter Region</span>
              <span className="text-slate-300">
                {locations?.server?.country || 'Server Location'} {locations?.server?.city ? `(${locations.server.city})` : ''}
              </span>
            </div>
          </div>

          <div className="mt-3 text-[11px] flex items-center gap-1.5 text-slate-400 bg-slate-900/60 p-2 rounded-lg">
            <Lock className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span>
              Server TLS Engine:{' '}
              <strong className="text-emerald-300 font-semibold">
                Direct Outbound TLS 1.3 Handshake Probe Active
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────
          TAB 1: LIVE WEB SCOURER
      ────────────────────────────────────────────────────────────── */}
      {activeTab === 'scourer' && (
        <div className="space-y-4">
          <div className="bg-[#14161f] border border-purple-500/30 rounded-2xl p-5 shadow-lg shadow-purple-500/5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  Live Web Camouflage Scourer
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Crawls the live web dynamically to find unblocked CDN assets, media hostnames, and subdomains that filters cannot block without breaking domestic websites.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Target Region:</span>
                <select
                  value={scourRegion}
                  onChange={(e) => setScourRegion(e.target.value)}
                  className="bg-[#1a1d27] border border-[#2d3148] rounded-xl px-2.5 py-1 text-xs text-white focus:outline-none focus:border-purple-500 font-medium"
                >
                  <option value="AUTO">⚡ Auto ({locations?.suggestedRegion || 'GLOBAL'})</option>
                  <option value="RU">🇷🇺 Russia (TSPU Whitelist)</option>
                  <option value="IR">🇮🇷 Iran (NIN Intranet)</option>
                  <option value="CN">🇨🇳 China (GFW Whitelist)</option>
                  <option value="GLOBAL">🌐 Global CDNs</option>
                </select>
              </div>
            </div>

            {/* Scour Mode Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => {
                  setScourMode('regional')
                  setScourTarget('')
                }}
                className={clsx(
                  'p-3 rounded-xl border text-left transition',
                  scourMode === 'regional'
                    ? 'bg-purple-600/20 border-purple-500/60 text-white'
                    : 'bg-[#1a1d27]/70 border-[#2d3148] text-slate-400 hover:text-slate-200'
                )}
              >
                <div className="flex items-center gap-2 font-semibold text-xs text-purple-300">
                  <Globe className="w-4 h-4" />
                  Regional Ecosystem Scout
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Crawls top regional web hubs and extracts their live CDN and infrastructure dependencies.
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setScourMode('subdomains')
                  if (!scourTarget) setScourTarget('apple.com')
                }}
                className={clsx(
                  'p-3 rounded-xl border text-left transition',
                  scourMode === 'subdomains'
                    ? 'bg-purple-600/20 border-purple-500/60 text-white'
                    : 'bg-[#1a1d27]/70 border-[#2d3148] text-slate-400 hover:text-slate-200'
                )}
              >
                <div className="flex items-center gap-2 font-semibold text-xs text-purple-300">
                  <Cpu className="w-4 h-4" />
                  Subdomain Hunter
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Finds hidden subdomains of trusted networks (NVIDIA, Apple, Microsoft, Yandex, etc.).
                </p>
              </button>

              <button
                type="button"
                onClick={() => {
                  setScourMode('crawl_url')
                  if (!scourTarget) setScourTarget('https://ya.ru')
                }}
                className={clsx(
                  'p-3 rounded-xl border text-left transition',
                  scourMode === 'crawl_url'
                    ? 'bg-purple-600/20 border-purple-500/60 text-white'
                    : 'bg-[#1a1d27]/70 border-[#2d3148] text-slate-400 hover:text-slate-200'
                )}
              >
                <div className="flex items-center gap-2 font-semibold text-xs text-purple-300">
                  <Link2 className="w-4 h-4" />
                  Target URL Deep Crawler
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Crawl ANY site (bank, news, telecom) to extract its external CDNs, fonts, and assets.
                </p>
              </button>
            </div>

            {/* Mode-specific input & presets */}
            <form onSubmit={handleRunScourer} className="space-y-3 pt-2 border-t border-[#2d3148]">
              {scourMode === 'subdomains' && (
                <div>
                  <label className="text-xs text-slate-300 block mb-1">Parent Root Domain</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {['apple.com', 'nvidia.com', 'microsoft.com', 'yandex.ru', 'vk.com', 'samsung.com', 'cloudflare.com'].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setScourTarget(p)}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="e.g. apple.com, nvidia.com, yandex.ru"
                    value={scourTarget}
                    onChange={(e) => setScourTarget(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>
              )}

              {scourMode === 'crawl_url' && (
                <div>
                  <label className="text-xs text-slate-300 block mb-1">Target Website URL to Crawl</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {[
                      'https://ya.ru',
                      'https://habr.com/ru/all/',
                      'https://aliexpress.ru',
                      'https://www.aparat.com',
                      'https://www.digikala.com',
                      'https://speedtest.net',
                    ].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setScourTarget(p)}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition"
                      >
                        {p.replace(/^https?:\/\//, '')}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="https://example.com"
                    value={scourTarget}
                    onChange={(e) => setScourTarget(e.target.value)}
                    className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">Benchmark Limit:</span>
                  <select
                    value={scourLimit}
                    onChange={(e) => setScourLimit(e.target.value)}
                    className="bg-[#1a1d27] border border-[#2d3148] rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none"
                  >
                    <option value="10">Top 10 candidates</option>
                    <option value="15">Top 15 candidates</option>
                    <option value="25">Top 25 candidates</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={scouring}
                  className="px-6 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/30 transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Sparkles className={clsx('w-4 h-4', scouring && 'animate-spin')} />
                  <span>{scouring ? 'Scouring & Benchmarking…' : '▶ Scour the Web Now'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Scour Progress Banner */}
          {scouring && (
            <div className="p-6 bg-[#14161f] border border-purple-500/40 rounded-2xl text-center space-y-3 shadow-lg">
              <RefreshCw className="w-8 h-8 text-purple-400 animate-spin mx-auto" />
              <h4 className="text-sm font-bold text-white tracking-wide">
                Autonomous Web Discovery in Progress
              </h4>
              <p className="text-xs font-mono text-purple-300">{scourPhase}</p>
              <p className="text-[11px] text-slate-500">
                Crawling DOM trees, querying DNS resolution, and validating TLS 1.3 / HTTP/2 handshakes
              </p>
            </div>
          )}

          {/* Scour Results Display */}
          {scourResults.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span>Live Discovered SNIs</span>
                  </h3>
                  <span className="text-xs text-slate-400 font-mono">
                    ({scourMeta?.benchmarkedCount} tested of {scourMeta?.totalDiscovered} found)
                  </span>
                </div>

                <span className="text-xs text-slate-500">Source: {scourMeta?.source}</span>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {scourResults.map((item, idx) => {
                  const clientProbe = clientLatencies[item.domain]
                  const isTop = idx === 0
                  const isIdeal = item.rating === 'IDEAL'
                  const saved = isAlreadySaved(item.domain)

                  return (
                    <div
                      key={item.domain}
                      className={clsx(
                        'bg-[#14161f] border rounded-2xl p-4 transition-all duration-150 relative overflow-hidden',
                        isTop ? 'border-emerald-500/40 shadow-lg shadow-emerald-500/5' : isIdeal ? 'border-purple-500/30' : 'border-[#2d3148]'
                      )}
                    >
                      {isTop && (
                        <div className="absolute top-0 right-0 px-3 py-0.5 bg-gradient-to-l from-emerald-600 to-purple-600 text-white text-[10px] font-bold rounded-bl-xl tracking-wider uppercase flex items-center gap-1 shadow-sm">
                          <Zap className="w-3 h-3 fill-white" />
                          #1 Discovered Pick
                        </div>
                      )}

                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        {/* Left: Domain & Discovery Tag */}
                        <div className="space-y-1.5 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-bold text-white tracking-wide">
                              {item.domain}
                            </span>
                            {getRatingBadge(item.rating)}
                            <span className="text-[10px] text-purple-300 bg-purple-900/30 border border-purple-500/30 px-2 py-0.5 rounded">
                              Live Scoured
                            </span>
                          </div>

                          <p className="text-xs text-slate-400">
                            {item.recommendation || 'Scouted dynamically from live web assets and DNS records.'}
                          </p>

                          {/* Technical Specs Badges */}
                          <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                            <span
                              className={clsx(
                                'px-2 py-0.5 rounded font-mono font-medium border',
                                item.tls?.supportsTls13
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              )}
                            >
                              {item.tls?.protocol || 'TLS'} {item.tls?.supportsTls13 ? '(TLS 1.3)' : ''}
                            </span>

                            <span
                              className={clsx(
                                'px-2 py-0.5 rounded font-mono font-medium border',
                                item.tls?.supportsH2
                                  ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                                  : 'bg-slate-800 text-slate-400 border-slate-700'
                              )}
                            >
                              ALPN: {item.tls?.alpn || 'none'}
                            </span>

                            <span
                              className={clsx(
                                'px-2 py-0.5 rounded font-medium border flex items-center gap-1',
                                item.cert?.matchesDomain
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                              )}
                            >
                              {item.cert?.matchesDomain ? <Check className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              Cert SAN {item.cert?.matchesDomain ? 'Match' : 'Mismatch'}
                            </span>

                            {item.cert?.issuer && (
                              <span className="text-slate-500 hidden sm:inline">
                                CA: {item.cert.issuer}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Middle: Latency & Score */}
                        <div className="flex items-center gap-4 lg:gap-6 border-t lg:border-t-0 border-[#2d3148] pt-3 lg:pt-0">
                          <div className="text-center min-w-[70px]">
                            <span className="text-[10px] text-slate-500 block uppercase tracking-wider">VPS Latency</span>
                            <span className="font-mono font-bold text-xs text-indigo-300">
                              {item.totalLatencyMs > 0 ? `${item.totalLatencyMs} ms` : '—'}
                            </span>
                          </div>

                          <div className="text-center min-w-[80px]">
                            <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Client Browser</span>
                            {clientProbe ? (
                              clientProbe.reachable ? (
                                <span className="font-mono font-bold text-xs text-emerald-400">
                                  {clientProbe.latencyMs} ms
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold text-rose-400 flex items-center justify-center gap-0.5">
                                  <ShieldAlert className="w-3 h-3" /> Blocked
                                </span>
                              )
                            ) : (
                              <span className="text-[10px] text-slate-500 animate-pulse">Probing…</span>
                            )}
                          </div>

                          <div className="text-center min-w-[60px]">
                            <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Score</span>
                            <span
                              className={clsx(
                                'font-mono font-black text-base',
                                item.score >= 90 ? 'text-emerald-400' : item.score >= 70 ? 'text-purple-400' : 'text-amber-400'
                              )}
                            >
                              {item.score}
                            </span>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              title={saved ? 'Already in Saved Library' : 'Bookmark & Save to Library'}
                              onClick={() => handleSaveSni(item)}
                              className={clsx(
                                'p-2 rounded-xl transition',
                                saved ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300'
                              )}
                            >
                              <Star className={clsx('w-4 h-4', saved && 'fill-amber-400')} />
                            </button>

                            <button
                              type="button"
                              title="Copy SNI domain"
                              onClick={() => copyToClipboard(item.domain, `scour-sni-${item.domain}`)}
                              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition"
                            >
                              {copiedKey === `scour-sni-${item.domain}` ? (
                                <Check className="w-4 h-4 text-emerald-400" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </button>

                            <button
                              type="button"
                              title="Detailed Certificate Inspection"
                              onClick={() => setSelectedDetails(item)}
                              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-indigo-300 transition"
                            >
                              <Sliders className="w-4 h-4" />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                navigate('/inbounds', { state: { prefillSni: item.domain, prefillDest: `${item.domain}:443` } })
                              }}
                              className="px-3 py-2 rounded-xl bg-purple-600/30 hover:bg-purple-600 text-purple-200 hover:text-white text-xs font-semibold border border-purple-500/40 transition flex items-center gap-1"
                            >
                              <span>Use</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────
          TAB 2: CURATED PRESETS
      ────────────────────────────────────────────────────────────── */}
      {activeTab === 'curated' && (
        <div className="space-y-4">
          {/* Target Censorship Filter Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#14161f] border border-[#2d3148] p-2 rounded-2xl">
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'AUTO', label: '⚡ Auto Detect', sub: locations?.suggestedRegion || 'GLOBAL' },
                { id: 'RU', label: '🇷🇺 Russia', sub: 'TSPU Bypass' },
                { id: 'IR', label: '🇮🇷 Iran', sub: 'NIN Intranet' },
                { id: 'CN', label: '🇨🇳 China', sub: 'GFW Friendly' },
                { id: 'GLOBAL', label: '🌐 Global CDN', sub: 'High Speed' },
                { id: 'ALL', label: '📋 All Candidates', sub: 'Comprehensive' },
              ].map((tab) => {
                const isActive = selectedRegion === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setSelectedRegion(tab.id)
                      handleRunCuratedBenchmark(tab.id)
                    }}
                    className={clsx(
                      'px-3 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5',
                      isActive
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    )}
                  >
                    <span>{tab.label}</span>
                    <span className={clsx('text-[10px]', isActive ? 'text-indigo-200' : 'text-slate-500')}>
                      ({tab.sub})
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleRunCuratedBenchmark(selectedRegion)}
                disabled={curatedBenchmarking}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition disabled:opacity-50"
              >
                <RefreshCw className={clsx('w-3.5 h-3.5', curatedBenchmarking && 'animate-spin')} />
                {curatedBenchmarking ? 'Benchmarking…' : 'Re-test'}
              </button>
            </div>
          </div>

          {/* Curated Candidates Cards */}
          <div className="grid grid-cols-1 gap-3">
            {curatedResults.map((item, idx) => {
              const clientProbe = clientLatencies[item.domain]
              const isIdeal = item.rating === 'IDEAL'
              const isTop = idx === 0
              const saved = isAlreadySaved(item.domain)

              return (
                <div
                  key={item.domain}
                  className={clsx(
                    'bg-[#14161f] border rounded-2xl p-4 transition-all duration-150 relative overflow-hidden',
                    isTop ? 'border-emerald-500/40 shadow-lg shadow-emerald-500/5' : isIdeal ? 'border-indigo-500/30' : 'border-[#2d3148]'
                  )}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-white tracking-wide">
                          {item.domain}
                        </span>
                        {getRatingBadge(item.rating)}
                        {item.label && (
                          <span className="text-[11px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/60">
                            {item.label}
                          </span>
                        )}
                      </div>

                      {item.desc && (
                        <p className="text-xs text-slate-400 max-w-2xl">{item.desc}</p>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded font-mono font-medium border',
                            item.tls?.supportsTls13
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          )}
                        >
                          {item.tls?.protocol || 'TLS'} {item.tls?.supportsTls13 ? '(TLS 1.3)' : ''}
                        </span>

                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded font-mono font-medium border',
                            item.tls?.supportsH2
                              ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          )}
                        >
                          ALPN: {item.tls?.alpn || 'none'}
                        </span>

                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded font-medium border flex items-center gap-1',
                            item.cert?.matchesDomain
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          )}
                        >
                          {item.cert?.matchesDomain ? <Check className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          Cert SAN {item.cert?.matchesDomain ? 'Match' : 'Mismatch'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 lg:gap-6 border-t lg:border-t-0 border-[#2d3148] pt-3 lg:pt-0">
                      <div className="text-center min-w-[70px]">
                        <span className="text-[10px] text-slate-500 block uppercase tracking-wider">VPS Latency</span>
                        <span className="font-mono font-bold text-xs text-indigo-300">
                          {item.totalLatencyMs > 0 ? `${item.totalLatencyMs} ms` : '—'}
                        </span>
                      </div>

                      <div className="text-center min-w-[80px]">
                        <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Client Browser</span>
                        {clientProbe ? (
                          clientProbe.reachable ? (
                            <span className="font-mono font-bold text-xs text-emerald-400">
                              {clientProbe.latencyMs} ms
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-rose-400 flex items-center justify-center gap-0.5">
                              <ShieldAlert className="w-3 h-3" /> Blocked
                            </span>
                          )
                        ) : (
                          <span className="text-[10px] text-slate-500 animate-pulse">Probing…</span>
                        )}
                      </div>

                      <div className="text-center min-w-[60px]">
                        <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Score</span>
                        <span className="font-mono font-black text-base text-emerald-400">
                          {item.score}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          title={saved ? 'Already in Saved Library' : 'Save to Library'}
                          onClick={() => handleSaveSni(item)}
                          className={clsx(
                            'p-2 rounded-xl transition',
                            saved ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300'
                          )}
                        >
                          <Star className={clsx('w-4 h-4', saved && 'fill-amber-400')} />
                        </button>

                        <button
                          type="button"
                          title="Copy SNI domain"
                          onClick={() => copyToClipboard(item.domain, `curated-sni-${item.domain}`)}
                          className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition"
                        >
                          {copiedKey === `curated-sni-${item.domain}` ? (
                            <Check className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          type="button"
                          title="Inspect Certificate"
                          onClick={() => setSelectedDetails(item)}
                          className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-indigo-300 transition"
                        >
                          <Sliders className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            navigate('/inbounds', { state: { prefillSni: item.domain, prefillDest: `${item.domain}:443` } })
                          }}
                          className="px-3 py-2 rounded-xl bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white text-xs font-semibold border border-indigo-500/40 transition flex items-center gap-1"
                        >
                          <span>Use</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────
          TAB 3: SAVED SNIS LIBRARY
      ────────────────────────────────────────────────────────────── */}
      {activeTab === 'saved' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-[#14161f] border border-[#2d3148] p-3 rounded-2xl">
            <div className="flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
              <h3 className="text-sm font-bold text-white">Your Saved Camouflage SNIs Library</h3>
              <span className="text-xs text-slate-400 font-mono">({savedSnis.length} saved)</span>
            </div>

            <div className="w-64">
              <input
                type="text"
                placeholder="Search saved SNIs…"
                value={savedSearch}
                onChange={(e) => setSavedSearch(e.target.value)}
                className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {savedSnis.length === 0 ? (
            <div className="p-8 text-center bg-[#14161f] border border-[#2d3148] rounded-2xl space-y-2">
              <Bookmark className="w-8 h-8 text-slate-500 mx-auto" />
              <p className="text-sm text-slate-300">No SNIs saved in your library yet.</p>
              <p className="text-xs text-slate-500">
                Run the <strong>Web Scourer</strong> or browse the <strong>Curated List</strong> and click the ⭐ Star button on any domain to save it.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {savedSnis
                .filter((s) => !savedSearch || s.domain.toLowerCase().includes(savedSearch.toLowerCase()))
                .map((item) => (
                  <div
                    key={item.id}
                    className="bg-[#14161f] border border-amber-500/30 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-white">{item.domain}</span>
                        {getRatingBadge(item.rating)}
                        <span className="text-[10px] text-amber-300 bg-amber-900/30 px-2 py-0.5 rounded border border-amber-500/30">
                          {item.source}
                        </span>
                      </div>

                      {item.notes && <p className="text-xs text-slate-400">{item.notes}</p>}

                      <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-1">
                        <span>TLS: {item.tls_protocol || 'TLS 1.3'}</span>
                        <span>•</span>
                        <span>ALPN: {item.alpn || 'h2'}</span>
                        <span>•</span>
                        <span>Saved: {new Date(item.created_at * 1000).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-center min-w-[60px]">
                        <span className="text-[10px] text-slate-500 block uppercase">Score</span>
                        <span className="font-mono font-bold text-base text-emerald-400">{item.score}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          title="Copy SNI domain"
                          onClick={() => copyToClipboard(item.domain, `saved-sni-${item.id}`)}
                          className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition"
                        >
                          {copiedKey === `saved-sni-${item.id}` ? (
                            <Check className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            navigate('/inbounds', { state: { prefillSni: item.domain, prefillDest: `${item.domain}:${item.port || 443}` } })
                          }}
                          className="px-3 py-2 rounded-xl bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white text-xs font-semibold border border-indigo-500/40 transition flex items-center gap-1"
                        >
                          <span>Use for Inbound</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          title="Delete from Library"
                          onClick={() => handleDeleteSaved(item.id, item.domain)}
                          className="p-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 transition border border-rose-500/30"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Custom Domain Deep Inspector Bar */}
      <div className="bg-[#14161f] border border-[#2d3148] rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Search className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-white">Deep-Probe Any Single Custom Domain</h3>
        </div>
        <form onSubmit={handleTestCustom} className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <input
              type="text"
              placeholder="e.g. gateway.icloud.com, dl.epicgames.com, unpkg.com"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="w-24">
            <input
              type="number"
              placeholder="Port"
              value={customPort}
              onChange={(e) => setCustomPort(e.target.value)}
              className="w-full bg-[#1a1d27] border border-[#2d3148] rounded-xl px-3 py-2 text-xs text-white font-mono text-center focus:outline-none focus:border-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={customTesting || !customDomain.trim()}
            className="w-full sm:w-auto px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <Zap className="w-3.5 h-3.5" />
            {customTesting ? 'Testing…' : 'Run Diagnostics'}
          </button>
        </form>

        {customResult && (
          <div className="mt-4 p-4 rounded-xl bg-[#1a1d27] border border-indigo-500/30 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-white">{customResult.domain}</span>
                {getRatingBadge(customResult.rating)}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Anti-Censorship Score:</span>
                <span className="font-mono font-bold text-base text-emerald-400">{customResult.score}/100</span>
              </div>
            </div>

            <p className="text-xs text-slate-300">{customResult.recommendation}</p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleSaveSni(customResult)}
                className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs flex items-center gap-1.5 transition border border-amber-500/30"
              >
                <Star className="w-3.5 h-3.5" />
                Save to Library
              </button>
              <button
                type="button"
                onClick={() => copyToClipboard(customResult.domain, 'custom-sni')}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 transition"
              >
                {copiedKey === 'custom-sni' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                Copy SNI
              </button>
              <button
                type="button"
                onClick={() => setSelectedDetails(customResult)}
                className="px-3 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-300 text-xs flex items-center gap-1.5 transition border border-indigo-500/30"
              >
                <Sliders className="w-3.5 h-3.5" />
                Inspect Certificate
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Deep Technical Certificate Modal */}
      {selectedDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-[#14161f] border border-[#2d3148] rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-[#2d3148] pb-3">
              <div className="flex items-center gap-2">
                <Radar className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-white font-mono">{selectedDetails.domain}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDetails(null)}
                className="text-slate-400 hover:text-white text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between bg-slate-900/60 p-2.5 rounded-xl">
                <span className="text-slate-400">Anti-Censorship Score:</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">{selectedDetails.score}/100</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#1a1d27] p-2.5 rounded-xl border border-[#2d3148]">
                  <span className="text-slate-500 text-[10px] block">TLS Protocol</span>
                  <span className="font-mono text-white font-semibold">{selectedDetails.tls?.protocol || 'Unknown'}</span>
                </div>
                <div className="bg-[#1a1d27] p-2.5 rounded-xl border border-[#2d3148]">
                  <span className="text-slate-500 text-[10px] block">ALPN Protocol</span>
                  <span className="font-mono text-white font-semibold">{selectedDetails.tls?.alpn || 'None'}</span>
                </div>
                <div className="bg-[#1a1d27] p-2.5 rounded-xl border border-[#2d3148]">
                  <span className="text-slate-500 text-[10px] block">Cipher Suite</span>
                  <span className="font-mono text-white text-[11px] truncate block">{selectedDetails.tls?.cipher || 'Default'}</span>
                </div>
                <div className="bg-[#1a1d27] p-2.5 rounded-xl border border-[#2d3148]">
                  <span className="text-slate-500 text-[10px] block">Certificate CN</span>
                  <span className="font-mono text-white text-[11px] truncate block">{selectedDetails.cert?.subjectCn || 'Unknown'}</span>
                </div>
              </div>

              <div className="bg-[#1a1d27] p-3 rounded-xl border border-[#2d3148] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Issuer CA:</span>
                  <span className="font-mono text-slate-200">{selectedDetails.cert?.issuer || 'Unknown'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Cert Expiry:</span>
                  <span className="font-mono text-slate-200">
                    {selectedDetails.cert?.validTo ? selectedDetails.cert.validTo.slice(0, 10) : 'Unknown'} ({selectedDetails.cert?.daysRemaining || 0} days remaining)
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">SAN Verification:</span>
                  <span className={clsx('font-semibold', selectedDetails.cert?.matchesDomain ? 'text-emerald-400' : 'text-rose-400')}>
                    {selectedDetails.cert?.matchesDomain ? 'Exact / Wildcard SAN Match' : 'Domain Mismatch'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">DNS Resolution:</span>
                  <span className="font-mono text-slate-200">{selectedDetails.dns?.ips?.length ? selectedDetails.dns.ips[0] : 'None'}</span>
                </div>
              </div>

              {selectedDetails.recommendation && (
                <div className="p-2.5 rounded-xl bg-indigo-900/20 border border-indigo-500/30 text-indigo-300 text-xs">
                  {selectedDetails.recommendation}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2d3148]">
              <button
                type="button"
                onClick={() => handleSaveSni(selectedDetails)}
                className="px-3.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold transition border border-amber-500/30 flex items-center gap-1"
              >
                <Star className="w-3.5 h-3.5" />
                Save to Library
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedDetails(null)
                  navigate('/inbounds', { state: { prefillSni: selectedDetails.domain, prefillDest: `${selectedDetails.domain}:443` } })
                }}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
              >
                Create Inbound with this SNI
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
