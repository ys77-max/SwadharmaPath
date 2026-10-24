import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { Disclaimer } from '@/components/Disclaimer'
import { RequireRole } from '@/components/RequireRole'
import { AuthProvider } from '@/lib/auth'
import { TrackProvider } from '@/lib/track'
import type { Role } from '@/lib/types'
import CaseDetail from '@/pages/cases/CaseDetail'
import CasesPage from '@/pages/cases/CasesPage'
import AssessList from '@/pages/me/AssessList'
import MeHome from '@/pages/me/MeHome'
import TestRunner from '@/pages/me/TestRunner'
import Placeholder from '@/pages/Placeholder'
import Landing from '@/pages/public/Landing'
import Login from '@/pages/public/Login'

const CANDIDATE: Role[] = ['candidate']
const STAFF: Role[] = ['counsellor', 'admin']
const ADMIN: Role[] = ['admin']

const later = (title: string, description: string) => <Placeholder title={title} description={description} />

function PublicPage({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-4 text-3xl font-extrabold text-pine-900">{title}</h1>
      {children}
      <Disclaimer className="mt-8" />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TrackProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/enquire" element={<PublicPage title="Make an enquiry"><p className="text-muted">The lead form arrives in the next build.</p></PublicPage>} />
            <Route path="/about" element={<PublicPage title="About SwadharmaPath"><p className="text-muted">How the programme works: onboarding, assessments, counselling sessions, options and a dated roadmap.</p></PublicPage>} />
            <Route path="/privacy" element={<PublicPage title="Privacy"><p className="text-muted">Full privacy policy to follow. Birth details and Swadharma analysis are visible only to your assigned counsellor unless a report is released to you.</p></PublicPage>} />

            <Route element={<RequireRole roles={[...CANDIDATE, ...STAFF, 'parent']}><AppShell /></RequireRole>}>
              {/* candidate */}
              <Route path="/me" element={<RequireRole roles={CANDIDATE}><MeHome /></RequireRole>} />
              <Route path="/me/assess" element={<RequireRole roles={CANDIDATE}><AssessList /></RequireRole>} />
              <Route path="/me/assess/:instrument" element={<RequireRole roles={CANDIDATE}><TestRunner /></RequireRole>} />
              <Route path="/me/onboard" element={<RequireRole roles={CANDIDATE}>{later('Onboarding', 'Profile, academics, constraints, subject-enjoyment grid, optional birth details with versioned consent, disclaimer acknowledgement and guardian consent for under-18s.')}</RequireRole>} />
              <Route path="/me/profile" element={<RequireRole roles={CANDIDATE}>{later('My profile', 'Your interpreted results appear here after your counsellor approves them.')}</RequireRole>} />
              <Route path="/me/options" element={<RequireRole roles={CANDIDATE}>{later('My options', 'Ranked careers with fit, reasons, pathways and outlook to 2035, once your counsellor publishes them.')}</RequireRole>} />
              <Route path="/me/options/:career" element={<RequireRole roles={CANDIDATE}>{later('Career detail', 'Description, day in the life, pathways, exams, institutions, salary and outlook.')}</RequireRole>} />
              <Route path="/me/streams" element={<RequireRole roles={CANDIDATE}>{later('My streams', 'Stream cards showing what each keeps open and closes, with sample careers.')}</RequireRole>} />
              <Route path="/me/roadmap" element={<RequireRole roles={CANDIDATE}>{later('My roadmap', 'Your timeline and tasks, with status updates and evidence upload.')}</RequireRole>} />
              <Route path="/me/sessions" element={<RequireRole roles={CANDIDATE}>{later('My sessions', 'Upcoming and past sessions with your counsellor’s summaries.')}</RequireRole>} />
              <Route path="/me/reports" element={<RequireRole roles={CANDIDATE}>{later('My reports', 'Reports your counsellor has released to you.')}</RequireRole>} />

              {/* parent */}
              <Route path="/family" element={<RequireRole roles={['parent']}>{later('Family', 'Linked children, progress, next session, parent summary, roadmap (read-only) and messages to the counsellor.')}</RequireRole>} />

              {/* counsellor */}
              <Route path="/cases" element={<RequireRole roles={STAFF}><CasesPage /></RequireRole>} />
              <Route path="/cases/:id" element={<RequireRole roles={STAFF}><CaseDetail /></RequireRole>} />
              <Route path="/schedule" element={<RequireRole roles={STAFF}>{later('Schedule', 'Calendar of your sessions.')}</RequireRole>} />
              <Route path="/reports/queue" element={<RequireRole roles={STAFF}>{later('Report queue', 'Pending report generations and SLA.')}</RequireRole>} />
              <Route path="/library" element={<RequireRole roles={STAFF}>{later('Library', 'Career library and stream options.')}</RequireRole>} />
              <Route path="/settings" element={<RequireRole roles={STAFF}>{later('Settings', 'Profile, availability and notification preferences.')}</RequireRole>} />

              {/* admin */}
              <Route path="/admin" element={<RequireRole roles={ADMIN}>{later('Dashboard', 'Funnel, revenue, counsellor utilisation, report turnaround, NPS and outcomes.')}</RequireRole>} />
              <Route path="/admin/leads" element={<RequireRole roles={ADMIN}>{later('Leads', 'Pipeline board with counsellor assignment and follow-up dates.')}</RequireRole>} />
              <Route path="/admin/counsellors" element={<RequireRole roles={ADMIN}>{later('Counsellors', 'Caseload and SLA per counsellor.')}</RequireRole>} />
              <Route path="/admin/careers" element={<RequireRole roles={ADMIN}>{later('Careers', 'Career library editor and outlook refresh with source and last-reviewed date.')}</RequireRole>} />
              <Route path="/admin/streams" element={<RequireRole roles={ADMIN}>{later('Streams', 'Stream options editor by board.')}</RequireRole>} />
              <Route path="/admin/instruments" element={<RequireRole roles={ADMIN}>{later('Instruments', 'Versions, norms upload and activation.')}</RequireRole>} />
              <Route path="/admin/templates" element={<RequireRole roles={ADMIN}>{later('Templates', 'Roadmap and session-note templates.')}</RequireRole>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </TrackProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
