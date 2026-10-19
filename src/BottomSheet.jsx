import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as m from 'motion/react-m'
import { LazyMotion, useDragControls, useMotionValue, useReducedMotion } from 'motion/react'

import { SNAP, PEEK_HEIGHT, HALF_RATIO, SHEET_RATIO, useViewportHeight } from './sheetConfig'

// Animation and drag features (domMax) load in a separate chunk
const loadFeatures = () => import('./motionFeatures').then(mod => mod.default)

const SNAP_ORDER = [SNAP.FULL, SNAP.HALF, SNAP.PEEK]
const SPRING = { type: 'spring', stiffness: 380, damping: 40 }
const INSTANT = { duration: 0 }
const FLICK_POWER = 0.2 // how far a flick carries the sheet past the release point
const MotionAside = m.aside

// Sidebar on desktop; draggable bottom sheet with three snap points on mobile.
// Dragging starts only from the handle so it never fights content scrolling.
export default function BottomSheet({ id, label, isMobile, snap, onSnapChange, sheetRef, handle, children }) {
  const dragControls = useDragControls()
  const reduceMotion = useReducedMotion()
  const viewportHeight = useViewportHeight()
  // Height comes from CSS (82dvh), so estimate it up front: the snap points are
  // then right on the first render, before Motion's features finish loading
  const [sheetHeight, setSheetHeight] = useState(() => Math.round(window.innerHeight * SHEET_RATIO))
  const draggedRef = useRef(false)
  const dragTargetRef = useRef(snap)

  useLayoutEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const measure = () => setSheetHeight(el.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [sheetRef])

  // Translate offsets for each snap point (0 = fully open)
  const points = useMemo(() => ({
    [SNAP.FULL]: 0,
    [SNAP.HALF]: Math.max(0, sheetHeight - Math.round(viewportHeight * HALF_RATIO)),
    [SNAP.PEEK]: Math.max(0, sheetHeight - PEEK_HEIGHT)
  }), [sheetHeight, viewportHeight])

  const targetY = isMobile ? points[snap] : 0
  // Starts at the snap point so the first paint already shows the collapsed sheet
  const y = useMotionValue(targetY)

  // Settle a release on the nearest snap point, letting a flick carry it further
  const nearestSnap = (offset) => SNAP_ORDER.reduce((best, key) =>
    Math.abs(points[key] - offset) < Math.abs(points[best] - offset) ? key : best
  , SNAP_ORDER[0])

  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionAside
        id={id}
        ref={sheetRef}
        className="sidebar"
        aria-label={label}
        initial={false}
        animate={{ y: targetY }}
        transition={reduceMotion ? INSTANT : SPRING}
        style={{ y, '--sheet-hidden': isMobile ? `${points[snap]}px` : '0px' }}
        drag={isMobile ? 'y' : false}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: points[SNAP.PEEK] }}
        dragElastic={0.08}
        dragTransition={{
          power: FLICK_POWER,
          timeConstant: reduceMotion ? 50 : 200,
          // Inertia lands exactly on the snap point chosen in onDragEnd, which
          // also brings the sheet back when the snap point does not change
          modifyTarget: () => points[dragTargetRef.current]
        }}
        onDragStart={() => { draggedRef.current = true }}
        onDragEnd={(_, info) => {
          // Same projection Motion's inertia uses: release point plus flick distance
          dragTargetRef.current = nearestSnap(y.get() + info.velocity.y * FLICK_POWER)
          if (dragTargetRef.current !== snap) onSnapChange(dragTargetRef.current)
        }}
      >
        <div
          className="sheet-handle-area"
          onPointerDown={(e) => {
            draggedRef.current = false
            if (isMobile) dragControls.start(e)
          }}
          onClickCapture={(e) => {
            // A drag that ends over the handle must not also count as a tap
            if (draggedRef.current) {
              e.stopPropagation()
              e.preventDefault()
              draggedRef.current = false
            }
          }}
        >
          {handle}
        </div>
        {children}
      </MotionAside>
    </LazyMotion>
  )
}
