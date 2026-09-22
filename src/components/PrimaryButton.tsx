import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './PrimaryButton.module.css'

type PrimaryButtonProps = {
  children: ReactNode
  variant?: 'primary' | 'ghost' | 'quiet' | 'ai' | 'attention' | 'recommend'
  fullWidth?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>

export function PrimaryButton({
  children,
  variant = 'primary',
  fullWidth = false,
  type = 'button',
  className,
  ...props
}: PrimaryButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    fullWidth ? styles.fullWidth : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  )
}
