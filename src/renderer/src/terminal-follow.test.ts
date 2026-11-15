import { describe, expect, it } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { followController, xtermFollowTerminal, type FollowTerminal } from './terminal-follow'

function fake(viewport = 0, base = 0) {
  const s = {
    viewport,
    base,
    markLine: 0,
    scrollToLine: [] as number[],
    scrollToBottom: 0,
    markers: [] as { line: number; disposed: boolean }[],
    onReenter: null as null | (() => void)
  }
  const term: FollowTerminal = {
    viewportY: () => s.viewport,
    baseY: () => s.base,
    markLine(line) {
      s.markLine++
      const m = { line, disposed: false }
      s.markers.push(m)
      return { line: () => m.line, dispose: () => void (m.disposed = true) }
    },
    scrollToLine(line) {
      s.scrollToLine.push(line)
      s.viewport = line
      s.onReenter?.()
    },
    scrollToBottom() {
      s.scrollToBottom++
      s.viewport = s.base
    }
  }
  return { s, term }
}

describe('followController', () => {
  it('switches off on scroll up while on', () => {
    const { s, term } = fake(10, 10)
    const c = followController(term, true)
    s.viewport = 4
    expect(c.onScroll(4)).toBe('off')
    expect(c.on).toBe(false)
    expect(s.markers.at(-1)?.line).toBe(4)
  })

  it('stays on at the bottom without scrolling', () => {
    const { s, term } = fake(10, 10)
    const c = followController(term, true)
    s.base = 11
    s.viewport = 11
    expect(c.onScroll(11)).toBeNull()
    expect(c.on).toBe(true)
    expect(s.scrollToLine).toEqual([])
    expect(s.scrollToBottom).toBe(0)
  })

  it('holds the view: restores in onWriteParsed, ignores reentrant onScroll', () => {
    const { s, term } = fake(10, 10)
    const c = followController(term, false) // marker on 10, at bottom
    s.base = 11
    s.viewport = 11 // output pulled the view down
    expect(c.onScroll(11)).toBeNull()
    expect(s.scrollToLine).toEqual([])
    const before = s.markLine
    s.onReenter = () => expect(c.onScroll(10)).toBeNull()
    c.onWriteParsed()
    expect(s.scrollToLine).toEqual([10])
    expect(s.markLine).toBe(before)
    c.onWriteParsed() // no pending: nothing
    expect(s.scrollToLine).toEqual([10])
  })

  it('moves the marker when the user scrolls down to the bottom, then holds there', () => {
    const { s, term } = fake(3, 10)
    const c = followController(term, false) // marker on 3, not at bottom
    s.viewport = 10
    expect(c.onScroll(10)).toBeNull()
    expect(s.markers.at(-1)?.line).toBe(10)
    s.base = 11
    s.viewport = 11
    c.onScroll(11)
    c.onWriteParsed()
    expect(s.scrollToLine).toEqual([10])
  })

  it('does not create a new marker for the same line', () => {
    const { s, term } = fake(5, 10)
    const c = followController(term, false)
    const n = s.markLine
    c.onScroll(5)
    expect(s.markLine).toBe(n)
  })

  it('setFollow(true) scrolls to bottom once and is idempotent', () => {
    const { s, term } = fake(3, 10)
    const c = followController(term, false)
    c.setFollow(true)
    expect(s.scrollToBottom).toBe(1)
    expect(s.markers.every((m) => m.disposed)).toBe(true)
    c.setFollow(true)
    expect(s.scrollToBottom).toBe(1)
  })

  it('setFollow(false) marks the viewport and is idempotent', () => {
    const { s, term } = fake(7, 7)
    const c = followController(term, true)
    c.setFollow(false)
    expect(s.markLine).toBe(1)
    expect(s.markers[0].line).toBe(7)
    c.setFollow(false)
    expect(s.markLine).toBe(1)
  })

  it('jumps to line 0 when the marker was trimmed', () => {
    const { s, term } = fake(10, 10)
    const c = followController(term, false)
    s.markers[0].line = -1
    s.base = 11
    s.viewport = 11
    c.onScroll(11)
    c.onWriteParsed()
    expect(s.scrollToLine).toEqual([0])
  })

  it('sets the marker immediately when created off', () => {
    const { s, term } = fake(4, 9)
    followController(term, false)
    expect(s.markLine).toBe(1)
    expect(s.markers[0].line).toBe(4)
  })

  it('does nothing after dispose', () => {
    const { s, term } = fake(10, 10)
    const c = followController(term, false)
    c.dispose()
    expect(s.markers[0].disposed).toBe(true)
    const n = s.markLine
    s.base = 11
    s.viewport = 11
    expect(c.onScroll(11)).toBeNull()
    c.onWriteParsed()
    c.setFollow(true)
    c.setFollow(false)
    expect(s.markLine).toBe(n)
    expect(s.scrollToLine).toEqual([])
    expect(s.scrollToBottom).toBe(0)
  })
})

describe('xtermFollowTerminal', () => {
  it('maps marker lines relative to the cursor line', () => {
    const calls: number[] = []
    const xterm = {
      buffer: { active: { viewportY: 3, baseY: 10, cursorY: 4 } },
      registerMarker: (off: number) => {
        calls.push(off)
        return { line: 42, dispose: () => undefined }
      },
      scrollToLine: () => undefined,
      scrollToBottom: () => undefined
    } as unknown as Terminal
    const t = xtermFollowTerminal(xterm)
    expect(t.viewportY()).toBe(3)
    expect(t.baseY()).toBe(10)
    const m = t.markLine(12)
    expect(calls).toEqual([-2])
    expect(m.line()).toBe(42)
  })
})
