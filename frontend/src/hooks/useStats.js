import { useQuery } from '@tanstack/react-query'
import api from '../utils/api'

export function useStats() {
  const overviewQuery = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: async () => {
      const res = await api.get('/stats/overview')
      return res.data.data
    },
    refetchInterval: 3000,
  })

  const chartQuery = useQuery({
    queryKey: ['stats', 'chart'],
    queryFn: async () => {
      const res = await api.get('/stats/chart')
      return res.data.data
    },
    refetchInterval: 30000,
  })

  return {
    overview: overviewQuery.data,
    chartData: chartQuery.data || [],
    isLoading: overviewQuery.isLoading,
  }
}
