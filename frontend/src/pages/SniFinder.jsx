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
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import api from '../utils/api'

export default function SniFinder() {
  const navigate = useNavigate()

  // State
  const [locations, setLocations] = useState(null)
  const [locationsLoading, setLocationsLoading] = useState(true)
  const [selectedRegion, setSelectedRegion] = useState('AUTO')
  const [benchmarking, setBenchmarking] = useState(false)
  const [benchmarkResults, setBenchmarkResults] = useState([])
  const [clientLatencies, setClientLatencies] = useState({})
  const [copiedKey, setCopiedKey] = useState(null)

  // Custom Domain Inspection
  const [customDomain, setCustomDomain] = useState('')
  const [customPort, setCustomPort] = useState(443)
  const [customTesting, setCustomTesting] = useState(false)
  const [customResult, setCustomResult] = useState(null)
  const [selectedDetails, setSelectedDetails] = useState(null)

  // Load locations on mount
  useEffect(() => {
    fetchLocations()
  }, [])

  const fetchLocations = async () => {
    setLocationsLoading(true)
    try {
      const res = await api.get('/sni-finder/locations')
      if (res.data?.success) {
        setLocations(res.data.data)
        if (selectedRegion === 'AUTO') {
          // Keep AUTO but we know suggestedRegion
        }
      }
    } catch (err) {
      toast.error('Failed to detect network locations: ' + (err.response?.data?.message || err.message))
    } finally {
      setLocationsLoading(false)
    }
  }

  // Active target region (resolves AUTO to suggestedRegion or client country)
  const activeRegion = useMemo(() => {
    if (selectedRegion !== 'AUTO') return selectedRegion
    return locations?.suggestedRegion || 'GLOBAL'
  }, [selectedRegion, locations])

  // Trigger benchmark
  const handleRunBenchmark = async (regionOverride = null) => {
    setBenchmarking(true)
    const targetRegion = regionOverride || selectedRegion
    try {
      const res = await api.post('/sni-finder/benchmark', {
        region: targetRegion,
        clientCountry: locations?.client?.countryCode || 'GLOBAL',
        concurrency: 4,
      })

      if (res.data?.success) {
        const results = res.data.data.results || []
        setBenchmarkResults(results)
        toast.success(`Benchmarked ${results.length} SNI candidates!`)
        // Trigger client-side browser reachability probes for each candidate
        probeClientReachability(results)
      }
    } catch (err) {
      toast.error('Benchmark failed: ' + (err.response?.data?.message || err.message))
    } finally {
      setBenchmarking(false)
    }
  }

  // Probe reachability & latency directly from the client's browser
  const probeClientReachability = async (candidates) => {
    const latencies = { ...clientLatencies }
    for (const item of candidates) {
      const domain = item.domain
      const start = Date.now()
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 2500)
        // Request favicon or image over HTTPS using no-cors
        await fetch(`https://${domain}/favicon.ico?_v=${Date.now()}`, {
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal,
        })
        clearTimeout(timeout)
        latencies[domain] = { reachable: true, latencyMs: Date.now() - start }
      } catch (err) {
        // If aborted or connection refused
        latencies[domain] = { reachable: false, latencyMs: null, blocked: true }
      }
      setClientLatencies({ ...latencies })
    }
  }

  // Auto-run first benchmark when locations finish loading
  useEffect(() => {
    if (locations && benchmarkResults.length === 0 && !benchmarking) {
      handleRunBenchmark('AUTO')
    }
  }, [locations])

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
              Ideal SNI Camouflage Finder
            </h2>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-indigo-600/30 text-indigo-300 border border-indigo-500/30">
              Anti-Censorship
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Tests real TLS 1.3 handshakes, ALPN HTTP/2 negotiation, certificate hygiene, and dual-ended latency to find the perfect disguise domain for Reality, Shadow-TLS, and Trojan.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleRunBenchmark(selectedRegion)}
            disabled={benchmarking}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition disabled:opacity-50"
          >
            <RefreshCw className={clsx('w-3.5 h-3.5', benchmarking && 'animate-spin')} />
            {benchmarking ? 'Benchmarking…' : 'Run Benchmark'}
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
                  handleRunBenchmark(tab.id)
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

        <div className="text-xs text-slate-400 px-2">
          Candidates Tested: <strong className="text-white font-mono">{benchmarkResults.length}</strong>
        </div>
      </div>

      {/* Custom Domain Probe Bar */}
      <div className="bg-[#14161f] border border-[#2d3148] rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Search className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-white">Deep-Probe Any Custom SNI Domain</h3>
        </div>
        <form onSubmit={handleTestCustom} className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <input
              type="text"
              placeholder="e.g. gateway.icloud.com, dl.epicgames.com, speedtest.net"
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
            className="w-full sm:w-auto px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md shadow-purple-600/30 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <Zap className="w-3.5 h-3.5" />
            {customTesting ? 'Testing…' : 'Run Diagnostics'}
          </button>
        </form>

        {/* Custom Domain Result Card */}
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

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[#2d3148] text-xs">
              <div>
                <span className="text-slate-500 block text-[10px]">TLS Protocol</span>
                <span className={clsx('font-mono font-semibold', customResult.tls.supportsTls13 ? 'text-emerald-400' : 'text-amber-400')}>
                  {customResult.tls.protocol || 'None'} {customResult.tls.supportsTls13 ? '(TLS 1.3)' : ''}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">ALPN HTTP/2</span>
                <span className={clsx('font-mono font-semibold', customResult.tls.supportsH2 ? 'text-emerald-400' : 'text-slate-400')}>
                  {customResult.tls.alpn || 'None'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Cert SAN Match</span>
                <span className={clsx('font-semibold', customResult.cert.matchesDomain ? 'text-emerald-400' : 'text-rose-400')}>
                  {customResult.cert.matchesDomain ? 'Matches SNI' : 'Mismatch'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">VPS Latency</span>
                <span className="font-mono text-indigo-300">{customResult.totalLatencyMs} ms</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
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
                onClick={() => copyToClipboard(`${customResult.domain}:443`, 'custom-dest')}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 transition"
              >
                {copiedKey === 'custom-dest' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                Copy Dest
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

      {/* Benchmark Candidates List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <span>Ranked SNI Candidates</span>
            <span className="text-xs font-normal text-slate-400">
              (Filtered for {activeRegion === 'RU' ? 'Russia' : activeRegion === 'IR' ? 'Iran' : activeRegion === 'CN' ? 'China' : 'Global'})
            </span>
          </h3>

          <span className="text-xs text-slate-500">Sorted by Camouflage Score & Handshake Speed</span>
        </div>

        {benchmarking && benchmarkResults.length === 0 ? (
          <div className="p-8 text-center bg-[#14161f] border border-[#2d3148] rounded-2xl space-y-3">
            <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mx-auto" />
            <p className="text-sm text-slate-300">Benchmarking TLS handshakes across censorship nodes…</p>
            <p className="text-xs text-slate-500">Testing TLS 1.3 protocol negotiation, ALPN, certificate CN/SANs, and edge latency</p>
          </div>
        ) : benchmarkResults.length === 0 ? (
          <div className="p-8 text-center bg-[#14161f] border border-[#2d3148] rounded-2xl space-y-2">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
            <p className="text-sm text-slate-300">No benchmark results available yet.</p>
            <button
              type="button"
              onClick={() => handleRunBenchmark(selectedRegion)}
              className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition"
            >
              Start Benchmark
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {benchmarkResults.map((item, idx) => {
              const clientProbe = clientLatencies[item.domain]
              const isIdeal = item.rating === 'IDEAL'
              const isTop = idx === 0

              return (
                <div
                  key={item.domain}
                  className={clsx(
                    'bg-[#14161f] border rounded-2xl p-4 transition-all duration-150 relative overflow-hidden',
                    isTop ? 'border-emerald-500/40 shadow-lg shadow-emerald-500/5' : isIdeal ? 'border-indigo-500/30' : 'border-[#2d3148]'
                  )}
                >
                  {isTop && (
                    <div className="absolute top-0 right-0 px-3 py-0.5 bg-gradient-to-l from-emerald-600 to-indigo-600 text-white text-[10px] font-bold rounded-bl-xl tracking-wider uppercase flex items-center gap-1 shadow-sm">
                      <Zap className="w-3 h-3 fill-white" />
                      #1 Top Pick
                    </div>
                  )}

                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left: Domain & Description */}
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

                      {/* Technical Specs Badges */}
                      <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded font-mono font-medium border',
                            item.tls.supportsTls13
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          )}
                        >
                          {item.tls.protocol || 'TLS'} {item.tls.supportsTls13 ? '(TLS 1.3)' : ''}
                        </span>

                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded font-mono font-medium border',
                            item.tls.supportsH2
                              ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          )}
                        >
                          ALPN: {item.tls.alpn || 'none'}
                        </span>

                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded font-medium border flex items-center gap-1',
                            item.cert.matchesDomain
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          )}
                        >
                          {item.cert.matchesDomain ? <Check className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          Cert SAN {item.cert.matchesDomain ? 'Match' : 'Mismatch'}
                        </span>

                        {item.cert.issuer && (
                          <span className="text-slate-500 hidden sm:inline">
                            CA: {item.cert.issuer}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Middle: Latencies & Score */}
                    <div className="flex items-center gap-4 lg:gap-6 border-t lg:border-t-0 border-[#2d3148] pt-3 lg:pt-0">
                      {/* VPS to SNI Ping */}
                      <div className="text-center min-w-[70px]">
                        <span className="text-[10px] text-slate-500 block uppercase tracking-wider">VPS Latency</span>
                        <span className="font-mono font-bold text-xs text-indigo-300">
                          {item.totalLatencyMs > 0 ? `${item.totalLatencyMs} ms` : '—'}
                        </span>
                      </div>

                      {/* Client Browser to SNI Ping */}
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

                      {/* Score Meter */}
                      <div className="text-center min-w-[60px]">
                        <span className="text-[10px] text-slate-500 block uppercase tracking-wider">Score</span>
                        <span
                          className={clsx(
                            'font-mono font-black text-base',
                            item.score >= 90 ? 'text-emerald-400' : item.score >= 70 ? 'text-indigo-400' : 'text-amber-400'
                          )}
                        >
                          {item.score}
                        </span>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          title="Copy SNI domain"
                          onClick={() => copyToClipboard(item.domain, `sni-${item.domain}`)}
                          className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition"
                        >
                          {copiedKey === `sni-${item.domain}` ? (
                            <Check className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          type="button"
                          title="Detailed Handshake Inspection"
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
        )}
      </div>

      {/* Deep Technical Inspection Modal */}
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
                  <span className="font-mono text-slate-200">{selectedDetails.cert?.validTo ? selectedDetails.cert.validTo.slice(0, 10) : 'Unknown'} ({selectedDetails.cert?.daysRemaining || 0} days remaining)</span>
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
                onClick={() => copyToClipboard(selectedDetails.domain, 'modal-sni')}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
              >
                Copy SNI
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
