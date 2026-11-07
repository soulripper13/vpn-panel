import React, { useState } from 'react'
import { X, Copy, Check, QrCode, FileText, Code2, Download } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { generateClashYaml, generateSingboxJson } from '../../utils/links'
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
  const [activeTab, setActiveTab] = useState('qr') // 'qr' | 'clash' | 'singbox'
  const [copiedKey, setCopiedKey] = useState(null)

  if (!isOpen) return null

  // Derive host from current location or window
  const host = window.location.hostname || '107.182.23.115'

  // If YAML or JSON not provided directly, compute from inbound & client
  const finalClashYaml = clashYaml || (inbound ? generateClashYaml(inbound, client, host) : '')
  const finalSingboxJson = singboxJson || (inbound ? generateSingboxJson(inbound, client, host) : '')

  const handleCopy = (text, key) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    toast.success('Copied to clipboard!')
    setTimeout(() => setCopiedKey(null), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl max-w-xl w-full p-6 shadow-2xl flex flex-col max-h-[92vh] space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#2d3148]">
          <div className="flex items-center space-x-2.5">
            <QrCode className="w-5 h-5 text-indigo-400" />
            <div>
              <h3 className="text-base font-semibold text-white">{title}</h3>
              <p className="text-xs text-slate-400">
                {inbound ? `${inbound.remark || inbound.tag} • ${inbound.engine?.toUpperCase()} • Port ${inbound.port}` : 'Client Connection Details'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center space-x-1.5 p-1 bg-[#14161f] border border-[#2d3148] rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('qr')}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition flex items-center justify-center space-x-1.5 ${
              activeTab === 'qr'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Share Link & QR</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('clash')}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition flex items-center justify-center space-x-1.5 ${
              activeTab === 'clash'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>OpenClash / Meta</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('singbox')}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition flex items-center justify-center space-x-1.5 ${
              activeTab === 'singbox'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Sing-box JSON</span>
          </button>
        </div>

        {/* Body content based on active tab */}
        <div className="flex-1 overflow-y-auto py-1">
          {activeTab === 'qr' && (
            <div className="space-y-4">
              {/* QR Code container */}
              <div className="flex flex-col items-center justify-center p-5 bg-white rounded-xl shadow-inner mx-auto w-fit">
                {link ? (
                  <QRCodeSVG value={link} size={200} level="M" />
                ) : (
                  <div className="w-[200px] h-[200px] flex items-center justify-center text-slate-500 text-sm">
                    No link available
                  </div>
                )}
              </div>

              <p className="text-center text-[11px] text-slate-400">
                Scan with Shadowrocket, NekoBox, Sing-box, or V2Ray
              </p>

              {/* Share Link input + Copy button */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Connection URI (SIP002 / Standard)</label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    readOnly
                    value={link}
                    className="flex-1 bg-[#14161f] border border-[#2d3148] rounded-lg px-3 py-2 text-xs text-slate-300 font-mono focus:outline-none select-all"
                  />
                  <button
                    onClick={() => handleCopy(link, 'link')}
                    className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow flex-shrink-0"
                  >
                    {copiedKey === 'link' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey === 'link' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'clash' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Paste under <code className="text-indigo-300 font-mono">proxies:</code> in OpenClash / Clash Meta / Clash Verge:
                </span>
                <button
                  onClick={() => handleCopy(finalClashYaml, 'clash')}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition flex items-center space-x-1.5 shadow"
                >
                  {copiedKey === 'clash' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'clash' ? 'Copied' : 'Copy YAML'}</span>
                </button>
              </div>

              <pre className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre selection:bg-indigo-600 selection:text-white max-h-[320px]">
                {finalClashYaml || '# No Clash configuration available for this protocol'}
              </pre>
            </div>
          )}

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
                  {copiedKey === 'singbox' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'singbox' ? 'Copied' : 'Copy JSON'}</span>
                </button>
              </div>

              <pre className="bg-[#14161f] border border-[#2d3148] rounded-xl p-4 text-xs font-mono text-purple-300 overflow-x-auto whitespace-pre selection:bg-purple-600 selection:text-white max-h-[320px]">
                {finalSingboxJson || '{\n  "outbounds": []\n}'}
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
