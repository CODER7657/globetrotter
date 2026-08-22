/**
 * Mesh gradients drawn to a canvas, plus palette extraction from the result.
 *
 * The card faces are painted here rather than declared as CSS gradients for
 * one reason: the ambient glow behind the carousel is sampled from the same
 * pixels the user is looking at. Reading colours back off the rendered face
 * means the glow cannot drift out of sync with the artwork, and it keeps
 * working unchanged if these faces are later swapped for real photography.
 */

export interface Blob {
  /** Centre, as a fraction of the canvas (0–1). */
  x: number;
  y: number;
  /** Radius, as a fraction of canvas width. */
  r: number;
  /** A design-system token name, e.g. `--gt-color-gradient-ember-1`. */
  color: string;
}

export interface MeshSpec {
  /** A design-system token name. */
  base: string;
  blobs: Blob[];
}

/**
 * Resolve a token name to something canvas can paint with.
 *
 * The tokens are authored in oklch, which Canvas2D support for is still
 * uneven, so the value is round-tripped through a probe element and read back
 * as rgb(). The browser does the conversion, which means no colour maths — and
 * no hex — lives in this app.
 */
const resolved = new Map<string, string>();

function resolveToken(name: string): string {
  const cached = resolved.get(name);
  if (cached !== undefined) return cached;

  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${name})`;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();

  const value = toSrgb(computed);
  resolved.set(name, value);
  return value;
}

/**
 * Force a colour into `rgb()`.
 *
 * Chrome reports a computed colour in the space it was authored in, so an
 * oklch token comes back as `oklch(0.52 0.16 37.6)` rather than rgb. Those
 * three numbers look enough like RGB channels to be parsed as them — which
 * silently renders every warm gradient as near-black. Painting one pixel and
 * reading it back makes the browser do the conversion properly.
 */
function toSrgb(colour: string): string {
  if (colour.startsWith('rgb')) return colour;

  const scratch = document.createElement('canvas');
  scratch.width = 1;
  scratch.height = 1;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return colour;

  // A fillStyle the browser cannot parse is ignored, leaving the previous
  // value in place — so comparing before and after tells us whether the
  // assignment actually took, without needing a literal colour to compare to.
  const before = ctx.fillStyle;
  ctx.fillStyle = colour;
  if (ctx.fillStyle === before) return colour;

  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

/** Paint a mesh gradient: a flat base, then soft radial blobs over it. */
export function paintMesh(canvas: HTMLCanvasElement, spec: MeshSpec, size = 320): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);

  const ctx = canvas.getContext('2d');
  if (ctx === null) return;

  ctx.scale(dpr, dpr);
  ctx.fillStyle = resolveToken(spec.base);
  ctx.fillRect(0, 0, size, size);

  // 'lighter' would blow out to white where blobs overlap. Source-over with
  // soft-edged stops keeps the blends in the same register as the reference.
  ctx.globalCompositeOperation = 'source-over';

  for (const blob of spec.blobs) {
    const cx = blob.x * size;
    const cy = blob.y * size;
    const radius = blob.r * size;

    const colour = resolveToken(blob.color);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, withAlpha(colour, 0.95));
    grad.addColorStop(0.55, withAlpha(colour, 0.45));
    grad.addColorStop(1, withAlpha(colour, 0));

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
}

/** A computed `rgb(r, g, b)` plus an alpha, as an rgba() string. */
function withAlpha(rgb: string, alpha: number): string {
  const parts = /(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)/.exec(rgb);
  if (parts === null) return rgb;
  return `rgba(${parts[1]}, ${parts[2]}, ${parts[3]}, ${alpha})`;
}

export interface Swatch {
  r: number;
  g: number;
  b: number;
}

export function toRgbString({ r, g, b }: Swatch): string {
  return `rgb(${r} ${g} ${b})`;
}

/**
 * Pull the most colourful swatches out of a painted canvas.
 *
 * Downsamples to an 8×8 grid first — 64 samples is plenty to characterise a
 * soft gradient, and it avoids reading a quarter of a million pixels on every
 * carousel step. Samples are ranked by saturation because the near-neutral
 * corners of a mesh carry no useful information about what the card looks
 * like; the vivid centre is what the eye reads as "the colour".
 */
export function extractPalette(canvas: HTMLCanvasElement, count = 3): Swatch[] {
  const grid = 8;
  const scratch = document.createElement('canvas');
  scratch.width = grid;
  scratch.height = grid;

  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return [];

  try {
    ctx.drawImage(canvas, 0, 0, grid, grid);
  } catch {
    // Tainted canvas (a cross-origin image). No palette, no glow.
    return [];
  }

  const { data } = ctx.getImageData(0, 0, grid, grid);
  const samples: Array<{ swatch: Swatch; score: number }> = [];

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    // Mid-lightness colours read best as light. Pure white and near-black
    // both make a poor glow, so weight against both ends.
    const lightness = max / 255;
    const score = saturation * (1 - Math.abs(lightness - 0.62));

    samples.push({ swatch: { r, g, b }, score });
  }

  samples.sort((a, b) => b.score - a.score);

  // Keep the picks visibly distinct, or the glow is three copies of one hue.
  const chosen: Swatch[] = [];
  for (const { swatch } of samples) {
    if (chosen.length >= count) break;
    const tooClose = chosen.some(
      (c) =>
        Math.abs(c.r - swatch.r) + Math.abs(c.g - swatch.g) + Math.abs(c.b - swatch.b) < 60,
    );
    if (!tooClose) chosen.push(swatch);
  }
  return chosen;
}
