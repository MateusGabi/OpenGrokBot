/**
 * Shared pointer tracking for avatar eyes. One listener updates every
 * registered <g> via CSS custom properties, so pointer movement never
 * re-renders React. Values are in the SVG viewBox's user units.
 */

const targets = new Set<SVGGElement>()
let pointerX = 0
let pointerY = 0
let hasPointer = false
let frame = 0

const MAX_OFFSET = 2.2

function schedule(): void {
  if (frame || !hasPointer) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const el of targets) {
      const r = el.getBoundingClientRect()
      const dx = pointerX - (r.left + r.width / 2)
      const dy = pointerY - (r.top + r.height / 2)
      const distance = Math.hypot(dx, dy) || 1
      const reach = Math.min(MAX_OFFSET, distance / 110)
      el.style.setProperty('--eye-x', `${((dx / distance) * reach).toFixed(2)}px`)
      el.style.setProperty('--eye-y', `${((dy / distance) * reach).toFixed(2)}px`)
    }
  })
}

function onPointerMove(e: PointerEvent): void {
  if (e.pointerType === 'touch') return
  pointerX = e.clientX
  pointerY = e.clientY
  hasPointer = true
  schedule()
}

function onLayoutChange(): void {
  if (hasPointer) schedule()
}

/** Registers an avatar's eye group; returns a cleanup function. */
export function registerEyes(el: SVGGElement | null): () => void {
  if (!el) return () => {}
  targets.add(el)
  if (targets.size === 1) {
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('scroll', onLayoutChange, { passive: true, capture: true })
    window.addEventListener('resize', onLayoutChange, { passive: true })
  }
  schedule()
  return () => {
    targets.delete(el)
    el.style.removeProperty('--eye-x')
    el.style.removeProperty('--eye-y')
    if (targets.size === 0) {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('scroll', onLayoutChange, { capture: true })
      window.removeEventListener('resize', onLayoutChange)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    }
  }
}
