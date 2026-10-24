export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0f5257" />
      <path d="M8 22c3-8 7-12 16-14-5 4-8 8-9 14" fill="none" stroke="#f3e6cf" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="24" cy="8" r="2.5" fill="#e0a458" />
    </svg>
  )
}
