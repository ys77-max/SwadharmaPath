import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Track } from './types'

/** Copy that changes with the candidate's track. early_explorer is written to a 13–15-year-old. */
export const COPY = {
  standard: {
    steps: ['Onboard', 'Assess', 'Sessions', 'Options', 'Roadmap'],
    stepHints: [
      'Your profile, academics and consent',
      'Six short assessments, at your own pace',
      'One-to-one sessions with your counsellor',
      'Careers ranked for you, with pathways',
      'A dated plan you can track',
    ],
    hello: (name: string) => `Welcome back, ${name}`,
    intro: 'Here is where you are in your career plan.',
    assessTitle: 'Assessments',
    assessIntro: 'Answer honestly; there are no right or wrong answers except in the aptitude section. Your progress saves automatically.',
    start: 'Start',
    resume: 'Resume',
    done: 'Completed',
    runnerEncourage: 'Go with your first instinct.',
    finishTitle: 'Assessment complete',
    finishBody: 'Thank you. Your counsellor will review your results with you before anything is shared.',
    optionsLabel: 'Options',
    timedNote: 'This section is timed and you cannot go back to earlier questions.',
  },
  early_explorer: {
    steps: ['Onboard', 'Discover', 'Talk', 'Streams', 'Explore Plan'],
    stepHints: [
      'Tell us a bit about you (with a parent)',
      'Fun activities about what you like and how you think',
      'Chat with your counsellor',
      'Class 11 streams that keep your options open',
      'Things to try and explore this year',
    ],
    hello: (name: string) => `Hi ${name}! 👋`,
    intro: 'Let’s see how far you’ve come on your journey.',
    assessTitle: 'Discover activities',
    assessIntro: 'These aren’t exams! Just pick what feels most like you. You can stop any time and come back later.',
    start: 'Let’s go',
    resume: 'Keep going',
    done: 'Done ✓',
    runnerEncourage: 'There’s no wrong answer here. Pick what feels right!',
    finishTitle: 'Great job! 🎉',
    finishBody: 'You finished this activity. Your counsellor will talk through what it shows about your leanings.',
    optionsLabel: 'Streams',
    timedNote: 'This part has a timer. Take your best guess and keep moving; you can’t go back.',
  },
}
export type Copy = (typeof COPY)['standard']

interface TrackState {
  track: Track
  setTrack: (t: Track) => void
  junior: boolean
  copy: Copy
}

const TrackContext = createContext<TrackState | null>(null)

export function TrackProvider({ children }: { children: ReactNode }) {
  const [track, setTrack] = useState<Track>('student')
  const junior = track === 'early_explorer'

  useEffect(() => {
    document.documentElement.dataset.track = track
  }, [track])

  const value = useMemo(() => ({ track, setTrack, junior, copy: junior ? COPY.early_explorer : COPY.standard }), [track, junior])
  return <TrackContext.Provider value={value}>{children}</TrackContext.Provider>
}

export function useTrack() {
  const ctx = useContext(TrackContext)
  if (!ctx) throw new Error('useTrack outside TrackProvider')
  return ctx
}
