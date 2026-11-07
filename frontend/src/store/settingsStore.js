import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useSettingsStore = create(
  persist(
    (set, get) => ({
      panelPort: 2096,
      subscriptionBaseUrl: '',
      singboxBinaryPath: '/usr/local/bin/sing-box',
      xrayBinaryPath: '/usr/local/bin/xray',
      timezone: 'UTC',
      certPath: '',
      keyPath: '',

      updateSettings: (updates) => set((state) => ({ ...state, ...updates })),
    }),
    {
      name: 'vpn-panel-settings',
    }
  )
)
