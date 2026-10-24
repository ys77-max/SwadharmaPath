import { ArrowLeft, Lock } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ErrorBox, Loading } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { TRACK_LABEL } from '@/lib/constants'
import { useAsync } from '@/lib/useAsync'
import { ageFrom } from '@/lib/utils'
import AssessmentsTab from './tabs/AssessmentsTab'
import DocumentsTab from './tabs/DocumentsTab'
import OptionsTab from './tabs/OptionsTab'
import OverviewTab from './tabs/OverviewTab'
import ProfileTab from './tabs/ProfileTab'
import ReportsTab from './tabs/ReportsTab'
import RoadmapTab from './tabs/RoadmapTab'
import SessionsTab from './tabs/SessionsTab'
import SwadharmaTab from './tabs/SwadharmaTab'

export const CASE_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'assessments', label: 'Assessments' },
  { key: 'profile', label: 'Profile' },
  { key: 'swadharma', label: 'Swadharma', locked: true },
  { key: 'options', label: 'Options' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'roadmap', label: 'Roadmap' },
  { key: 'reports', label: 'Reports' },
  { key: 'documents', label: 'Documents' },
] as const

export default function CaseDetail() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'overview'
  const { data, error, loading, reload } = useAsync(() => api.getCase(id), [id])

  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorBox error={error ?? 'Case not found'} />

  const { candidate, user } = data
  const age = ageFrom(candidate.dob)
  const minor = age === null || age < 18
  const props = { bundle: data, reload }

  return (
    <div>
      <Link to="/cases" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-pine-700 hover:underline">
        <ArrowLeft className="size-4" /> All cases
      </Link>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-pine-900 sm:text-3xl">{user?.full_name ?? 'Candidate'}</h1>
        <Badge variant={candidate.track === 'early_explorer' ? 'sand' : 'default'}>{TRACK_LABEL[candidate.track]}</Badge>
        {age !== null && <Badge variant="outline">{age} yrs</Badge>}
        <Badge variant="outline" className="capitalize">{candidate.status}</Badge>
        {minor && !candidate.guardian_consent_at && <Badge variant="warn">Guardian consent pending</Badge>}
      </div>
      <Tabs value={tab} onValueChange={(t) => setParams({ tab: t }, { replace: true })}>
        <TabsList aria-label="Case sections">
          {CASE_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
              {'locked' in t && <Lock className="size-3.5 text-saffron-600" aria-label="counsellor only" />}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview"><OverviewTab {...props} onGo={(t) => setParams({ tab: t })} /></TabsContent>
        <TabsContent value="assessments"><AssessmentsTab {...props} /></TabsContent>
        <TabsContent value="profile"><ProfileTab {...props} /></TabsContent>
        <TabsContent value="swadharma"><SwadharmaTab {...props} /></TabsContent>
        <TabsContent value="options"><OptionsTab {...props} /></TabsContent>
        <TabsContent value="sessions"><SessionsTab {...props} /></TabsContent>
        <TabsContent value="roadmap"><RoadmapTab {...props} /></TabsContent>
        <TabsContent value="reports"><ReportsTab {...props} /></TabsContent>
        <TabsContent value="documents"><DocumentsTab {...props} /></TabsContent>
      </Tabs>
    </div>
  )
}
