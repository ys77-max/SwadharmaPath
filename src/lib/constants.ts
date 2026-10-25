import type { IcccStage, ReportKind, RoadmapKind, RoadmapTemplate, Track, TrackVariant } from './types'

export const DISCLAIMER =
  'SwadharmaPath supports career decisions; it does not make them. Psychometric results describe tendencies at a point in time and are interpreted by a trained counsellor; they are not a measure of worth or a guarantee of success. The Swadharma (Vedic astrology) analysis is a traditional lens offered for reflection; it has no established scientific validity, is never used to rule out any career, and is shared only with your consent. Decisions remain yours and your family’s.'

export const CONSENT_TEXT_VERSION = 'swadharma-consent-v1'

export const FAMILIES = [
  'Engineering & Technology',
  'Medicine & Health',
  'Pure Sciences & Research',
  'Mathematics, Finance & Analytics',
  'Law & Governance',
  'Public Service & Defence',
  'Business, Management & Entrepreneurship',
  'Sales, Marketing & Media',
  'Arts, Design & Performance',
  'Writing, Communication & Languages',
  'Education & Counselling',
  'Social Work & Spirituality',
  'Agriculture, Environment & Earth',
  'Hospitality, Travel & Service',
  'Skilled Trades & Crafts',
] as const

export const TRACK_LABEL: Record<Track, string> = {
  early_explorer: 'Early explorer (Class 8–10)',
  student: 'Student (Class 11–12 / UG)',
  professional: 'Professional',
}

export const ICCC: Record<IcccStage, { label: string; short: string; template: string }> = {
  know_self: {
    label: 'Know yourself',
    short: 'Know self',
    template:
      'Purpose of session:\n\nWhat the candidate said about interests, strengths and values:\n\nAssessment results discussed:\n\nCandidate’s own reading of the results:\n\nFamily expectations voiced:\n\nNext step:',
  },
  know_world: {
    label: 'Know the world of work',
    short: 'Know world',
    template:
      'Options explored (careers / streams):\n\nWhat the candidate already knew vs. new information:\n\nMisconceptions corrected:\n\nExposure activities agreed (talks, visits, shadowing):\n\nNext step:',
  },
  decide: {
    label: 'Decide',
    short: 'Decide',
    template:
      'Shortlist under discussion:\n\nCriteria the candidate weighed most:\n\nTrade-offs and constraints (cost, location, family):\n\nLevel of confidence in the choice (1–5):\n\nNext step:',
  },
  plan: {
    label: 'Plan',
    short: 'Plan',
    template:
      'Goal agreed:\n\nKey exams and deadlines:\n\nSkills or subjects to build:\n\nRoadmap items created:\n\nNext step:',
  },
  act: {
    label: 'Act',
    short: 'Act',
    template: 'Progress since last session:\n\nBlockers:\n\nSupport needed from family or school:\n\nRoadmap changes:\n\nNext step:',
  },
  review: {
    label: 'Review',
    short: 'Review',
    template: 'What has worked:\n\nWhat changed (interests, circumstances):\n\nOutcome so far:\n\nIs the goal still right?\n\nNext step:',
  },
}

export const ICCC_ORDER: IcccStage[] = ['know_self', 'know_world', 'decide', 'plan', 'act', 'review']

export const REPORT_KINDS: Record<ReportKind, { label: string; who: string; tracks: Track[] }> = {
  candidate: { label: 'Candidate report', who: 'For the candidate', tracks: ['student', 'professional'] },
  candidate_junior: { label: 'Junior report (visual)', who: 'Written to the student', tracks: ['early_explorer'] },
  parent: { label: 'Parent summary', who: '2 pages for parents', tracks: ['early_explorer', 'student', 'professional'] },
  stream_choice: { label: 'Stream choice report', who: 'Stream options for Class 11', tracks: ['early_explorer'] },
  case_file: { label: 'Case file', who: 'Counsellor only, includes Swadharma', tracks: ['early_explorer', 'student', 'professional'] },
  swadharma: { label: 'Swadharma report', who: 'Separate; released only by a counsellor', tracks: ['early_explorer', 'student', 'professional'] },
}

export const ROADMAP_TEMPLATES: Record<RoadmapTemplate, { label: string; months: number; items: { kind: RoadmapKind; title: string; offsetDays: number; owner: 'candidate' | 'counsellor' | 'parent' }[] }> = {
  class8_10_exposure: {
    label: 'Class 8–10 exposure',
    months: 12,
    items: [
      { kind: 'task', title: 'Talk to two people who work in fields you liked', offsetDays: 30, owner: 'candidate' },
      { kind: 'skill', title: 'Try one hobby club or online course for 6 weeks', offsetDays: 60, owner: 'candidate' },
      { kind: 'task', title: 'Visit a workplace, college or lab with family', offsetDays: 90, owner: 'parent' },
      { kind: 'checkin', title: 'Check-in session with counsellor', offsetDays: 120, owner: 'counsellor' },
      { kind: 'milestone', title: 'Choose Class 11 stream (keep options open)', offsetDays: 240, owner: 'candidate' },
    ],
  },
  class11_12: {
    label: 'Class 11–12',
    months: 24,
    items: [
      { kind: 'task', title: 'Shortlist entrance exams and note registration windows', offsetDays: 21, owner: 'candidate' },
      { kind: 'skill', title: 'Build a weekly study plan for core subjects', offsetDays: 30, owner: 'candidate' },
      { kind: 'exam', title: 'Register for the first entrance exam', offsetDays: 120, owner: 'candidate' },
      { kind: 'checkin', title: 'Mid-year check-in', offsetDays: 180, owner: 'counsellor' },
      { kind: 'milestone', title: 'Finalise college shortlist (reach / match / safe)', offsetDays: 400, owner: 'candidate' },
    ],
  },
  ug: {
    label: 'Undergraduate',
    months: 18,
    items: [
      { kind: 'skill', title: 'Pick one industry-relevant skill and finish a course', offsetDays: 60, owner: 'candidate' },
      { kind: 'task', title: 'Apply for 5 internships', offsetDays: 90, owner: 'candidate' },
      { kind: 'checkin', title: 'Review internship outcomes', offsetDays: 150, owner: 'counsellor' },
      { kind: 'milestone', title: 'Decide: job, higher study or exam preparation', offsetDays: 300, owner: 'candidate' },
    ],
  },
  pg_prep: {
    label: 'PG preparation',
    months: 12,
    items: [
      { kind: 'exam', title: 'Register for target PG entrance exam', offsetDays: 45, owner: 'candidate' },
      { kind: 'skill', title: 'Complete one full mock-test cycle', offsetDays: 120, owner: 'candidate' },
      { kind: 'checkin', title: 'Score review and plan B', offsetDays: 180, owner: 'counsellor' },
      { kind: 'milestone', title: 'Applications submitted', offsetDays: 270, owner: 'candidate' },
    ],
  },
  transition: {
    label: 'Career transition',
    months: 9,
    items: [
      { kind: 'task', title: 'Five informational interviews in the target field', offsetDays: 30, owner: 'candidate' },
      { kind: 'skill', title: 'Close the top skill gap with a project', offsetDays: 90, owner: 'candidate' },
      { kind: 'task', title: 'Rewrite CV and LinkedIn for the new role', offsetDays: 100, owner: 'candidate' },
      { kind: 'checkin', title: 'Transition check-in', offsetDays: 120, owner: 'counsellor' },
      { kind: 'milestone', title: 'First 10 applications sent', offsetDays: 150, owner: 'candidate' },
    ],
  },
  custom: { label: 'Custom (blank)', months: 6, items: [] },
}

export const ROADMAP_KIND_LABEL: Record<RoadmapKind, string> = {
  milestone: 'Milestone',
  task: 'Task',
  exam: 'Exam',
  skill: 'Skill',
  checkin: 'Check-in',
}

export const SWADHARMA_COMPONENTS: Record<string, { label: string; max: number }> = {
  d10: { label: 'D10 (Dasamsa)', max: 25 },
  kp: { label: 'KP 10th cusp sub-lord', max: 20 },
  ashtakavarga: { label: 'Ashtakavarga', max: 20 },
  strength: { label: 'Planetary strength', max: 15 },
  yogas: { label: 'Yogas', max: 10 },
  dasha: { label: 'Dasha timing', max: 10 },
}

export const RIASEC_LABEL: Record<string, string> = {
  R: 'Realistic',
  I: 'Investigative',
  A: 'Artistic',
  S: 'Social',
  E: 'Enterprising',
  C: 'Conventional',
}

export const WORKSTYLE_LABEL: Record<string, string> = {
  R: 'Results',
  A: 'Affiliative',
  P: 'Paced',
  D: 'Detail',
}

export const APTITUDE_LABEL: Record<string, string> = {
  numerical: 'Numerical',
  verbal: 'Verbal',
  abstract: 'Abstract',
  spatial: 'Spatial',
  mechanical: 'Mechanical',
  perceptual: 'Speed and accuracy',
  logical: 'Logical reasoning',
}

/** Mirrors private.track_variant() in the database. */
export function variantFor(track: Track): TrackVariant {
  return track === 'early_explorer' ? 'junior' : track === 'professional' ? 'adult' : 'standard'
}

export const ANCHOR_LABEL: Record<string, string> = {
  technical: 'Technical expertise',
  managerial: 'General management',
  autonomy: 'Autonomy',
  security: 'Security and stability',
  entrepreneurial: 'Building something own',
  service: 'Service to a cause',
  challenge: 'Pure challenge',
  lifestyle: 'Lifestyle fit',
}

export const ADAPTABILITY_LABEL: Record<string, string> = {
  concern: 'Concern (planning ahead)',
  control: 'Control (owning decisions)',
  curiosity: 'Curiosity (exploring options)',
  confidence: 'Confidence (making it work)',
}
