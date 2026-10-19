import { useEffect, useState } from 'react'

export const SNAP = { PEEK: 'peek', HALF: 'half', FULL: 'full' }
export const PEEK_HEIGHT = 72 // keep in sync with --sheet-peek in index.css
export const SHEET_RATIO = 0.82 // sheet height as share of the viewport; keep in sync with 82dvh in index.css
export const HALF_RATIO = 0.45 // share of the viewport the half-open sheet covers

export function useViewportHeight() {
  const [height, setHeight] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return height
}
