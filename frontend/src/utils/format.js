import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
dayjs.extend(relativeTime)

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0 || bytes == null) return '0 B'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

/**
 * Format bytes/sec to human-readable speed
 */
export function formatSpeed(bytesPerSec) {
  return `${formatBytes(bytesPerSec)}/s`
}

/**
 * Format a date to relative (e.g., "2 hours ago")
 */
export function formatRelative(date) {
  if (!date) return '—'
  return dayjs(date).fromNow()
}

/**
 * Format a date to readable string
 */
export function formatDate(date, format = 'YYYY-MM-DD HH:mm') {
  if (!date) return '—'
  return dayjs(date).format(format)
}

/**
 * Calculate traffic percentage used
 */
export function trafficPercent(used, total) {
  if (!total || total === 0) return 0
  return Math.min(100, Math.round((used / total) * 100))
}

/**
 * Format duration in seconds to human string
 */
export function formatDuration(seconds) {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/**
 * Format expiry date with color class
 */
export function expiryStatus(date) {
  if (!date) return { label: 'No Limit', color: 'text-text-muted' }
  const diff = dayjs(date).diff(dayjs(), 'day')
  if (diff < 0) return { label: 'Expired', color: 'text-danger' }
  if (diff <= 3) return { label: `${diff}d left`, color: 'text-warning' }
  return { label: formatDate(date, 'MMM DD, YYYY'), color: 'text-text-secondary' }
}
