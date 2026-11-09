import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useAuthStore = create(
  persist(
    (set) => ({
      isAuthenticated: false,
      user: null,
      token: null,
      csrfToken: null,

      login: (user, token, csrfToken = null) => {
        set({ isAuthenticated: true, user, token, ...(csrfToken ? { csrfToken } : {}) })
      },

      setCsrfToken: (csrfToken) => {
        set({ csrfToken })
      },

      logout: () => {
        set({ isAuthenticated: false, user: null, token: null, csrfToken: null })
      },
    }),
    {
      name: 'vpn-panel-auth',
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        token: state.token,
        csrfToken: state.csrfToken,
      }),
    }
  )
)
