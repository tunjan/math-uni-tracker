import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const read = (): Theme => {
  try {
    const t = localStorage.getItem('theme')
    if (t === 'light' || t === 'dark') return t
  } catch { /* storage unavailable */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem('theme', next) } catch { /* ignore */ }
    setTheme(next)
  }
  return { theme, toggle }
}
