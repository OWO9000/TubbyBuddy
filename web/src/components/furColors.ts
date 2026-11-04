/**
 * Fur color unlocks. Each one moves the pink fur to a new hue (and optionally scales saturation/value) in HSV,
 * so whites, blacks and the outline stay clean. Shared by the 3D viewer; the Android PNGs are pre-rendered
 * with the same numbers.
 */
export interface Fur { shift: number; sat: number; val: number }

export const FUR: Record<string, Fur> = {
  "color-classic": { shift: 0, sat: 1, val: 1 },
  "color-mint": { shift: -165, sat: 0.9, val: 1 },
  "color-ocean": { shift: -118, sat: 1, val: 1 },
  "color-grape": { shift: -51, sat: 1, val: 1 },
  "color-sunset": { shift: 59, sat: 1, val: 1 },
  "color-midnight": { shift: -95, sat: 0.85, val: 0.65 },
  "color-gold": { shift: 83, sat: 0.95, val: 1 },
};

export function furFor(c?: { id: string } | null): Fur | null {
  const f = c ? FUR[c.id] : undefined;
  return f && (f.shift || f.sat !== 1 || f.val !== 1) ? f : null;
}

/** Recolor one RGB triple (0..1). Low-saturation pixels (white, black, grey outline) are left alone. */
export function recolor(r: number, g: number, b: number, f: Fur): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  const w = Math.min(1, Math.max(0, (s - 0.06) / 0.14)); // 0 below ~6% saturation, 1 above ~20%
  if (w === 0) return [r, g, b];
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  h = (((h + f.shift) % 360) + 360) % 360;
  const s2 = Math.min(1, s * f.sat);
  const v2 = max * f.val;
  const c = v2 * s2;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v2 - c;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + (r1 + m - r) * w, g + (g1 + m - g) * w, b + (b1 + m - b) * w];
}

/** Recolor a whole image into a new canvas (one pass, ~1M px for the 1000² texture). */
export function recolorImage(img: CanvasImageSource & { width: number; height: number }, f: Fur): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = recolor(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, f);
    px[i] = Math.round(r * 255);
    px[i + 1] = Math.round(g * 255);
    px[i + 2] = Math.round(b * 255);
  }
  ctx.putImageData(data, 0, 0);
  return c;
}
