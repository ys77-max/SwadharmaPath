import type { CaseBundle } from '@/lib/api'

export interface TabProps {
  bundle: CaseBundle
  reload: () => void
}
