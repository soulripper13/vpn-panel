import React, { useState } from 'react'
import {
  X,
  Copy,
  Check,
  QrCode,
  FileText,
  Code2,
  Terminal,
  Shield,
  Rss,
  ExternalLink,
  Sparkles,
  Layers,
  Globe,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import {
  generateClashYaml,
  generateSingboxJson,
  generateHysteriaCliConfig,
  extractSettings,
} from '../../utils/links'
import toast from 'react-hot-toast'

export default function QRModal({
  isOpen,
  onClose,
  title = 'Client Subscription & QR',
  link = '',
  clashYaml = '',
  singboxJson = '',
  inbound = null,
  client = null,
}) {
  const [activeTab, setActiveTab] = useState('sub') // 'sub' | 'qr' | 'clash' | 'singbox' | 'hy2'
  const [subFormat, setSubFormat] = useState('clash') // 'clash' | 'base64' | 'singbox'
  const [copiedKey, setCopiedKey] = useState(null)
  const [useRawDelimiters, setUseRawDelimiters] = useState(false)

  if (!isOpen) return null

  // Derive host dynamically from current window location without hardcoding
  const host = typeof window !== 'undefined' ? (window.location.hostname || '') : ''
  const origin = typeof window !== 'undefined' ? (window.location.origin || '') : ''

  const { settings, streamSettings } = extractSettings(inbound)
  const type = (inbound?.type || '').toLowerCase()
  const protocol = (inbound?.protocol || type).toLowerCase()
  const isHysteria =
    type === 'hysteria' ||
    type === 'hysteria2' ||
    protocol === 'hysteria' ||
    protocol === 'hysteria2'
  const isShadowtls =
    type === 'shadowtls' ||
    protocol === 'shadowtls' ||
    settings?.plugin === 'shadow-tls' ||
    Boolean(settings?.shadowtlsPassword)

  // ShadowTLS parameters
  const stlsPassword = client?.password || settings?.shadowtlsPassword || settings?.password || ''
  const sni = settings?.serverName || settings?.sni || 'gateway.icloud.com'
  const ssMethod = settings?.ssMethod || settings?.method || '2022-blake3-aes-128-gcm'
  const ssPassword = settings?.ssPassword || settings?.password || ''
  const version = settings?.shadowtlsVersion || settings?.version || 3
  const remark = client?.remark || client?.email || inbound?.remark || 'VPN'

  // Build subscription URL dynamically
  const subToken = client?.uuid || client?.email || client?.id || (inbound ? `inbound-${inbound.id}` : '')
  const baseSubUrl = client?.subUrl || (subToken ? `${origin}/api/sub/${encodeURIComponent(subToken)}` : '')
  const finalSubUrl = baseSubUrl
    ? (subFormat === 'clash'
        ? `${baseSubUrl}?format=clash`
        : (subFormat === 'singbox' ? `${baseSubUrl}?format=singbox` : `${baseSubUrl}?format=base64`))
    : ''

  // Build dynamic single links based on format toggle
  let activeLink = link
  if (isShadowtls && inbound) {
    try {
      const userinfo = btoa(`${ssMethod}:${ssPassword}`)
      if (useRawDelimiters) {
        // Raw semicolons for clients/scanners expecting unencoded delimiters
        activeLink = `ss://${userinfo}@${host}:${inbound.port}?plugin=shadow-tls;host=${sni};password=${stlsPassword};version=${version}#${encodeURIComponent(remark)}`
      } else {
        // Standard SIP002 percent-encoded format (NO trailing slash before ?plugin=)
        activeLink = `ss://${userinfo}@${host}:${inbound.port}?plugin=shadow-tls%3Bhost%3D${encodeURIComponent(sni)}%3Bpassword%3D${encodeURIComponent(stlsPassword)}%3Bversion%3D${version}#${encodeURIComponent(remark)}`
      }
    } catch {
      activeLink = link
    }
  }

  // If YAML or JSON not provided directly, compute from inbound & client
  const finalClashYaml = clashYaml || (inbound ? generateClashYaml(inbound, client, host) : '')
  const finalSingboxJson = singboxJson || (inbound ? generateSingboxJson(inbound, client, host) : '')
  const finalHy2Cli = inbound ? generateHysteriaCliConfig(inbound, client, host) : ''

  const handleCopy = (text, key) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    toast.success('Copied to clipboard!')
    setTimeout(() => setCopiedKey(null), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl max-w-xl w-full p-6 shadow-2xl flex flex-col max-h-[92vh] space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#2d3148]">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
              <QrCode className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">{title}</h3>
              <p className="text-xs text-slate-400">
                {inbound
                  ? `${inbound.remark || inbound.tag} • ${inbound.engine?.toUpperCase()} • Port ${inbound.port}`
                  : 'Client Connection Details'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Top-Level Tabs */}
        <div className="flex items-center space-x-1.5 p-1 bg-[#14161f] border border-[#2d3148] rounded-xl overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('sub')}
            className={`flex-1 min-w-[130px] py-1.5 px-3 rounded-lg text-xs font-medium transition flex items-center justify-center space-x-1.5 ${
              activeTab === 'sub'
                ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Rss className="w-3.5 h-3.5" />
            <span>Subscription & QR</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('qr')}
            className={`flex-1 min-w-[110px] py-1.5 px-3 rounded-lg text-xs font-medium transition flex items-center justify-center space-x-1.5 ${
              activeTab === 'qr'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Direct Node Link</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('clash')}
            className={`flex-1 min-w-[105px] py-1.5 px-3 rounded-lg text-xs font-medium transition flex items-center justify-center space-x-1.5 ${
              activeTab === 'clash'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Clash YAML</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('singbox')}
            className={`flex-1 min-w-[100px] py-1.5 px-3 rounded-lg text-xs font-medium transition flex items-center justify-center space-x-1.5 ${
              activeTab === 'singbox'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Sing-box JSON</span>
          </button>

          {isHysteria && (
            <button
              type="button"
              onClick={() => setActiveTab('hy2')}
              className={`flex-1 min-w-[100px] py-1.5 px-3 rounded-lg text-xs font-medium transition flex items-center justify-center space-x-1.5 ${
                activeTab === 'hy2'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Hy2 CLI</span>
            </button>
          )}
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto py-1 space-y-4">
          {/* TAB 1: SUBSCRIPTION & QR (Primary for Shadowrocket & Clash) */}
          {activeTab === 'sub' && (
            <div className="space-y-4">
              {/* Format Switcher Pills */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#14161f] border border-[#2d3148] rounded-xl p-2">
                <span className="text-[11px] text-slate-400 font-medium px-1 flex items-center space-x-1">
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Subscription Format:</span>
                </span>
                <div className="flex items-center space-x-1.5 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setSubFormat('clash')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center space-x-1 ${
                      subFormat === 'clash'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-[#1a1d27] text-slate-400 hover:text-slate-200 border border-[#2d3148]'
                    }`}
                  >
                    <Sparkles className="w-3 h-3 text-amber-300" />
                    <span>Shadowrocket / Clash (YAML)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubFormat('base64')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center space-x-1 ${
                      subFormat === 'base64'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-[#1a1d27] text-slate-400 hover:text-slate-200 border border-[#2d3148]'
                    }`}
                  >
                    <Globe className="w-3 h-3" />
                    <span>Universal (Base64)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSubFormat('singbox')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center space-x-1 ${
                      subFormat === 'singbox'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-[#1a1d27] text-slate-400 hover:text-slate-200 border border-[#2d3148]'
                    }`}
                  >
                    <Code2 className="w-3 h-3" />
                    <span>Sing-box (JSON)</span>
                  </button>
                </div>
              </div>

              {/* Informational Guidance Callout */}
              <div className="bg-indigo-500/10 border border-indigo-500/25 rounded-xl p-3 text-xs space-y-1">
                <div className="flex items-center space-x-1.5 text-indigo-300 font-semibold">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span>
                    {subFormat === 'clash'
                      ? 'Recommended for Shadowrocket & Clash Meta'
                      : (subFormat === 'base64' ? 'Universal Base64 Format' : 'Native Sing-box Format')}
                  </span>
                </div>
                <p className="text-slate-300 text-[11px] leading-relaxed">
                  {subFormat === 'clash' ? (
                    isShadowtls ? (
                      <>
                        <strong className="text-white">Shadowrocket Users:</strong> Scan this QR code using Shadowrocket's scanner or add the URL under <em>Type: Subscribe</em>.
                        Shadowrocket will automatically import the node with full <span className="text-amber-300 font-medium">Shadow-TLS plugin settings (host, password, version)</span> perfectly configured!
                      </>
                    ) : (
                      <>
                        <strong className="text-white">Clash & Shadowrocket:</strong> Fetches complete Clash Meta configuration with unified proxy groups and traffic tracking.
                      </>
                    )
                  ) : subFormat === 'base64' ? (
                    'Compatible with v2rayN, Streisand, NekoBox, and standard base64 subscription readers.'
                  ) : (
                    'Native client JSON profile for Sing-box / SagerNet cores.'
                  )}
                </p>
              </div>

              {/* Subscription QR Code Box */}
              <div className="flex flex-col items-center justify-center p-5 bg-white rounded-xl shadow-inner mx-auto w-fit">
                {finalSubUrl ? (
                  <QRCodeSVG value={finalSubUrl} size={200} level="M" />
                ) : (
                  <div className="w-[200px] h-[200px] flex items-center justify-center text-slate-500 text-sm">
                    No subscription token available
                  </div>
                )}
              </div>

              <p className="text-center text-[11px] text-slate-400">
                Scan with Shadowrocket, Clash, or subscription manager
              </p>

              {/* Subscription URL Field */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300 flex items-center space-x-1.5">
                    <Rss className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Subscription URL</span>
                  </label>
                  {finalSubUrl && (
                    <a
                      href={finalSubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 transition flex items-center space-x-1"
                    >
                      <span>Test / View Feed</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={finalSubUrl}
                    className="flex-1 bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-2 text-xs text-slate-300 font-mono focus:outline-none select-all"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopy(finalSubUrl, 'sub')}
                    className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow flex-shrink-0"
                  >
                    {copiedKey === 'sub' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey === 'sub' ? 'Copied' : 'Copy URL'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DIRECT NODE LINK & QR */}
          {activeTab === 'qr' && (
            <div className="space-y-4">
              {/* QR Code container */}
              <div className="flex flex-col items-center justify-center p-5 bg-white rounded-xl shadow-inner mx-auto w-fit">
                {activeLink ? (
                  <QRCodeSVG value={activeLink} size={200} level="M" />
                ) : (
                  <div className="w-[200px] h-[200px] flex items-center justify-center text-slate-500 text-sm">
                    No link available
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center space-y-2">
                <p className="text-center text-[11px] text-slate-400">
                  Scan with NekoBox, Sing-box, v2rayNG, or Shadowrocket
                </p>

                {/* Shadowrocket Format Switcher */}
                {isShadowtls && (
                  <div className="flex items-center space-x-2 bg-[#14161f] border border-[#2d3148] rounded-lg p-1 text-[11px]">
                    <span className="text-slate-500 px-1.5">Direct Link Format:</span>
                    <button
                      type="button"
                      onClick={() => setUseRawDelimiters(false)}
                      className={`px-2 py-0.5 rounded transition ${
                        !useRawDelimiters
                          ? 'bg-indigo-600 text-white font-medium shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      SIP002 Standard (%3B)
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseRawDelimiters(true)}
                      className={`px-2 py-0.5 rounded transition ${
                        useRawDelimiters
                          ? 'bg-purple-600 text-white font-medium shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Raw Delimiters (;)
                    </button>
                  </div>
                )}
              </div>

              {/* ShadowTLS Plugin Details Card */}
              {isShadowtls && (
                <div className="bg-[#14161f] border border-purple-500/30 rounded-xl p-3.5 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between pb-1.5 border-b border-[#2d3148]">
                    <div className="flex items-center space-x-1.5 text-purple-300 font-semibold">
                      <Shield className="w-4 h-4 text-purple-400" />
                      <span>Shadow-TLS Plugin Parameters</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          `shadow-tls;host=${sni};password=${stlsPassword};version=${version}`,
                          'pluginOpts'
                        )
                      }
                      className="text-[11px] text-purple-400 hover:text-purple-300 transition flex items-center space-x-1"
                    >
                      {copiedKey === 'pluginOpts' ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedKey === 'pluginOpts' ? 'Copied' : 'Copy Plugin String'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                    <div className="bg-[#1a1d27] p-2 rounded-lg border border-[#2d3148]">
                      <span className="text-slate-500 block text-[10px]">Plugin Name</span>
                      <span className="text-white font-medium">shadow-tls</span>
                    </div>
                    <div className="bg-[#1a1d27] p-2 rounded-lg border border-[#2d3148] flex items-center justify-between">
                      <div className="overflow-hidden">
                        <span className="text-slate-500 block text-[10px]">Host / SNI</span>
                        <span className="text-white font-medium truncate block">{sni}</span>
                      </div>
                      <button
                        onClick={() => handleCopy(sni, 'sni')}
                        className="text-slate-400 hover:text-white p-1"
                      >
                        {copiedKey === 'sni' ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                    <div className="bg-[#1a1d27] p-2 rounded-lg border border-[#2d3148] flex items-center justify-between">
                      <div className="overflow-hidden">
                        <span className="text-slate-500 block text-[10px]">Plugin Password</span>
                        <span className="text-amber-300 font-medium truncate block">
                          {stlsPassword}
                        </span>
                      </div>
                      <button
                        onClick={() => handleCopy(stlsPassword, 'stlsPass')}
                        className="text-slate-400 hover:text-white p-1"
                      >
                        {copiedKey === 'stlsPass' ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                    <div className="bg-[#1a1d27] p-2 rounded-lg border border-[#2d3148]">
                      <span className="text-slate-500 block text-[10px]">Version</span>
                      <span className="text-emerald-400 font-medium">{version}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Share Link input + Copy button */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">
                  Single Node URI (SIP002 / Hysteria2 / Standard)
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={activeLink}
                    className="flex-1 bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-2 text-xs text-slate-300 font-mono focus:outline-none select-all"
                  />
                  <button
                    onClick={() => handleCopy(activeLink, 'link')}
                    className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow flex-shrink-0"
                  >
                    {copiedKey === 'link' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedKey === 'link' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CLASH META YAML */}
          {activeTab === 'clash' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Paste under <code className="text-indigo-300 font-mono">proxies:</code> in OpenClash / Clash Meta / Mihomo:
                </span>
                <button
                  onClick={() => handleCopy(finalClashYaml, 'clash')}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow"
                >
                  {copiedKey === 'clash' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedKey === 'clash' ? 'Copied' : 'Copy YAML'}</span>
                </button>
              </div>

              <pre className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre selection:bg-indigo-600 selection:text-white max-h-[320px]">
                {finalClashYaml || '# No Clash configuration available for this protocol'}
              </pre>
            </div>
          )}

          {/* TAB 4: SING-BOX JSON */}
          {activeTab === 'singbox' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Client <code className="text-purple-300 font-mono">outbounds</code> JSON for Sing-box / SagerNet:
                </span>
                <button
                  onClick={() => handleCopy(finalSingboxJson, 'singbox')}
                  className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow"
                >
                  {copiedKey === 'singbox' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedKey === 'singbox' ? 'Copied' : 'Copy JSON'}</span>
                </button>
              </div>

              <pre className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 text-xs font-mono text-purple-300 overflow-x-auto whitespace-pre selection:bg-purple-600 selection:text-white max-h-[320px]">
                {finalSingboxJson || '{\n  "outbounds": []\n}'}
              </pre>
            </div>
          )}

          {/* TAB 5: OFFICIAL HY2 */}
          {activeTab === 'hy2' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Official Hysteria 2 CLI / Daemon <code className="text-amber-300 font-mono">config.yaml</code>:
                </span>
                <button
                  onClick={() => handleCopy(finalHy2Cli, 'hy2')}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow"
                >
                  {copiedKey === 'hy2' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedKey === 'hy2' ? 'Copied' : 'Copy YAML'}</span>
                </button>
              </div>

              <pre className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 text-xs font-mono text-amber-300 overflow-x-auto whitespace-pre selection:bg-amber-600 selection:text-white max-h-[320px]">
                {finalHy2Cli}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-[#2d3148] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
