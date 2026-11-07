import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../utils/api'
import toast from 'react-hot-toast'

export function useEngine() {
  const queryClient = useQueryClient()

  const engineAction = useMutation({
    mutationFn: async ({ engine, action }) => {
      const res = await api.post(`/engine/${engine}/${action}`)
      return res.data
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      toast.success(`${variables.engine} ${variables.action} successful`)
    },
    onError: (err, variables) => {
      toast.error(err.response?.data?.message || `Failed to ${variables.action} ${variables.engine}`)
    },
  })

  return {
    performAction: (engine, action) => engineAction.mutateAsync({ engine, action }),
  }
}
