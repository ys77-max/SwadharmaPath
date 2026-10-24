import type { Api } from './api'

let current: Api | null = null

export function setApi(a: Api) {
  current = a
}

/** The active data layer, chosen once in main.tsx before the first render. */
export const api: Api = new Proxy({} as Api, {
  get(_t, prop: keyof Api) {
    if (!current) throw new Error('api used before setApi()')
    return current[prop]
  },
})

export type { Api, CaseBundle, SwadharmaBundle } from './api'
