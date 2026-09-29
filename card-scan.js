// Finds a QR code or barcode in an uploaded photo, then straightens,
// tightly crops (with a small quiet-zone margin so it stays scannable)
// and contrast-enhances the image around it before it's saved to OPFS.
// If no code is found, the original image data URL is returned untouched.

const ZXING_BROWSER_URL = "./assets/vendor/zxing/browser.js";

export async function processCardImage(file) {
  const dataUrl = await readFileAsDataUrl(file);

  try {
    const image = await loadImage(dataUrl);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    sourceCanvas.getContext("2d").drawImage(image, 0, 0);

    const detection = await detectCode(sourceCanvas);
    const quad = detection && toQuad(detection);
    if (!quad) return dataUrl;

    const cropped = alignAndCrop(image, quad);
    if (!cropped) return dataUrl;

    enhanceContrast(cropped);

    // PNG (lossless) rather than JPEG: JPEG's compression artifacts blur the
    // sharp black/white module edges codes need to stay scannable.
    return cropped.toDataURL("image/png");
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
async function detectCode(canvas) {
  if ("BarcodeDetector" in window) {
    try {
      const detector = new BarcodeDetector();
      const [barcode] = await detector.detect(canvas);
      if (barcode) {
        return { source: "native", points: barcode.cornerPoints.map((p) => ({ x: p.x, y: p.y })) };
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
    const result = await new BrowserMultiFormatReader().decodeFromCanvas(canvas);
    const points = result.getResultPoints().map((p) => ({ x: p.getX(), y: p.getY() }));
    return { source: "zxing", points };
  } catch {
    return null;
  } finally {
    console.warn = originalWarn;
  }
}

// Normalizes a detection into a quadrilateral [topLeft, topRight, bottomRight, bottomLeft]
// that approximates the code's actual outer boundary (plus a little quiet zone).
function toQuad({ source, points }) {
  if (source === "native") {
    // The Shape Detection API already gives exact outer corners in this order.
    return points;
  }

  if (points.length === 2) {
    // A 1D barcode's result points are the left/right ends of the image row
    // ZXing's row-by-row scanner locked onto - always perfectly horizontal,
    // even when the photo itself is tilted, so there's no real tilt angle to
    // recover here (true alignment for 1D codes needs the native
    // BarcodeDetector instead). Crop a generous horizontal band around it so
    // a modest, uncorrected camera tilt still fits without clipping the bars.
    const [p0, p1] = points;
    const width = Math.abs(p1.x - p0.x) || 1;
    const halfHeight = width * 0.35;
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    return [
      { x: midX - width / 2, y: midY - halfHeight },
      { x: midX + width / 2, y: midY - halfHeight },
      { x: midX + width / 2, y: midY + halfHeight },
      { x: midX - width / 2, y: midY + halfHeight },
    ];
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
function alignAndCrop(image, [tl, tr, br, bl]) {
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
  const outWidth = Math.round(Math.min(width * padding, image.naturalWidth * 2));
  const outHeight = Math.round(Math.min(height * padding, image.naturalHeight * 2));

  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;

  const ctx = canvas.getContext("2d");
  ctx.translate(outWidth / 2, outHeight / 2);
  ctx.rotate(-angle);
  ctx.translate(-cx, -cy);
  ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);

  return canvas;
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Auto-contrast stretch (based on luminance min/max) to counter the flat,
// low-contrast look of typical phone photos, which helps re-scanning later.
function enhanceContrast(canvas) {
  const ctx = canvas.getContext("2d");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (luminance < min) min = luminance;
    if (luminance > max) max = luminance;
  }

  const range = max - min || 1;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp255(((data[i] - min) * 255) / range);
    data[i + 1] = clamp255(((data[i + 1] - min) * 255) / range);
    data[i + 2] = clamp255(((data[i + 2] - min) * 255) / range);
  }

  ctx.putImageData(imageData, 0, 0);
}

function clamp255(value) {
  return Math.max(0, Math.min(255, value));
}
