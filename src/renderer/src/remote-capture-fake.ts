// Test pattern for the run-app scene only, not UI: fixed colours are intentional (no design tokens).
import type { CaptureSource } from './remote-peer';

const QUADRANTS: [string, number, number][] = [
  ['rgb(230, 40, 40)', 0, 0],
  ['rgb(40, 190, 80)', 320, 0],
  ['rgb(40, 90, 230)', 0, 180],
  ['rgb(240, 200, 40)', 320, 180]
];

export function fakeCapture(): CaptureSource {
  return {
    capture: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext('2d')!;
      let flip = false;
      const draw = (): void => {
        for (const [color, x, y] of QUADRANTS) {
          context.fillStyle = color;
          context.fillRect(x, y, 320, 180);
        }
        // Alternating strip forces fresh frames; excluded from pixel checks.
        flip = !flip;
        context.fillStyle = flip ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
        context.fillRect(0, 344, 640, 16);
      };
      draw();
      const stream = canvas.captureStream(10);
      const timer = setInterval(draw, 100);
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); stop(); };
        track.addEventListener('ended', () => clearInterval(timer));
      }
      return stream;
    }
  };
}
