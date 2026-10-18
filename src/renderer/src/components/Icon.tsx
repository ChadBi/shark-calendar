import type { ReactNode } from 'react'

const P: Record<string, ReactNode> = {
  chevronLeft: <path d="M15 18l-6-6 6-6" />,
  chevronRight: <path d="M9 18l6-6-6-6" />,
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  x: (
    <>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3 10.5h18" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.6a1.6 1.6 0 00.32 1.77l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.6 1.6 0 00-1.77-.32 1.6 1.6 0 00-.97 1.47V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1.05-1.46 1.6 1.6 0 00-1.77.32l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.6 1.6 0 00.32-1.77 1.6 1.6 0 00-1.47-.97H3a2 2 0 110-4h.1a1.6 1.6 0 001.46-1.05 1.6 1.6 0 00-.32-1.77l-.06-.06a2 2 0 112.83-2.83l.06.06a1.6 1.6 0 001.77.32H9a1.6 1.6 0 00.97-1.47V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.46 1.6 1.6 0 001.77-.32l.06-.06a2 2 0 112.83 2.83l-.06.06a1.6 1.6 0 00-.32 1.77V9a1.6 1.6 0 001.47.97H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1.03z" />
    </>
  ),
  pin: (
    <>
      <path d="M12 17v5" />
      <path d="M9 10.8a2 2 0 01-1.1 1.8l-1.8.9A2 2 0 005 15.2V16a1 1 0 001 1h12a1 1 0 001-1v-.8a2 2 0 00-1.1-1.8l-1.8-.9A2 2 0 0115 10.8V7a1 1 0 011-1 2 2 0 000-4H8a2 2 0 000 4 1 1 0 011 1z" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4.5A1.5 1.5 0 019.5 3h5A1.5 1.5 0 0116 4.5V6" />
      <path d="M18.5 6l-1 14H6.5l-1-14" />
    </>
  ),
  monitor: (
    <>
      <rect x="2.5" y="3.5" width="19" height="13" rx="2" />
      <path d="M8 20.5h8M12 16.5v4" />
    </>
  ),
  check: <path d="M20 6.5L9.5 17 4 11.5" />,
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 11-2.6-6.1" />
      <path d="M20.5 3.5V9h-5.5" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1 1" />
      <path d="M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7l1-1" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 12.5h4l1.5 2.5h6l1.5-2.5h4" />
      <path d="M5.5 5h13l2 7.5v5a2 2 0 01-2 2h-13a2 2 0 01-2-2v-5z" />
    </>
  )
}

export function Icon({
  name,
  size = 15,
  strokeWidth = 1.9
}: {
  name: keyof typeof P | string
  size?: number
  strokeWidth?: number
}): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {P[name] ?? null}
    </svg>
  )
}
