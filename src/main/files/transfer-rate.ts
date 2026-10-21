const WINDOW_MS = 3000;
const MIN_SPAN_MS = 1000;
const SAMPLE_MS = 100;

export interface RateMeter { add: (bytes: number) => number | undefined; reset: () => void }

/** Bytes per second over a sliding window of streamed chunks; undefined until the window spans MIN_SPAN_MS. */
export function rateMeter(now: () => number = Date.now): RateMeter {
  let samples: { at: number; total: number }[] = [];
  let total = 0;
  return {
    add(bytes) {
      total += bytes;
      const at = now();
      const last = samples[samples.length - 1];
      if (!last || at - last.at >= SAMPLE_MS) samples.push({ at, total });
      // The oldest kept sample is the base; one sample may sit just outside the window so the span stays near WINDOW_MS.
      while (samples.length > 1 && samples[1].at <= at - WINDOW_MS) samples.shift();
      const span = at - samples[0].at;
      return span >= MIN_SPAN_MS ? (total - samples[0].total) / span * 1000 : undefined;
    },
    reset() { samples = []; },
  };
}
