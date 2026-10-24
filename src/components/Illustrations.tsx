// Simple friendly illustrations for the early_explorer track.
const P = { pine: '#155e5d', light: '#a9d4d1', sand: '#f3e6cf', saffron: '#e0a458', ink: '#0c3f43' }

export function StepIllustration({ step, className = 'size-16' }: { step: number; className?: string }) {
  switch (step) {
    case 0: // onboard: id card
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden>
          <circle cx="32" cy="32" r="30" fill={P.sand} />
          <rect x="14" y="20" width="36" height="26" rx="5" fill="#fff" stroke={P.pine} strokeWidth="2.5" />
          <circle cx="25" cy="31" r="5" fill={P.saffron} />
          <path d="M19 41c1.5-4 10.5-4 12 0" fill="none" stroke={P.pine} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M35 29h10M35 35h7" stroke={P.light} strokeWidth="3" strokeLinecap="round" />
        </svg>
      )
    case 1: // discover: magnifier + star
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden>
          <circle cx="32" cy="32" r="30" fill={P.sand} />
          <circle cx="28" cy="28" r="11" fill="#fff" stroke={P.pine} strokeWidth="3" />
          <path d="M36 36l10 10" stroke={P.pine} strokeWidth="4" strokeLinecap="round" />
          <path d="M28 21l2 4.5 4.8.5-3.6 3.2 1 4.8-4.2-2.5-4.2 2.5 1-4.8-3.6-3.2 4.8-.5z" fill={P.saffron} />
        </svg>
      )
    case 2: // talk: speech bubbles
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden>
          <circle cx="32" cy="32" r="30" fill={P.sand} />
          <rect x="12" y="16" width="26" height="18" rx="6" fill={P.pine} />
          <path d="M18 34l-2 7 8-7" fill={P.pine} />
          <rect x="26" y="28" width="26" height="18" rx="6" fill="#fff" stroke={P.pine} strokeWidth="2.5" />
          <circle cx="33" cy="37" r="2" fill={P.saffron} /><circle cx="39" cy="37" r="2" fill={P.saffron} /><circle cx="45" cy="37" r="2" fill={P.saffron} />
        </svg>
      )
    case 3: // streams: signpost
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden>
          <circle cx="32" cy="32" r="30" fill={P.sand} />
          <path d="M31 14v38" stroke={P.ink} strokeWidth="3.5" strokeLinecap="round" />
          <path d="M31 18h16l5 5-5 5H31z" fill={P.pine} />
          <path d="M31 31H16l-5 5 5 5h15z" fill={P.saffron} />
        </svg>
      )
    default: // plan: rocket
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden>
          <circle cx="32" cy="32" r="30" fill={P.sand} />
          <path d="M32 12c8 6 10 16 6 28H26c-4-12-2-22 6-28z" fill="#fff" stroke={P.pine} strokeWidth="2.5" />
          <circle cx="32" cy="26" r="4" fill={P.light} stroke={P.pine} strokeWidth="2" />
          <path d="M26 34l-6 8h7M38 34l6 8h-7" fill={P.pine} />
          <path d="M29 42c0 5 3 8 3 8s3-3 3-8" fill={P.saffron} />
        </svg>
      )
  }
}
