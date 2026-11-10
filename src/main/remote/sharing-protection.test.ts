import { describe, expect, it, vi } from 'vitest'
import { SharingProtection, type ProtectionTimers } from './sharing-protection'

function setup(alive = 0) {
  const timers = new Map<number, { fn: () => void; ms: number }>()
  let next = 1
  const fake: ProtectionTimers = {
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id },
    clearTimeout: handle => { timers.delete(handle as number) }
  }
  const state = { alive }
  const apply = vi.fn()
  const destroyAgents = vi.fn()
  const protection = new SharingProtection({ apply, agentsAlive: () => state.alive, destroyAgents, timers: fake, capMs: 5000 })
  const fire = (): void => { const [id, t] = [...timers.entries()][0]; timers.delete(id); t.fn() }
  return { protection, apply, destroyAgents, timers, state, fire }
}

describe('SharingProtection', () => {
  it('is on while locked', () => {
    const { protection, apply } = setup()
    protection.setLocked(true)
    expect(protection.protect).toBe(true)
    expect(apply).toHaveBeenCalledExactlyOnceWith(true)
    protection.setLocked(false)
    expect(apply).toHaveBeenLastCalledWith(false)
  })
  it('is on while sharing', () => {
    const { protection, apply } = setup()
    protection.setSharing(true)
    expect(apply).toHaveBeenCalledExactlyOnceWith(true)
  })
  it('goes on as soon as an agent window lives, before sharing', () => {
    const { protection, apply } = setup()
    protection.setAgents(1)
    expect(protection.protect).toBe(true)
    expect(apply).toHaveBeenCalledExactlyOnceWith(true)
  })
  it('calls apply only on change', () => {
    const { protection, apply } = setup()
    protection.setAgents(1)
    protection.setSharing(true)
    protection.setLocked(true)
    protection.setAgents(2)
    expect(apply).toHaveBeenCalledTimes(1)
  })
  it('falls only with sharing=false and agents=0', () => {
    const { protection, apply } = setup()
    protection.setAgents(1)
    protection.setSharing(true)
    protection.setSharing(false)
    expect(protection.protect).toBe(true)
    protection.setAgents(0)
    expect(protection.protect).toBe(false)
    expect(apply).toHaveBeenLastCalledWith(false)
  })
  it('starts the cap when sharing ends with live agents and clears it on setAgents(0)', () => {
    const { protection, timers } = setup()
    protection.setAgents(1)
    protection.setSharing(true)
    expect(timers.size).toBe(0)
    protection.setSharing(false)
    expect([...timers.values()].map(t => t.ms)).toEqual([5000])
    protection.setAgents(0)
    expect(timers.size).toBe(0)
  })
  it('drops the protection at the cap when no agent window is alive', () => {
    const { protection, apply, fire, destroyAgents } = setup(0)
    protection.setAgents(1)
    protection.setSharing(true)
    protection.setSharing(false)
    fire()
    expect(protection.protect).toBe(false)
    expect(apply).toHaveBeenLastCalledWith(false)
    expect(destroyAgents).not.toHaveBeenCalled()
  })
  it('stays on at the cap with a living window, destroys again and restarts the cap', () => {
    const { protection, apply, fire, destroyAgents, timers, state } = setup(1)
    protection.setAgents(1)
    protection.setSharing(true)
    protection.setSharing(false)
    fire()
    expect(destroyAgents).toHaveBeenCalledTimes(1)
    expect(protection.protect).toBe(true)
    expect(timers.size).toBe(1)
    expect(apply).toHaveBeenCalledTimes(1)
    state.alive = 0
    fire()
    expect(protection.protect).toBe(false)
  })
  it('setAgents(1) alone starts no timer (window setup may take longer than the cap)', () => {
    const { protection, timers, destroyAgents } = setup(1)
    protection.setAgents(1)
    expect(timers.size).toBe(0)
    protection.setAgents(2)
    expect(timers.size).toBe(0)
    expect(destroyAgents).not.toHaveBeenCalled()
    expect(protection.protect).toBe(true)
  })
  it('sessionEnded starts the cap when a session ends before sharing began, and agents=0 then drops the protection', () => {
    const { protection, timers, apply } = setup(1)
    protection.setAgents(1)
    protection.sessionEnded()
    expect(timers.size).toBe(1)
    protection.sessionEnded()
    expect(timers.size).toBe(1)
    protection.setAgents(0)
    expect(timers.size).toBe(0)
    expect(protection.protect).toBe(false)
    expect(apply).toHaveBeenLastCalledWith(false)
  })
  it('sessionEnded without agents or while sharing starts nothing', () => {
    const { protection, timers } = setup()
    protection.sessionEnded()
    expect(timers.size).toBe(0)
    protection.setAgents(1)
    protection.setSharing(true)
    protection.sessionEnded()
    expect(timers.size).toBe(0)
  })
  it('stops the cap when sharing resumes', () => {
    const { protection, timers } = setup(1)
    protection.setAgents(1)
    protection.setSharing(true)
    protection.setSharing(false)
    protection.setSharing(true)
    expect(timers.size).toBe(0)
  })
  it('dispose clears the timer', () => {
    const { protection, timers } = setup(1)
    protection.setAgents(1)
    protection.setSharing(true)
    protection.setSharing(false)
    protection.dispose()
    expect(timers.size).toBe(0)
  })
})
