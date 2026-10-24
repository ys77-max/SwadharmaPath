import { useCallback, useEffect, useRef, useState } from 'react'

/** Loads data with fn(); reload() re-runs it. Stale responses are ignored. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const n = ++seq.current
    setLoading(true)
    try {
      const v = await fn()
      if (n === seq.current) {
        setData(v)
        setError(null)
      }
    } catch (e) {
      if (n === seq.current) setError(e as Error)
    } finally {
      if (n === seq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    reload()
  }, [reload])

  return { data, error, loading, reload, setData }
}
