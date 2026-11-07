import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../utils/api'
import toast from 'react-hot-toast'

export function useInbounds(engine) {
  const queryClient = useQueryClient()

  const inboundsQuery = useQuery({
    queryKey: ['inbounds', engine],
    queryFn: async () => {
      const url = engine ? `/inbounds?engine=${engine}` : '/inbounds'
      const res = await api.get(url)
      return res.data.data
    },
    refetchInterval: 5000,
  })

  const toggleMutation = useMutation({
    mutationFn: async (id) => {
      const res = await api.post(`/inbounds/${id}/toggle`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbounds'] })
      toast.success('Inbound status updated')
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Failed to toggle inbound')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const res = await api.delete(`/inbounds/${id}`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbounds'] })
      toast.success('Inbound deleted')
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Failed to delete inbound')
    },
  })

  const resetTrafficMutation = useMutation({
    mutationFn: async (id) => {
      const res = await api.post(`/inbounds/${id}/reset-traffic`)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbounds'] })
      toast.success('Traffic reset')
    },
  })

  return {
    inbounds: inboundsQuery.data || [],
    isLoading: inboundsQuery.isLoading,
    refetch: inboundsQuery.refetch,
    toggleInbound: toggleMutation.mutateAsync,
    deleteInbound: deleteMutation.mutateAsync,
    resetTraffic: resetTrafficMutation.mutateAsync,
  }
}
