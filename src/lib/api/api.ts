import type {
  AppUser, AssessmentResult, AssessmentSession, BirthDetailsSummary, CaseloadRow, Candidate, Career, CareerMatch,
  CounsellingSession, DocumentFile, InstrumentMeta, MyInstrument, Narrative, NextItem, ProfileSummary, Report,
  ReportKind, Roadmap, RoadmapItem, RoadmapTemplate, StreamMatch, StreamOption, SwadharmaChart, SwadharmaRelease,
  SwadharmaScore, Visibility,
} from '../types'

export interface CaseBundle {
  candidate: Candidate
  user: AppUser | null
  parent: AppUser | null
}

export interface SwadharmaBundle {
  optedIn: boolean
  birth: BirthDetailsSummary | null
  chart: SwadharmaChart | null
  scores: SwadharmaScore[]
  releases: SwadharmaRelease[]
  swadharmaReports: Report[]
}

/**
 * Everything the UI reads or writes. Two implementations: supabaseApi (RLS-governed
 * calls with the anon key) and demoApi (in-memory, for previews without a backend).
 */
export interface Api {
  // auth
  currentUser(): Promise<AppUser | null>
  onAuthChange(cb: () => void): () => void
  signInWithPassword(email: string, password: string): Promise<void>
  sendPhoneOtp(phone: string): Promise<void>
  verifyPhoneOtp(phone: string, token: string): Promise<void>
  signOut(): Promise<void>

  // counsellor workspace
  caseload(): Promise<CaseloadRow[]>
  getCase(candidateId: string): Promise<CaseBundle>
  instrumentsFor(variant: 'junior' | 'standard'): Promise<InstrumentMeta[]>
  assessmentSessions(candidateId: string): Promise<AssessmentSession[]>
  assessmentResults(candidateId: string): Promise<AssessmentResult[]>
  reAdminister(sessionId: string): Promise<void>
  profile(candidateId: string): Promise<ProfileSummary | null>
  saveNarrative(candidateId: string, narrative: Narrative): Promise<void>
  approveProfile(candidateId: string): Promise<void>
  swadharma(candidateId: string): Promise<SwadharmaBundle>
  saveSwadharmaNote(scoreId: string, note: string): Promise<void>
  releaseSwadharma(input: { candidateId: string; reportId: string; to: 'candidate' | 'parent' | 'both'; reason: string }): Promise<void>
  careerMatches(candidateId: string): Promise<CareerMatch[]>
  streamMatches(candidateId: string): Promise<StreamMatch[]>
  setMatchAction(table: 'career_matches' | 'stream_matches', id: string, action: 'pinned' | 'hidden' | null): Promise<void>
  addCareerMatch(candidateId: string, careerId: string): Promise<void>
  addStreamMatch(candidateId: string, streamId: string): Promise<void>
  setMatchesPublished(table: 'career_matches' | 'stream_matches', candidateId: string, published: boolean): Promise<void>
  careers(): Promise<Career[]>
  streams(): Promise<StreamOption[]>
  sessions(candidateId: string): Promise<CounsellingSession[]>
  saveSession(s: Partial<CounsellingSession> & { candidate_id: string }): Promise<CounsellingSession>
  roadmap(candidateId: string): Promise<{ roadmap: Roadmap | null; items: RoadmapItem[] }>
  createRoadmap(candidateId: string, template: RoadmapTemplate, startDate: string): Promise<void>
  saveRoadmapItem(item: Partial<RoadmapItem> & { roadmap_id: string }): Promise<void>
  deleteRoadmapItem(id: string): Promise<void>
  setRoadmapStatus(roadmapId: string, status: Roadmap['status']): Promise<void>
  reports(candidateId: string): Promise<Report[]>
  requestReport(candidateId: string, kind: ReportKind, visibleTo: Visibility): Promise<void>
  reportUrl(reportId: string): Promise<string>
  documents(candidateId: string): Promise<DocumentFile[]>
  uploadDocument(candidateId: string, file: File): Promise<void>
  documentUrl(path: string): Promise<string>

  // candidate
  myCandidate(): Promise<Candidate | null>
  myInstruments(): Promise<MyInstrument[]>
  mySessions(): Promise<CounsellingSession[]>
  myProgress(): Promise<{ publishedOptions: boolean; publishedRoadmap: boolean; attendedSessions: number; profileApproved: boolean }>
  startAssessment(candidateId: string, instrumentId: string): Promise<string>
  nextItem(sessionId: string, position?: number): Promise<NextItem>
  saveResponses(sessionId: string, responses: Record<string, { a: unknown; rt: number }>): Promise<number>
  completeAssessment(sessionId: string): Promise<void>
}
