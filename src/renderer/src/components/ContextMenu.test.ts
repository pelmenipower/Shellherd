import { describe, expect, it } from 'vitest';
import { clampMenuPosition } from './ContextMenu';

describe('clampMenuPosition', () => {
  it('keeps the requested corner when the menu fits', () => {
    expect(clampMenuPosition(100, 120, 200, 200, 1000, 800)).toEqual({ left: 100, top: 120 });
  });

  it('moves a menu that would leave the bottom edge back inside by 4 px', () => {
    // 200 px menu, 300 px viewport, requested y 250: bottom edge would be at 450
    expect(clampMenuPosition(10, 250, 200, 200, 1000, 300)).toEqual({ left: 10, top: 96 });
  });

  it('re-clamps after the menu grew, as when the access reasons arrive', () => {
    expect(clampMenuPosition(10, 250, 200, 280, 1000, 300)).toEqual({ left: 10, top: 16 });
  });

  it('never goes above or left of the 4 px margin', () => {
    expect(clampMenuPosition(-20, -20, 200, 200, 1000, 800)).toEqual({ left: 4, top: 4 });
  });
});
