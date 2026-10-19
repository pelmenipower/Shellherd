import { describe, expect, it } from 'vitest';
import { mayTakeFocus } from './focus-guard';

const node = (inside: boolean) => ({ contains: () => inside });

describe('mayTakeFocus', () => {
  const body = {};
  it('allows when nothing has focus or the body has it', () => {
    expect(mayTakeFocus(node(false), null, body)).toBe(true);
    expect(mayTakeFocus(node(false), body, body)).toBe(true);
  });
  it('allows when the focus is already inside the panel', () => {
    expect(mayTakeFocus(node(true), {}, body)).toBe(true);
  });
  it('refuses when another input outside the panel has the focus', () => {
    expect(mayTakeFocus(node(false), {}, body)).toBe(false);
  });
  it('refuses without a panel while something else has focus', () => {
    expect(mayTakeFocus(null, {}, body)).toBe(false);
  });
});
