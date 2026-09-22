type SpreadsheetIconProps = {
  size?: number
}

export function SpreadsheetIcon({ size = 22 }: SpreadsheetIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="4.5"
        y="3.5"
        width="15"
        height="17"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M4.5 8.5h15M10 8.5v12" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
