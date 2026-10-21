import { describe, expect, it } from 'vitest';
import { rateMeter } from './transfer-rate';

describe('rate meter', () => {
  it('shows nothing before the window spans one second', () => {
    let t = 0;
    const meter = rateMeter(() => t);
    expect(meter.add(1024)).toBeUndefined();
    t = 600;
    expect(meter.add(1024)).toBeUndefined();
    t = 1200;
    expect(meter.add(1024)).toBeCloseTo(2048 / 1.2);
  });

  it('rolls the window and follows the latest section', () => {
    let t = 0;
    const meter = rateMeter(() => t);
    for (const at of [0, 1000, 2000, 3000]) { t = at; meter.add(1000); }
    t = 4000;
    meter.add(4000);
    t = 5000;
    expect(meter.add(4000)).toBe(3000);
  });

  it('stores one sample per 100 ms but counts every byte', () => {
    let t = 0;
    const meter = rateMeter(() => t);
    meter.add(1000);
    t = 50;
    meter.add(1000);
    t = 1000;
    expect(meter.add(1000)).toBe(2000);
  });

  it('starts over after reset', () => {
    let t = 0;
    const meter = rateMeter(() => t);
    meter.add(1000);
    t = 2000;
    meter.reset();
    expect(meter.add(1000)).toBeUndefined();
    t = 2500;
    expect(meter.add(1000)).toBeUndefined();
    t = 3000;
    expect(meter.add(1000)).toBe(2000);
  });
});
