export type Role = 'candidate' | 'parent' | 'counsellor' | 'admin'
export type Track = 'early_explorer' | 'student' | 'professional'
export type IcccStage = 'know_self' | 'know_world' | 'decide' | 'plan' | 'act' | 'review'
export type ReportKind = 'candidate' | 'candidate_junior' | 'parent' | 'stream_choice' | 'case_file' | 'swadharma'
export type Visibility = 'counsellor' | 'candidate' | 'parent' | 'all'
export type RoadmapTemplate = 'class8_10_exposure' | 'class11_12' | 'ug' | 'pg_prep' | 'transition' | 'custom'
export type RoadmapKind = 'milestone' | 'task' | 'exam' | 'skill' | 'checkin'
export type ItemStatus = 'todo' | 'in_progress' | 'done' | 'missed'
export type Confidence = 'high' | 'medium' | 'low'

export interface AppUser {
  id: string
  role: Role
  full_name: string
  phone: string | null
  email: string | null
  photo_url?: string | null
  language_pref?: string | null
}

export interface Candidate {
  id: string
  user_id: string | null
  track: Track
  board: string | null
  dob: string | null
  gender: string | null
  city: string | null
  school_or_employer: string | null
  class_or_years_exp: string | null
  stream_or_function: string | null
  academics: Record<string, unknown>
  constraints: Record<string, unknown>
  parent_user_id: string | null
  counsellor_id: string | null
  status: string
  swadharma_opted_in: boolean
  disclaimer_accepted_at: string | null
  guardian_consent_at: string | null
  created_at: string
}

export interface CaseloadRow {
  candidate_id: string
  full_name: string | null
  track: Track
  status: string
  class_or_years_exp: string | null
  city: string | null
  iccc_stage: IcccStage
  next_session_at: string | null
  assessments_done: number
  validity_issues: number
  missed_items: number
  consent_pending: boolean
  profile_approved_at: string | null
  assessed_at: string | null
  reported_at: string | null
  report_due_at: string | null
}

export interface InstrumentMeta {
  id: string
  code: string
  name: string
  version: string
  track_variant: 'junior' | 'standard'
  time_limit_min: number | null
  is_active: boolean
}

export interface MyInstrument {
  instrument_id: string
  code: string
  name: string
  track_variant: string
  time_limit_min: number | null
  item_count: number
  est_minutes: number
  session_id: string | null
  status: 'in_progress' | 'completed' | 'invalidated' | null
  answered: number
}

export interface AssessmentSession {
  id: string
  candidate_id: string
  instrument_id: string
  started_at: string | null
  completed_at: string | null
  status: 'in_progress' | 'completed' | 'invalidated'
  device: string | null
  duration_sec: number | null
  answered?: number
}

export interface AssessmentResult {
  id: string
  candidate_id: string
  instrument_id: string
  raw: Record<string, unknown>
  percentiles: Record<string, number>
  derived: Record<string, unknown>
  validity_flags: Record<string, boolean | number | string>
  scored_at: string
  scoring_version: string
}

export interface Narrative {
  strengths: string[]
  watch_outs: string[]
  themes: string[]
  summary?: string
}

export interface ProfileSummary {
  candidate_id: string
  interest_vector: number[] | null
  aptitude_vector: number[] | null
  workstyle_vector: number[] | null
  values_vector: number[] | null
  narrative: Narrative | null
  approved_by: string | null
  approved_at: string | null
  updated_at: string | null
}

export interface Career {
  id: string
  name: string
  family: string
  riasec_code: string
  outlook: 'growing' | 'stable' | 'transforming' | 'declining'
  automation_exposure: 'low' | 'medium' | 'high'
  description?: string
}

export interface StreamOption {
  id: string
  name: string
  board: string
  subjects: string[]
  keeps_open_families: string[]
  closes_families: string[]
  notes: string | null
}

export interface MatchBreakdown {
  interest?: number
  aptitude?: number
  workstyle?: number
  values?: number
  outlook?: number
  constraints?: number
  academics?: number
  breadth?: number
  board?: number
  swadharma?: number
  explanation?: Record<string, string>
}

export interface CareerMatch {
  id: string
  candidate_id: string
  career_id: string
  fit_score: number
  breakdown: MatchBreakdown
  rank: number
  counsellor_action: 'pinned' | 'hidden' | 'added' | null
  visible_to_candidate: boolean
  match_version: string | null
  career?: Career
}

export interface StreamMatch {
  id: string
  candidate_id: string
  stream_option_id: string
  fit_score: number
  breakdown: MatchBreakdown & { sample_careers?: Record<string, string[]> }
  rank: number
  counsellor_action: 'pinned' | 'hidden' | 'added' | null
  visible_to_candidate: boolean
  stream?: StreamOption
}

export interface BirthDetailsSummary {
  birth_date: string | null
  birth_time: string | null
  time_certainty: 'exact' | 'approx_15m' | 'approx_1h' | 'unknown'
  birth_place: string | null
  consent_at: string | null
  consent_text_version: string | null
}

export interface SwadharmaChart {
  candidate_id: string
  ayanamsa: string
  d1: { lagna?: string; lagna_lord?: string; moon_sign?: string; sun_sign?: string; nakshatra?: string; planets?: Record<string, { sign: string; house: number; dignity?: string }> } | null
  d10: { lagna?: string; tenth_lord?: string } | null
  kp_cusps: { tenth_sub_lord?: string; tenth_star_lord?: string } | null
  dashas: { current?: { maha: string; antar: string; until: string } } | null
  insights: {
    personality_lens?: { tendencies: string[]; strengths: string[]; watch_outs: string[]; audience?: 'candidate' | 'parent' }
    agreement?: { family: string; swadharma_rank: number; psychometric_rank: number | null; verdict: 'Agree' | 'Partial' | 'Conflict' }[]
  } | null
  computed_at: string | null
  engine_version: string | null
}

export interface SwadharmaScore {
  id: string
  candidate_id: string
  career_family: string
  points: number
  max_points: number
  components: Record<string, number>
  favourable_windows: { from: string; to: string; purpose: string }[] | null
  confidence: Confidence
  counsellor_notes: string | null
  computed_at: string
  engine_version: string | null
}

export interface SwadharmaRelease {
  id: string
  candidate_id: string
  released_by: string
  released_to: 'candidate' | 'parent' | 'both'
  reason: string
  report_id: string
  released_at: string
}

export interface CounsellingSession {
  id: string
  candidate_id: string
  counsellor_id: string | null
  scheduled_at: string
  duration_min: number
  mode: 'video' | 'in_person' | 'phone'
  meeting_url: string | null
  iccc_stage: IcccStage
  notes_private?: string | null
  summary_for_candidate: string | null
  action_items: { text: string; owner: 'candidate' | 'counsellor' | 'parent'; done?: boolean }[]
  attended: boolean | null
}

export interface Roadmap {
  id: string
  candidate_id: string
  template: RoadmapTemplate
  goal_career_id: string | null
  goal_stream_id: string | null
  start_date: string | null
  end_date: string | null
  status: 'draft' | 'published' | 'completed' | 'paused'
  published_at: string | null
}

export interface RoadmapItem {
  id: string
  roadmap_id: string
  kind: RoadmapKind
  title: string
  description: string | null
  due_date: string | null
  owner: 'candidate' | 'counsellor' | 'parent'
  status: ItemStatus
  evidence_url: string | null
  completed_at: string | null
}

export interface Report {
  id: string
  candidate_id: string
  kind: ReportKind
  version: number
  generated_by: string | null
  pdf_path: string | null
  content: Record<string, unknown> | null
  visible_to: Visibility
  created_at: string
}

export interface DocumentFile {
  name: string
  path: string
  created_at: string | null
  size: number | null
  source: 'upload' | 'evidence'
}

export interface NextItem {
  done: boolean
  total: number
  position?: number
  section?: {
    code: string
    name: string
    time_limit_sec: number | null
    started_at: string | null
    server_now: string
    index: number
    count: number
  }
  item?: {
    id: string
    type: 'likert5' | 'mcq' | 'forced_choice' | 'pair'
    prompt: string
    options: { value: string | number; label: string }[]
  }
  answer?: { a: unknown; rt?: number } | null
}
