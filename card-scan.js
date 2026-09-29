// Finds a QR code or barcode in an uploaded photo, then straightens,
// tightly crops (with a small quiet-zone margin so it stays scannable)
// and turns the image around it into a clean, high-contrast black & white
// (or grayscale) picture that's verified to still decode, before it's saved.
// If no code is found, the original image data URL is returned untouched.

const ZXING_BROWSER_URL = "./assets/vendor/zxing/browser.js";
const ZXING_LIBRARY_URL = "./assets/vendor/zxing/library.js";

// Phone photos are far too large to scan as-is: at ~4000px wide, focus blur,
// paper texture and screen pixels smear every module edge across many pixels
// and ZXing's thresholding/finder search falls apart. Scanning downscaled
// copies fixes that (and is much faster); zoomed-in crops of the middle of
// the frame then catch codes that are only a small part of the photo. The
// views are tried in order and the first hit wins.
// Longest side of the saved, cropped code image in px, tried in this order
const OUTPUT_SIZES = [900, 600, 400];

const SCAN_VIEWS = [
  // [crop size as fraction of the photo (centered), longest side in px]
  [1, 1400],
  [1, 1000],
  [0.6, 1000],
  [1, 2000],
  [0.6, 1400],
  [0.4, 700],
  [0.4, 1200],
  [1, 700],
];

export async function processCardImage(file) {
  const dataUrl = await readFileAsDataUrl(file);

  try {
    const image = await loadImage(dataUrl);

    const detection = await detectCode(image);
    const quad = detection && toQuad(detection, image);
    if (!quad) return dataUrl;

    // Try black & white first: it's the easiest for scanners to read (and
    // for ZXing, which misreads the amplified sensor noise in grayscale), but
    // thresholding can merge very thin or blurry bars. So check each candidate
    // actually decodes, falling back to grayscale and then to smaller sizes
    // (a smaller copy of a blurry photo is sharper per pixel).
    let output = null;
    for (const size of OUTPUT_SIZES) {
      const cropped = alignAndCrop(image, quad, size);
      if (!cropped) return dataUrl;
      enhanceContrast(cropped);
      output ??= cropped; // if nothing decodes, keep the largest grayscale crop

      const binarized = binarize(cropped);
      if (await decodes(binarized)) {
        output = binarized;
        break;
      }
      if (await decodes(cropped)) {
        output = cropped;
        break;
      }
    }

    // PNG (lossless) rather than JPEG: JPEG's compression artifacts blur the
    // sharp black/white module edges codes need to stay scannable.
    return output.toDataURL("image/png");
  } catch (err) {
    console.warn("Card image optimization skipped, using original photo:", err);
    return dataUrl;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

// Returns { source, points } for the first detected code - "source" matters
// because the two detectors report geometry completely differently - or null.
// Points are always in the original image's pixel coordinates.
async function detectCode(image) {
  const views = SCAN_VIEWS.map(([crop, longSide]) => makeView(image, crop, longSide));

  // The native detector (Android Chrome; not available in Safari) is fast
  // and robust, so give it every view before falling back to ZXing.
  if ("BarcodeDetector" in window) {
    try {
      const detector = new BarcodeDetector();
      for (const view of views) {
        const [barcode] = await detector.detect(view.canvas);
        if (barcode) return { source: "native", points: barcode.cornerPoints.map(view.toImage) };
      }
    } catch {
      // Fall through to the ZXing fallback below.
    }
  }

  // ZXing logs a console.warn() for every format it tries and fails to
  // match, which is normal, expected control flow (not a real problem) for
  // every one of the many format readers it runs per photo - silence it for
  // the duration of this call so a plain, code-less photo doesn't spam the
  // console with irrelevant stack traces.
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const { BrowserMultiFormatReader } = await import(ZXING_BROWSER_URL);
    const { DecodeHintType } = await import(ZXING_LIBRARY_URL);
    // TRY_HARDER scans more rows/rotations: slower, but finds far more codes
    // in real-world photos (tilted, blurry, low contrast).
    const reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.TRY_HARDER, true]]));
    for (const view of views) {
      try {
        const result = reader.decodeFromCanvas(view.canvas);
        const points = result.getResultPoints().map((p) => view.toImage({ x: p.getX(), y: p.getY() }));
        return { source: "zxing", points };
      } catch {
        // Nothing found in this view, try the next one.
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    console.warn = originalWarn;
  }
}

// Whether ZXing can read a code in `canvas` (used to verify processed crops).
async function decodes(canvas) {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const { BrowserMultiFormatReader } = await import(ZXING_BROWSER_URL);
    const { DecodeHintType } = await import(ZXING_LIBRARY_URL);
    new BrowserMultiFormatReader(new Map([[DecodeHintType.TRY_HARDER, true]])).decodeFromCanvas(canvas);
    return true;
  } catch {
    return false;
  } finally {
    console.warn = originalWarn;
  }
}

// A centered crop of `crop` x the image's size, scaled so its longest side is
// at most `longSide` px, plus a function mapping its points back to the image.
function makeView(image, crop, longSide) {
  const sw = image.naturalWidth * crop;
  const sh = image.naturalHeight * crop;
  const sx = (image.naturalWidth - sw) / 2;
  const sy = (image.naturalHeight - sh) / 2;
  const scale = Math.min(1, longSide / Math.max(sw, sh));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  return { canvas, toImage: (p) => ({ x: sx + p.x / scale, y: sy + p.y / scale }) };
}

// Normalizes a detection into a quadrilateral [topLeft, topRight, bottomRight, bottomLeft]
// that approximates the code's actual outer boundary (plus a little quiet zone).
function toQuad({ source, points }, image) {
  if (source === "native") {
    // The Shape Detection API already gives exact outer corners in this order.
    return points;
  }

  if (points.length === 2) {
    // A 1D barcode's result points are just the two ends of the single line
    // ZXing read across the bars - not where the bars start or end, nor how
    // they're tilted. Trace the bars from that line to find both.
    const [p0, p1] = points;
    return traceBarcode(image, p0, p1) ?? bandAround(p0, p1);
  }

  if (points.length >= 3) {
    // QR/Aztec/Data Matrix: ZXing's first three points are the *centers* of
    // the finder patterns, reported as [bottomLeft, topLeft, topRight] (a
    // possible 4th point is the alignment pattern and is ignored here).
    // Those centers sit ~3.5 modules inside the code's true corners, so the
    // parallelogram they form is noticeably smaller than the actual symbol -
    // scale it back out around its own center before cropping to it, or the
    // crop clips straight into the code. 1.5x matches the smallest QR
    // version's ratio, which errs toward extra quiet zone rather than clipping.
    const [bl, tl, tr] = points;
    const br = { x: tr.x + bl.x - tl.x, y: tr.y + bl.y - tl.y };
    return scaleQuad([tl, tr, br, bl], 1.5);
  }

  return null;
}

// Finds a 1D barcode's real extent and tilt, starting from the line p0 -> p1
// that ZXing decoded across its bars: steps outward from that line in both
// directions, comparing the brightness profile along each parallel line with
// the decoded one. While still on the bars the profiles match (just shifted
// sideways when the bars are tilted, which is tracked); past the ends of the
// bars (digits, card background) they stop matching. Returns a quad around
// the bars, with quiet zone, or null if the bars couldn't be followed.
function traceBarcode(image, p0, p1) {
  const length = distance(p0, p1);
  if (length < 20) return null;

  // Analyze a square region around the line at <= ~1200 samples across it
  const scale = Math.min(1, 1200 / length);
  const reach = length * 0.8; // bars are virtually never taller than this
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const origin = { x: mid.x - reach - length / 2, y: mid.y - reach - length / 2 };
  const size = Math.ceil((2 * reach + length) * scale);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, -origin.x * scale, -origin.y * scale, image.naturalWidth * scale, image.naturalHeight * scale);
  const rgba = ctx.getImageData(0, 0, size, size).data;

  const u = { x: (p1.x - p0.x) / length, y: (p1.y - p0.y) / length }; // along the line
  const v = { x: -u.y, y: u.x }; // across it, towards the bars' "bottom"
  const samples = Math.round(length * scale);
  const margin = Math.round(samples * 0.3); // room to follow tilted bars sideways

  // Brightness along the line offset by t (in analysis px) across the bars
  const profile = (t) => {
    const row = new Float32Array(samples + 2 * margin);
    for (let i = 0; i < row.length; i++) {
      const d = (i - margin) / scale;
      const x = Math.round((p0.x + u.x * d + v.x * (t / scale) - origin.x) * scale);
      const y = Math.round((p0.y + u.y * d + v.y * (t / scale) - origin.y) * scale);
      const k = (Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))) * 4;
      row[i] = 0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2];
    }
    return row;
  };

  const ref = profile(0).subarray(margin, margin + samples);
  const refMean = ref.reduce((a, b) => a + b, 0) / samples;
  const refDev = ref.map((x) => x - refMean);
  const refNorm = Math.hypot(...refDev) || 1;
  // Normalized cross-correlation of the reference with `row` shifted by `shift`
  const similarity = (row, shift) => {
    const start = margin + shift;
    if (start < 0 || start + samples > row.length) return -1;
    let mean = 0;
    for (let i = 0; i < samples; i++) mean += row[start + i];
    mean /= samples;
    let dot = 0;
    let norm = 0;
    for (let i = 0; i < samples; i++) {
      const d = row[start + i] - mean;
      dot += d * refDev[i];
      norm += d * d;
    }
    return dot / (refNorm * Math.sqrt(norm) || 1);
  };

  const step = Math.max(1, Math.round(samples / 300));
  const limit = reach * scale;
  const ends = [-1, 1].map((dir) => {
    let shift = 0;
    let end = { t: 0, shift: 0 };
    let misses = 0;
    for (let t = dir * step; Math.abs(t) < limit && misses < 3; t += dir * step) {
      const row = profile(t);
      let best = -1;
      let bestShift = shift;
      for (let s = shift - step - 1; s <= shift + step + 1; s++) {
        const c = similarity(row, s);
        if (c > best) [best, bestShift] = [c, s];
      }
      if (best >= 0.6) {
        shift = bestShift;
        end = { t, shift };
        misses = 0;
      } else {
        misses++;
      }
    }
    return end;
  });

  const [top, bottom] = ends;
  const span = bottom.t - top.t;
  if (span < samples * 0.08) return null; // couldn't follow the bars at all

  // Sideways drift per step across = the bars' tilt relative to the line
  const skew = (bottom.shift - top.shift) / span;
  const stretch = Math.hypot(1, skew);
  const along = { x: (u.x - skew * v.x) / stretch, y: (u.y - skew * v.y) / stretch };
  const across = { x: (v.x + skew * u.x) / stretch, y: (v.y + skew * u.y) / stretch };

  const tMid = (top.t + bottom.t) / 2 / scale;
  const center = {
    x: mid.x + v.x * tMid + u.x * skew * tMid,
    y: mid.y + v.y * tMid + u.y * skew * tMid,
  };
  // ZXing's end points sit on the start/stop patterns, inside the quiet zone,
  // and the digits printed under the bars stop the trace - leave room for both.
  const halfWidth = ((length / 2) / stretch) * 1.25;
  const halfHeight = ((span / 2 / scale) * stretch) * 1.45;

  const corner = (w, h) => ({
    x: center.x + along.x * w + across.x * h,
    y: center.y + along.y * w + across.y * h,
  });
  return [
    corner(-halfWidth, -halfHeight),
    corner(halfWidth, -halfHeight),
    corner(halfWidth, halfHeight),
    corner(-halfWidth, halfHeight),
  ];
}

// Fallback when the bars can't be traced: a generous band around the line.
function bandAround(p0, p1) {
  const width = distance(p0, p1) || 1;
  const halfHeight = width * 0.5;
  const midX = (p0.x + p1.x) / 2;
  const midY = (p0.y + p1.y) / 2;
  return [
    { x: midX - width / 2, y: midY - halfHeight },
    { x: midX + width / 2, y: midY - halfHeight },
    { x: midX + width / 2, y: midY + halfHeight },
    { x: midX - width / 2, y: midY + halfHeight },
  ];
}

function scaleQuad(quad, factor) {
  const cx = quad.reduce((sum, p) => sum + p.x, 0) / quad.length;
  const cy = quad.reduce((sum, p) => sum + p.y, 0) / quad.length;
  return quad.map((p) => ({
    x: cx + (p.x - cx) * factor,
    y: cy + (p.y - cy) * factor,
  }));
}

// Rotates the source image so the quad's top edge is horizontal, then crops
// tightly around it in a single drawImage call (transform math handles both).
function alignAndCrop(image, [tl, tr, br, bl], maxSize) {
  const angle = Math.atan2(
    (tr.y - tl.y + (br.y - bl.y)) / 2,
    (tr.x - tl.x + (br.x - bl.x)) / 2
  );

  const width = (distance(tl, tr) + distance(bl, br)) / 2;
  const height = (distance(tl, bl) + distance(tr, br)) / 2;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 4 || height < 4) {
    return null;
  }

  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + tr.y + br.y + bl.y) / 4;

  // Small extra safety margin on top of whatever quiet zone toQuad already
  // built in, to absorb angle/estimation error rather than clipping the code.
  const padding = 1.2;
  // Keep the saved crop at a sensible size: a full-resolution crop from a
  // phone photo just carries the photo's blur over many more pixels, which
  // makes it both larger and harder for checkout scanners to read.
  const scale = Math.min(1, maxSize / (Math.max(width, height) * padding));
  const outWidth = Math.round(width * padding * scale);
  const outHeight = Math.round(height * padding * scale);

  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.translate(outWidth / 2, outHeight / 2);
  ctx.scale(scale, scale);
  ctx.rotate(-angle);
  ctx.translate(-cx, -cy);
  ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);

  return canvas;
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Turns the crop into a clean, high-contrast grayscale image: codes are
// black and white anyway, and dropping the color removes screen tints and
// warm indoor lighting. The stretch uses the 2nd/98th brightness percentiles
// rather than the absolute darkest/brightest pixel, which sensor noise and
// glare always push to ~0 and ~255, so a plain min/max stretch does nothing.
function enhanceContrast(canvas) {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const luminance = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    data[i] = luminance;
    histogram[luminance]++;
  }

  const pixels = data.length / 4;
  const percentile = (fraction) => {
    let count = 0;
    for (let value = 0; value < 256; value++) {
      count += histogram[value];
      if (count >= pixels * fraction) return value;
    }
    return 255;
  };
  const black = percentile(0.02);
  const white = percentile(0.98);
  const range = white - black || 1;

  for (let i = 0; i < data.length; i += 4) {
    const value = clamp255(((data[i] - black) * 255) / range);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  ctx.putImageData(imageData, 0, 0);
}

// Adaptive black & white threshold of a grayscale canvas (returns a new one):
// a light blur first removes sensor noise, then each pixel is compared to the
// mean brightness of its neighbourhood (Bradley's method, via an integral
// image), which copes with uneven lighting and glare across the code.
function binarize(source) {
  const { width, height } = source;
  const src = source.getContext("2d").getImageData(0, 0, width, height).data;

  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = src[i * 4];
  const smooth = boxBlur(gray, width, height, Math.max(1, Math.round(Math.max(width, height) / 450)));

  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += smooth[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum;
    }
  }

  const radius = Math.max(8, Math.round(Math.min(width, height) / 8));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const out = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum =
        integral[y1 * (width + 1) + x1] -
        integral[y0 * (width + 1) + x1] -
        integral[y1 * (width + 1) + x0] +
        integral[y0 * (width + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const value = smooth[y * width + x] < mean * 0.85 ? 0 : 255;
      const k = (y * width + x) * 4;
      out.data[k] = out.data[k + 1] = out.data[k + 2] = value;
      out.data[k + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

// Separable box blur of a width x height grayscale buffer.
function boxBlur(values, width, height, radius) {
  const pass = (input, length, count, stride, step) => {
    const output = new Float32Array(input.length);
    for (let line = 0; line < count; line++) {
      const base = line * stride;
      for (let i = 0; i < length; i++) {
        let sum = 0;
        let n = 0;
        for (let j = Math.max(0, i - radius); j <= Math.min(length - 1, i + radius); j++) {
          sum += input[base + j * step];
          n++;
        }
        output[base + i * step] = sum / n;
      }
    }
    return output;
  };
  const horizontal = pass(values, width, height, width, 1);
  return pass(horizontal, height, width, 1, width);
}

function clamp255(value) {
  return Math.max(0, Math.min(255, value));
}
