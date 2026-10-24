// In-memory demo data. Fictional people; instrument items here are demo-only
// stand-ins and are unrelated to the real items stored in the database.
import { FAMILIES } from '../constants'
import type {
  AppUser, AssessmentResult, AssessmentSession, Candidate, Career, CareerMatch, CounsellingSession, Report, Roadmap,
  RoadmapItem, StreamMatch, StreamOption, SwadharmaChart, SwadharmaRelease, SwadharmaScore, ProfileSummary,
  InstrumentMeta,
} from '../types'

const day = 86_400_000
const iso = (offsetDays: number, hour = 10) => {
  const d = new Date(Date.now() + offsetDays * day)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}
const date = (offsetDays: number) => iso(offsetDays).slice(0, 10)
const yearsAgo = (y: number) => date(-Math.round(y * 365.25))

export { PERSONAS } from './demoPersonas'

export const users: AppUser[] = [
  { id: 'u-c1', role: 'counsellor', full_name: 'Chitra Rao', phone: '+91 98450 00001', email: 'counsellor@demo' },
  { id: 'u-admin', role: 'admin', full_name: 'Asha Menon', phone: null, email: 'admin@demo' },
  { id: 'u-rohan', role: 'candidate', full_name: 'Rohan Kulkarni', phone: '+91 98200 11111', email: 'student@demo' },
  { id: 'u-ananya', role: 'candidate', full_name: 'Ananya Iyer', phone: null, email: 'junior@demo' },
  { id: 'u-sunita', role: 'parent', full_name: 'Sunita Iyer', phone: '+91 98860 22222', email: 'parent@demo' },
  { id: 'u-meera', role: 'candidate', full_name: 'Meera Shah', phone: '+91 99300 33333', email: 'meera@demo' },
  { id: 'u-kabir', role: 'candidate', full_name: 'Kabir Singh', phone: null, email: 'kabir@demo' },
  { id: 'u-farah', role: 'candidate', full_name: 'Farah Khan', phone: null, email: 'farah@demo' },
]

const cand = (c: Partial<Candidate> & Pick<Candidate, 'id' | 'user_id' | 'track'>): Candidate => ({
  board: 'CBSE', dob: null, gender: null, city: 'Bengaluru', school_or_employer: null, class_or_years_exp: null,
  stream_or_function: null, academics: {}, constraints: {}, parent_user_id: null, counsellor_id: 'u-c1', status: 'active',
  swadharma_opted_in: false, disclaimer_accepted_at: iso(-30), guardian_consent_at: null, created_at: iso(-40), ...c,
})

export const candidates: Candidate[] = [
  cand({ id: 'c-rohan', user_id: 'u-rohan', track: 'student', dob: yearsAgo(17.4), gender: 'male', city: 'Pune', school_or_employer: 'Vidya Valley School',
         class_or_years_exp: 'Class 12', stream_or_function: 'PCM', swadharma_opted_in: true, guardian_consent_at: iso(-35),
         academics: { class10_pct: 91, class11_pct: 84 }, constraints: { budget: 'mid', can_relocate: true } }),
  cand({ id: 'c-ananya', user_id: 'u-ananya', track: 'early_explorer', dob: yearsAgo(14.2), gender: 'female', school_or_employer: 'National Public School',
         class_or_years_exp: 'Class 9', parent_user_id: 'u-sunita', guardian_consent_at: iso(-28), swadharma_opted_in: true }),
  cand({ id: 'c-meera', user_id: 'u-meera', track: 'professional', dob: yearsAgo(29), gender: 'female', city: 'Mumbai', school_or_employer: 'Retail bank',
         class_or_years_exp: '6 years', stream_or_function: 'Operations', board: null }),
  cand({ id: 'c-kabir', user_id: 'u-kabir', track: 'student', dob: yearsAgo(16.1), city: 'Delhi', class_or_years_exp: 'Class 11', stream_or_function: 'Commerce',
         status: 'onboarding', disclaimer_accepted_at: null, created_at: iso(-3) }),
  cand({ id: 'c-farah', user_id: 'u-farah', track: 'early_explorer', dob: yearsAgo(15), city: 'Hyderabad', class_or_years_exp: 'Class 10', status: 'onboarding', created_at: iso(-6) }),
]

export const instruments: InstrumentMeta[] = [
  ...['interest', 'aptitude', 'workstyle', 'values', 'learning', 'bigfive'].map((code) => ({
    id: `i-${code}-s`, code, name: ({ interest: 'Interests', aptitude: 'Aptitude', workstyle: 'Work style', values: 'Work values', learning: 'How I learn', bigfive: 'Personality (Big Five)' } as Record<string, string>)[code],
    version: 'demo', track_variant: 'standard' as const, time_limit_min: code === 'aptitude' ? 2 : null, is_active: true,
  })),
  ...['interest', 'subject_enjoyment', 'aptitude', 'workstyle', 'school_values', 'learning'].map((code) => ({
    id: `i-${code}-j`, code, name: ({ interest: 'What I like doing', subject_enjoyment: 'Subjects I enjoy', aptitude: 'Brain games', workstyle: 'How I like to work', school_values: 'What matters to me', learning: 'How I learn' } as Record<string, string>)[code],
    version: 'demo', track_variant: 'junior' as const, time_limit_min: code === 'aptitude' ? 2 : null, is_active: true,
  })),
]

type DemoItem = { id: string; type: 'likert5' | 'mcq' | 'forced_choice' | 'pair'; prompt: string; options: { value: string | number; label: string }[] }
type DemoSection = { code: string; name: string; time_limit_sec: number | null; items: DemoItem[] }

const likert = (junior: boolean) => (junior ? ['Not for me', 'Not really', 'Maybe', 'I like it', 'Love it!'] : ['Strongly dislike', 'Dislike', 'Not sure', 'Like', 'Strongly like']).map((label, i) => ({ value: i + 1, label }))
const agree = ['Disagree strongly', 'Disagree a little', 'Neutral', 'Agree a little', 'Agree strongly'].map((label, i) => ({ value: i + 1, label }))
const lk = (id: string, prompts: string[], junior = false, opts = likert(junior)): DemoItem[] => prompts.map((p, i) => ({ id: `${id}${i}`, type: 'likert5', prompt: p, options: opts }))

export function demoItems(instrumentId: string): DemoSection[] {
  const junior = instrumentId.endsWith('-j')
  const code = instrumentId.slice(2, -2)
  switch (code) {
    case 'interest':
      return [{ code: 'main', name: 'Activities', time_limit_sec: null, items: lk('d_int', junior
        ? ['Fix a bicycle or a broken toy', 'Do a science experiment', 'Draw or make a comic', 'Help a classmate with homework', 'Be the captain of a team', 'Make a timetable and stick to it']
        : ['Repair a gadget that stopped working', 'Analyse data to find a pattern', 'Design a poster or app screen', 'Help someone through a problem', 'Convince people to back an idea', 'Keep records organised and accurate'], junior) }]
    case 'subject_enjoyment':
      return [{ code: 'main', name: 'Subjects', time_limit_sec: null, items: lk('d_subj', ['Maths', 'Science', 'Languages', 'Social Science', 'Art and craft', 'Computers'].map((s) => `How much do you enjoy ${s}?`), true) }]
    case 'aptitude':
      return [
        { code: 'numerical', name: junior ? 'Numbers' : 'Numerical', time_limit_sec: 60, items: [
          { id: 'd_apt_n1', type: 'mcq', prompt: junior ? 'A pencil costs ₹6. How much do 7 pencils cost?' : 'A shirt costs ₹800 after a 20% discount. What was the original price?', options: (junior ? ['₹36', '₹42', '₹48', '₹13'] : ['₹960', '₹1,000', '₹1,040', '₹640']).map((label, value) => ({ value, label })) },
          { id: 'd_apt_n2', type: 'mcq', prompt: 'What is 25% of 240?', options: ['40', '50', '60', '80'].map((label, value) => ({ value, label })) },
        ] },
        { code: 'abstract', name: 'Patterns', time_limit_sec: 60, items: [
          { id: 'd_apt_a1', type: 'mcq', prompt: 'What comes next: 2, 6, 12, 20, …', options: ['28', '30', '32', '36'].map((label, value) => ({ value, label })) },
          { id: 'd_apt_a2', type: 'mcq', prompt: 'What comes next: Z, X, V, T, …', options: ['S', 'R', 'Q', 'P'].map((label, value) => ({ value, label })) },
        ] },
      ]
    case 'workstyle':
      return [{ code: 'main', name: 'Most and least like me', time_limit_sec: null, items: [
        ['Driven to win', 'Lively with people', 'Calm and patient', 'Careful and exact'],
        ['Direct', 'Persuasive', 'Loyal', 'Systematic'],
        ['Takes charge', 'Enthusiastic', 'Easy-going', 'Follows the rules'],
      ].map((t, i) => ({ id: `d_ws${i}`, type: 'forced_choice', prompt: 'Pick the one MOST like you and the one LEAST like you', options: t.map((label, j) => ({ value: 'abcd'[j], label })) })) }]
    case 'values':
    case 'school_values': {
      const v = junior ? ['Being kind', 'Being creative', 'Winning', 'Learning new things'] : ['Achievement', 'Security', 'Creativity', 'Helping others']
      const pairs = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3]]
      return [{ code: 'main', name: 'Choose one', time_limit_sec: null, items: pairs.map(([a, b], i) => ({ id: `d_val${i}`, type: 'pair', prompt: junior ? 'Which is more important to you?' : 'Which matters more to you?', options: [{ value: 'a', label: v[a] }, { value: 'b', label: v[b] }] })) }]
    }
    case 'bigfive':
      return [{ code: 'main', name: 'About me', time_limit_sec: null, items: lk('d_bf', ['I enjoy thinking about new ideas', 'I keep my things organised', 'I feel energised around people', 'I like to cooperate', 'I worry a lot'], false, agree) }]
    default:
      return [{ code: 'main', name: 'Learning', time_limit_sec: null, items: lk('d_lrn', ['Pictures help me learn', 'I learn when someone explains out loud', 'Writing things down helps me', 'I learn by trying things'], junior, agree) }]
  }
}

export const assessmentSessions: (AssessmentSession & { responses: Record<string, unknown> })[] = [
  ...['interest', 'aptitude', 'workstyle', 'values', 'bigfive', 'learning'].map((code, i) => ({
    id: `as-rohan-${code}`, candidate_id: 'c-rohan', instrument_id: `i-${code}-s`, started_at: iso(-25 + i), completed_at: iso(-25 + i, 11),
    status: 'completed' as const, device: 'desktop', duration_sec: 900 + i * 60, responses: {},
  })),
  ...['interest', 'subject_enjoyment', 'aptitude', 'workstyle'].map((code, i) => ({
    id: `as-ananya-${code}`, candidate_id: 'c-ananya', instrument_id: `i-${code}-j`, started_at: iso(-20 + i), completed_at: iso(-20 + i, 11),
    status: 'completed' as const, device: 'mobile', duration_sec: 700, responses: {},
  })),
  ...['interest', 'aptitude', 'workstyle', 'values', 'bigfive', 'learning'].map((code, i) => ({
    id: `as-meera-${code}`, candidate_id: 'c-meera', instrument_id: `i-${code}-s`, started_at: iso(-12 + i), completed_at: iso(-12 + i, 11),
    status: 'completed' as const, device: 'desktop', duration_sec: 600, responses: {},
  })),
]

const wsGraphs = (o: number[], s: number[], self: number[]) => ({ others: o, stress: s, self })
export const results: AssessmentResult[] = [
  { id: 'r1', candidate_id: 'c-rohan', instrument_id: 'i-interest-s', raw: { R: 15, I: 19, A: 11, S: 9, E: 13, C: 14 }, percentiles: { R: 71, I: 92, A: 40, S: 22, E: 58, C: 66 },
    derived: { code: 'IRC', vector: [0.74, 0.95, 0.42, 0.28, 0.6, 0.68] }, validity_flags: {}, scored_at: iso(-25), scoring_version: 'demo' },
  { id: 'r2', candidate_id: 'c-rohan', instrument_id: 'i-aptitude-s', raw: { numerical: 4, verbal: 3, abstract: 4, spatial: 3 }, percentiles: { numerical: 91, verbal: 62, abstract: 86, spatial: 70 },
    derived: { bands: { numerical: 'Very High', verbal: 'Average', abstract: 'High', spatial: 'Average' } }, validity_flags: {}, scored_at: iso(-24), scoring_version: 'demo' },
  { id: 'r3', candidate_id: 'c-rohan', instrument_id: 'i-workstyle-s', raw: {}, percentiles: {},
    derived: { graphs: wsGraphs([6, -4, 2, 9], [3, -6, 7, 8], [5, -5, -1, 11]), primary: 'D', secondary: 'R', patterns: { span: 'normal', reversal: false, stress: ['personal'] } },
    validity_flags: { divergence: false }, scored_at: iso(-23), scoring_version: 'demo' },
  { id: 'r4', candidate_id: 'c-rohan', instrument_id: 'i-values-s', raw: {}, percentiles: {}, derived: { top5: ['Learning', 'Achievement', 'Independence', 'Security', 'Creativity'] }, validity_flags: {}, scored_at: iso(-22), scoring_version: 'demo' },
  { id: 'r5', candidate_id: 'c-rohan', instrument_id: 'i-bigfive-s', raw: {}, percentiles: { O: 78, C: 64, E: 35, A: 55, N: 42 }, derived: {}, validity_flags: { social_desirability: false }, scored_at: iso(-21), scoring_version: 'demo' },
  { id: 'r6', candidate_id: 'c-ananya', instrument_id: 'i-interest-j', raw: {}, percentiles: { R: 30, I: 74, A: 93, S: 81, E: 45, C: 28 }, derived: { code: 'ASI', vector: [0.3, 0.72, 0.96, 0.84, 0.46, 0.3] }, validity_flags: {}, scored_at: iso(-20), scoring_version: 'demo' },
  { id: 'r7', candidate_id: 'c-ananya', instrument_id: 'i-aptitude-j', raw: {}, percentiles: { numerical: 48, verbal: 88, abstract: 79, spatial: 83 }, derived: { bands: { numerical: 'Average', verbal: 'High', abstract: 'High', spatial: 'High' } }, validity_flags: { fast_responses: true }, scored_at: iso(-18), scoring_version: 'demo' },
  { id: 'r8', candidate_id: 'c-ananya', instrument_id: 'i-workstyle-j', raw: {}, percentiles: {}, derived: { graphs: { others: [-2, 10, 3, -4], self: [-1, 12, 1, -6] }, primary: 'A', secondary: 'P', patterns: { mercurial: true } }, validity_flags: {}, scored_at: iso(-17), scoring_version: 'demo' },
  { id: 'r9', candidate_id: 'c-meera', instrument_id: 'i-interest-s', raw: {}, percentiles: { R: 20, I: 61, A: 55, S: 88, E: 72, C: 50 }, derived: { code: 'SEI', vector: [0.2, 0.6, 0.55, 0.9, 0.75, 0.5] }, validity_flags: { straight_lining: true }, scored_at: iso(-12), scoring_version: 'demo' },
]

export const profiles: ProfileSummary[] = [
  { candidate_id: 'c-rohan', interest_vector: [0.74, 0.95, 0.42, 0.28, 0.6, 0.68], aptitude_vector: [91, 62, 86, 70], workstyle_vector: [5, -5, -1, 11], values_vector: null,
    narrative: { strengths: ['Strong numerical and pattern reasoning', 'Curious, likes to understand how things work', 'Careful with detail when the stakes are clear'],
                 watch_outs: ['Can go quiet in groups; may undersell himself in interviews', 'Feels pressure when plans change late'],
                 themes: ['Analytical problem-solving', 'Building things that work', 'Independence in how he works'],
                 summary: 'Rohan is happiest working on well-defined but hard problems. His interest and aptitude profiles point the same way.' },
    approved_by: 'u-c1', approved_at: iso(-15), updated_at: iso(-15) },
  { candidate_id: 'c-ananya', interest_vector: [0.3, 0.72, 0.96, 0.84, 0.46, 0.3], aptitude_vector: [48, 88, 79, 83], workstyle_vector: [-1, 12, 1, -6], values_vector: null,
    narrative: { strengths: ['Expressive and imaginative', 'Reads people well'], watch_outs: ['Rushed the timed section; re-check aptitude'], themes: ['Creating', 'Helping'] }, approved_by: null, approved_at: null, updated_at: iso(-16) },
]

export const careers: Career[] = [
  ['car-sw', 'Software Engineer', 'Engineering & Technology', 'IRC', 'transforming', 'medium'],
  ['car-ds', 'Data Scientist', 'Mathematics, Finance & Analytics', 'ICE', 'growing', 'medium'],
  ['car-civil', 'Civil Engineer', 'Engineering & Technology', 'RIC', 'stable', 'low'],
  ['car-ca', 'Chartered Accountant', 'Mathematics, Finance & Analytics', 'CEI', 'transforming', 'high'],
  ['car-rs', 'Research Scientist', 'Pure Sciences & Research', 'IRA', 'stable', 'low'],
  ['car-ux', 'UX / Product Designer', 'Arts, Design & Performance', 'AIE', 'growing', 'medium'],
  ['car-env', 'Environmental Scientist', 'Agriculture, Environment & Earth', 'IRS', 'growing', 'low'],
  ['car-af', 'Armed Forces Officer', 'Public Service & Defence', 'RES', 'stable', 'low'],
  ['car-ent', 'Entrepreneur / Startup Founder', 'Business, Management & Entrepreneurship', 'ECA', 'growing', 'low'],
  ['car-law', 'Lawyer', 'Law & Governance', 'EIS', 'stable', 'medium'],
  ['car-psy', 'Psychologist / Counsellor', 'Education & Counselling', 'SIA', 'growing', 'low'],
  ['car-hosp', 'Hospitality Manager', 'Hospitality, Travel & Service', 'ESC', 'growing', 'medium'],
].map(([id, name, family, riasec_code, outlook, automation_exposure]) => ({ id, name, family, riasec_code, outlook, automation_exposure } as Career))

const bd = (interest: number, aptitude: number, workstyle: number, values: number, outlook: number, constraints: number, swadharma: number) => ({
  interest, aptitude, workstyle, values, outlook, constraints, swadharma,
  explanation: {
    interest: interest > 28 ? 'Your interest pattern lines up closely with people in this field.' : 'Partly matches your interests.',
    aptitude: aptitude > 20 ? 'Your aptitude meets or exceeds what the role usually needs.' : 'One aptitude area is below what this path usually asks for.',
    outlook: 'Demand outlook to 2035 from the career library.',
  },
})
export const careerMatches: CareerMatch[] = [
  ['cm1', 'car-ds', 89, bd(33, 24, 12, 8, 10, 5, 64)],
  ['cm2', 'car-sw', 86, bd(32, 23, 13, 7, 7, 5, 78)],
  ['cm3', 'car-rs', 80, bd(30, 22, 12, 7, 6, 3, 52)],
  ['cm4', 'car-civil', 74, bd(27, 20, 12, 5, 6, 5, 78)],
  ['cm5', 'car-ca', 71, bd(24, 22, 11, 6, 7, 2, 45)],
  ['cm6', 'car-env', 69, bd(25, 18, 10, 6, 10, 2, 38)],
  ['cm7', 'car-ent', 62, bd(20, 15, 8, 9, 10, 2, 58)],
  ['cm8', 'car-af', 55, bd(19, 14, 9, 4, 6, 3, 41)],
].map(([id, career_id, fit, b], i) => ({
  id: id as string, candidate_id: 'c-rohan', career_id: career_id as string, fit_score: fit as number, breakdown: b as CareerMatch['breakdown'],
  rank: i + 1, counsellor_action: i === 0 ? 'pinned' : null, visible_to_candidate: false, match_version: 'match-0.1',
}))

export const streams: StreamOption[] = [
  ['s-pcm', 'Science - PCM', ['Physics', 'Chemistry', 'Mathematics'], FAMILIES.filter((f) => f !== 'Medicine & Health'), ['Medicine & Health']],
  ['s-pcb', 'Science - PCB', ['Physics', 'Chemistry', 'Biology'], ['Medicine & Health', 'Pure Sciences & Research', 'Agriculture, Environment & Earth', 'Education & Counselling', 'Social Work & Spirituality', 'Law & Governance', 'Writing, Communication & Languages'], ['Engineering & Technology', 'Mathematics, Finance & Analytics']],
  ['s-pcmb', 'Science - PCMB', ['Physics', 'Chemistry', 'Mathematics', 'Biology'], [...FAMILIES], []],
  ['s-hum', 'Humanities', ['History', 'Political Science', 'Psychology'], ['Law & Governance', 'Public Service & Defence', 'Arts, Design & Performance', 'Writing, Communication & Languages', 'Education & Counselling', 'Social Work & Spirituality', 'Sales, Marketing & Media', 'Hospitality, Travel & Service'], ['Engineering & Technology', 'Medicine & Health', 'Pure Sciences & Research', 'Mathematics, Finance & Analytics']],
  ['s-humm', 'Humanities with Mathematics', ['Economics', 'Mathematics', 'Psychology'], ['Mathematics, Finance & Analytics', 'Law & Governance', 'Arts, Design & Performance', 'Writing, Communication & Languages', 'Education & Counselling', 'Social Work & Spirituality', 'Sales, Marketing & Media'], ['Engineering & Technology', 'Medicine & Health', 'Pure Sciences & Research']],
  ['s-design', 'Arts, Design & Vocational', ['Painting', 'Design skill subject'], ['Arts, Design & Performance', 'Sales, Marketing & Media', 'Writing, Communication & Languages', 'Hospitality, Travel & Service', 'Skilled Trades & Crafts'], ['Engineering & Technology', 'Medicine & Health', 'Pure Sciences & Research', 'Mathematics, Finance & Analytics', 'Public Service & Defence']],
].map(([id, name, subjects, keeps, closes]) => ({ id: id as string, name: name as string, board: 'CBSE', subjects: subjects as string[], keeps_open_families: keeps as string[], closes_families: closes as string[], notes: null }))

export const streamMatches: StreamMatch[] = [
  ['sm1', 's-humm', 84, { interest: 31, aptitude: 26, academics: 16, breadth: 7, board: 5, swadharma: 61 }],
  ['sm2', 's-pcmb', 78, { interest: 24, aptitude: 25, academics: 14, breadth: 10, board: 5, swadharma: 55 }],
  ['sm3', 's-hum', 76, { interest: 32, aptitude: 24, academics: 15, breadth: 6, board: 5, swadharma: 66 }],
  ['sm4', 's-design', 72, { interest: 33, aptitude: 25, academics: 12, breadth: 3, board: 5, swadharma: 70 }],
  ['sm5', 's-pcb', 61, { interest: 22, aptitude: 19, academics: 11, breadth: 6, board: 5, swadharma: 40 }],
].map(([id, sid, fit, b], i) => ({
  id: id as string, candidate_id: 'c-ananya', stream_option_id: sid as string, fit_score: fit as number,
  breakdown: { ...(b as object), sample_careers: { 'Arts, Design & Performance': ['UX designer', 'Animator', 'Architect'], 'Education & Counselling': ['Psychologist', 'Teacher', 'Special educator'] } },
  rank: i + 1, counsellor_action: null, visible_to_candidate: true,
}))

const famPoints: Record<string, number> = {
  'Engineering & Technology': 78, 'Mathematics, Finance & Analytics': 64, 'Business, Management & Entrepreneurship': 58,
  'Pure Sciences & Research': 52, 'Public Service & Defence': 41, 'Law & Governance': 47, 'Medicine & Health': 36,
  'Writing, Communication & Languages': 44, 'Sales, Marketing & Media': 39, 'Arts, Design & Performance': 33,
  'Education & Counselling': 49, 'Social Work & Spirituality': 30, 'Agriculture, Environment & Earth': 38,
  'Hospitality, Travel & Service': 27, 'Skilled Trades & Crafts': 45,
}
const split = (p: number) => {
  const w = { d10: 25, kp: 20, ashtakavarga: 20, strength: 15, yogas: 10, dasha: 10 }
  return Object.fromEntries(Object.entries(w).map(([k, max]) => [k, Math.round((p / 100) * max * (0.8 + ((k.length * 7) % 5) / 10) * 10) / 10]).map(([k, v]) => [k, Math.min(v as number, w[k as keyof typeof w])]))
}
export const swadharmaScores: SwadharmaScore[] = Object.entries(famPoints).map(([family, points], i) => ({
  id: `sw-${i}`, candidate_id: 'c-rohan', career_family: family, points, max_points: 100, components: split(points),
  favourable_windows: points > 55 ? [{ from: date(120), to: date(300), purpose: 'Entrance exams and applications' }, { from: date(900), to: date(1200), purpose: 'Internship or first role' }] : null,
  confidence: 'medium', counsellor_notes: i === 0 ? 'Lines up with psychometric top-2. Mention only as reflection.' : null, computed_at: iso(-14), engine_version: 'swadharma-0.1',
}))

export const swadharmaCharts: SwadharmaChart[] = [{
  candidate_id: 'c-rohan', ayanamsa: 'Lahiri',
  d1: { lagna: 'Virgo', lagna_lord: 'Mercury', moon_sign: 'Capricorn', sun_sign: 'Aries', nakshatra: 'Shravana',
        planets: { Sun: { sign: 'Aries', house: 8, dignity: 'exalted' }, Moon: { sign: 'Capricorn', house: 5 }, Mars: { sign: 'Gemini', house: 10 }, Mercury: { sign: 'Pisces', house: 7, dignity: 'debilitated' }, Jupiter: { sign: 'Cancer', house: 11, dignity: 'exalted' }, Venus: { sign: 'Taurus', house: 9, dignity: 'own' }, Saturn: { sign: 'Aquarius', house: 6, dignity: 'own' }, Rahu: { sign: 'Aries', house: 8 }, Ketu: { sign: 'Libra', house: 2 } } },
  d10: { lagna: 'Scorpio', tenth_lord: 'Sun' }, kp_cusps: { tenth_sub_lord: 'Saturn', tenth_star_lord: 'Mars' },
  dashas: { current: { maha: 'Mars', antar: 'Saturn', until: date(400) } },
  insights: {
    personality_lens: {
      tendencies: ['Methodical; prefers to understand a system fully before acting', 'Quietly persistent once committed'],
      strengths: ['Analysis and precise communication', 'Steady work under long timelines'],
      watch_outs: ['Over-checking before committing to a choice', 'May hold back opinions in groups'],
      audience: 'candidate',
    },
    agreement: [
      { family: 'Engineering & Technology', swadharma_rank: 1, psychometric_rank: 2, verdict: 'Agree' },
      { family: 'Mathematics, Finance & Analytics', swadharma_rank: 2, psychometric_rank: 1, verdict: 'Agree' },
      { family: 'Business, Management & Entrepreneurship', swadharma_rank: 3, psychometric_rank: 7, verdict: 'Partial' },
      { family: 'Pure Sciences & Research', swadharma_rank: 4, psychometric_rank: 3, verdict: 'Agree' },
      { family: 'Education & Counselling', swadharma_rank: 5, psychometric_rank: 12, verdict: 'Conflict' },
    ],
  },
  computed_at: iso(-14), engine_version: 'swadharma-0.1',
}]

export const birthDetails: Record<string, { birth_date: string; birth_time: string | null; time_certainty: 'exact' | 'approx_15m' | 'approx_1h' | 'unknown'; birth_place: string; consent_at: string; consent_text_version: string }> = {
  'c-rohan': { birth_date: yearsAgo(17.4), birth_time: '05:42', time_certainty: 'approx_15m', birth_place: 'Pune, Maharashtra', consent_at: iso(-35), consent_text_version: 'swadharma-consent-v1' },
  'c-ananya': { birth_date: yearsAgo(14.2), birth_time: null, time_certainty: 'unknown', birth_place: 'Chennai, Tamil Nadu', consent_at: iso(-28), consent_text_version: 'swadharma-consent-v1' },
}

export const releases: SwadharmaRelease[] = []

export const sessions: CounsellingSession[] = [
  { id: 'se1', candidate_id: 'c-rohan', counsellor_id: 'u-c1', scheduled_at: iso(-14, 17), duration_min: 60, mode: 'video', meeting_url: 'https://meet.example.com/rohan-1', iccc_stage: 'know_self',
    notes_private: 'Father keen on IIT. Rohan more drawn to data/research. Watch for pressure.', summary_for_candidate: 'We went through your interest and aptitude results. Your strongest areas are numbers and patterns.',
    action_items: [{ text: 'Read about 3 careers in the data family', owner: 'candidate', done: true }], attended: true },
  { id: 'se2', candidate_id: 'c-rohan', counsellor_id: 'u-c1', scheduled_at: iso(-4, 17), duration_min: 60, mode: 'video', meeting_url: 'https://meet.example.com/rohan-2', iccc_stage: 'know_world',
    notes_private: 'Explored data science vs software. He asked good questions about ISI/CMI.', summary_for_candidate: 'We compared data science, software and research careers and the exams for each.',
    action_items: [{ text: 'Talk to one data scientist (intro via counsellor)', owner: 'counsellor' }, { text: 'Check ISI/CMI entrance dates', owner: 'candidate' }], attended: true },
  { id: 'se3', candidate_id: 'c-rohan', counsellor_id: 'u-c1', scheduled_at: iso(3, 17), duration_min: 60, mode: 'video', meeting_url: 'https://meet.example.com/rohan-3', iccc_stage: 'decide', notes_private: null, summary_for_candidate: null, action_items: [], attended: null },
  { id: 'se4', candidate_id: 'c-ananya', counsellor_id: 'u-c1', scheduled_at: iso(1, 16), duration_min: 45, mode: 'in_person', meeting_url: null, iccc_stage: 'know_self', notes_private: null, summary_for_candidate: null, action_items: [], attended: null },
  { id: 'se5', candidate_id: 'c-meera', counsellor_id: 'u-c1', scheduled_at: iso(6, 19), duration_min: 60, mode: 'phone', meeting_url: null, iccc_stage: 'know_self', notes_private: null, summary_for_candidate: null, action_items: [], attended: null },
]

export const roadmaps: Roadmap[] = [
  { id: 'rm1', candidate_id: 'c-rohan', template: 'class11_12', goal_career_id: 'car-ds', goal_stream_id: null, start_date: date(-10), end_date: date(500), status: 'draft', published_at: null },
]
export const roadmapItems: RoadmapItem[] = [
  { id: 'ri1', roadmap_id: 'rm1', kind: 'task', title: 'Shortlist entrance exams and note registration windows', description: 'ISI, CMI, CUET, JEE Main', due_date: date(11), owner: 'candidate', status: 'in_progress', evidence_url: null, completed_at: null },
  { id: 'ri2', roadmap_id: 'rm1', kind: 'skill', title: 'Finish an intro Python for data course', description: null, due_date: date(40), owner: 'candidate', status: 'todo', evidence_url: null, completed_at: null },
  { id: 'ri3', roadmap_id: 'rm1', kind: 'exam', title: 'Register for CUET-UG', description: null, due_date: date(-2), owner: 'candidate', status: 'missed', evidence_url: null, completed_at: null },
  { id: 'ri4', roadmap_id: 'rm1', kind: 'checkin', title: 'Mid-year check-in', description: null, due_date: date(170), owner: 'counsellor', status: 'todo', evidence_url: null, completed_at: null },
]

export const reports: Report[] = [
  { id: 'rep1', candidate_id: 'c-rohan', kind: 'candidate', version: 1, generated_by: 'u-c1', pdf_path: 'reports/c-rohan/candidate-v1.pdf', content: {}, visible_to: 'candidate', created_at: iso(-13) },
  { id: 'rep2', candidate_id: 'c-rohan', kind: 'swadharma', version: 1, generated_by: 'u-c1', pdf_path: 'reports/c-rohan/swadharma-v1.pdf', content: {}, visible_to: 'counsellor', created_at: iso(-12) },
  { id: 'rep3', candidate_id: 'c-rohan', kind: 'case_file', version: 1, generated_by: 'u-c1', pdf_path: null, content: { status: 'requested' }, visible_to: 'counsellor', created_at: iso(-1) },
]

export const documents: { candidate_id: string; name: string; path: string; created_at: string; size: number }[] = [
  { candidate_id: 'c-rohan', name: 'Class 11 marksheet.pdf', path: 'c-rohan/1-Class_11_marksheet.pdf', created_at: iso(-30), size: 182_000 },
]
