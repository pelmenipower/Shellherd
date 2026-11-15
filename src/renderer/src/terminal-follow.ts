import type { Terminal } from '@xterm/xterm'

// Auto-scroll ("follow") controller for a terminal that receives streaming output.
// The logic assumes smoothScrollDuration 0 (xterm default; terminal-prefs.ts does not set it),
// so scrolls fire onScroll synchronously.

/** The few terminal calls the controller needs; a fake implements it in tests. */
export interface FollowTerminal {
  viewportY(): number
  baseY(): number
  /** Marker on an absolute buffer line; line() is -1 once the line was trimmed. */
  markLine(line: number): { line(): number; dispose(): void }
  scrollToLine(line: number): void
  scrollToBottom(): void
}

export interface FollowController {
  /** Current state; switches to false by itself when onScroll returns 'off'. */
  readonly on: boolean
  /** From term.onScroll. 'off' when this scroll switched auto-scroll off (scroll up or search jump while on). */
  onScroll(ydisp: number): 'off' | null
  /** From term.onWriteParsed: puts a held view back after output moved it. */
  onWriteParsed(): void
  /** Dock checkbox or search jump. Idempotent: the same state does nothing. */
  setFollow(on: boolean): void
  dispose(): void
}

export function followController(term: FollowTerminal, initialOn: boolean): FollowController {
  let on = initialOn
  let marker: { line(): number; dispose(): void } | null = null
  let atBottom = false
  let pending = false
  let busy = false
  let disposed = false

  const dropMarker = (): void => {
    marker?.dispose()
    marker = null
  }
  const setMarker = (line: number): void => {
    // Same line: keep the marker so output does not create one per line.
    if (marker && marker.line() === line) return
    dropMarker()
    marker = term.markLine(line)
  }
  const scrollOwn = (fn: () => void): void => {
    busy = true
    try {
      fn()
    } finally {
      busy = false
    }
  }

  if (!on) setMarker(term.viewportY())
  atBottom = term.viewportY() === term.baseY()

  return {
    get on() {
      return on
    },
    onScroll(ydisp) {
      if (disposed || busy) return null
      const base = term.baseY()
      if (on) {
        if (ydisp < base) {
          on = false
          setMarker(ydisp)
          atBottom = false
          return 'off'
        }
        atBottom = true
        return null
      }
      if (ydisp < base) {
        setMarker(ydisp)
        atBottom = false
        return null
      }
      if (atBottom && marker && marker.line() < base) {
        // Output pulled the view down; restore in onWriteParsed (viewport is in sync by then).
        pending = true
        return null
      }
      setMarker(ydisp)
      atBottom = true
      return null
    },
    onWriteParsed() {
      if (disposed || on || !pending || !marker) return
      pending = false
      const line = Math.max(0, marker.line())
      scrollOwn(() => term.scrollToLine(line))
      atBottom = term.viewportY() === term.baseY()
    },
    setFollow(next) {
      if (disposed || next === on) return
      on = next
      if (next) {
        dropMarker()
        pending = false
        scrollOwn(() => term.scrollToBottom())
        atBottom = true
      } else {
        setMarker(term.viewportY())
        atBottom = term.viewportY() === term.baseY()
      }
    },
    dispose() {
      if (disposed) return
      dropMarker()
      disposed = true
    }
  }
}

/** Adapter for a real xterm: marker offset relative to the cursor line (registerMarker is public API). */
export function xtermFollowTerminal(term: Terminal): FollowTerminal {
  return {
    viewportY: () => term.buffer.active.viewportY,
    baseY: () => term.buffer.active.baseY,
    markLine(line) {
      const b = term.buffer.active
      const m = term.registerMarker(line - b.baseY - b.cursorY)
      return { line: () => m.line, dispose: () => m.dispose() }
    },
    scrollToLine: (line) => term.scrollToLine(line),
    scrollToBottom: () => term.scrollToBottom()
  }
}
