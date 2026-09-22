import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import styles from './ZillionLogo.module.css'

type ZillionLogoProps = {
  size?: number
}

export function ZillionLogo({ size = 40 }: ZillionLogoProps) {
  const reducedMotion = usePrefersReducedMotion()

  return (
    <span
      className={styles.wrap}
      style={{ height: size }}
      data-reduced={reducedMotion ? 'true' : 'false'}
      aria-hidden="true"
    >
      <img
        className={styles.mark}
        src="/zillion-logo.webp"
        alt=""
        height={size}
        decoding="async"
      />
    </span>
  )
}
