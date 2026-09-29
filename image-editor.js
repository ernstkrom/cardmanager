// Lets the user fine-tune the auto-enhanced card image before it's saved:
// crop (drag the corners/edges of the crop box, or drag inside it to move
// it), rotate in 90° steps or straighten with the slider, or switch to the
// original, unprocessed photo if the automatic crop picked the wrong spot.

// Longest side the original photo is edited at; keeps rotation responsive
// and the saved image a reasonable size.
const MAX_EDIT_SIZE = 2000;
// How close (in CSS px) a touch has to be to a crop handle to grab it
const HANDLE_REACH = 28;
// Smallest crop, as a fraction of the image's shorter side
const MIN_CROP = 0.05;

// Resolves to the image to save as a data URL: `enhanced` unchanged if the
// user skips or makes no changes, otherwise the edited image.
export async function editImage(enhanced, originalFile) {
  const dialog = document.getElementById("editor");
  const canvas = document.getElementById("editor-canvas");
  const angleInput = document.getElementById("editor-angle");
  const sourceButton = document.getElementById("editor-source");

  const originalUrl = URL.createObjectURL(originalFile);
  const sources = {
    enhanced: await loadImageCanvas(enhanced),
    original: null, // loaded on first use
  };

  const state = { source: "enhanced", quarterTurns: 0, fineAngle: 0, rotated: null, crop: null };

  const rebuild = () => {
    const angle = ((state.quarterTurns * 90 + state.fineAngle) * Math.PI) / 180;
    state.rotated = rotateCanvas(sources[state.source], angle);
    state.crop = { x: 0, y: 0, width: state.rotated.width, height: state.rotated.height };
    draw();
  };

  // Where the rotated image sits on the (device-pixel) preview canvas
  let view = { scale: 1, x: 0, y: 0 };
  const draw = () => {
    const ratio = window.devicePixelRatio || 1;
    const stage = canvas.parentElement;
    canvas.width = Math.round(stage.clientWidth * ratio);
    canvas.height = Math.round(stage.clientHeight * ratio);
    const ctx = canvas.getContext("2d");
    const { rotated, crop } = state;

    const margin = 20 * ratio;
    const scale = Math.min((canvas.width - 2 * margin) / rotated.width, (canvas.height - 2 * margin) / rotated.height);
    view = {
      scale,
      x: (canvas.width - rotated.width * scale) / 2,
      y: (canvas.height - rotated.height * scale) / 2,
    };

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(rotated, view.x, view.y, rotated.width * scale, rotated.height * scale);

    // Dim everything outside the crop box
    const box = {
      x: view.x + crop.x * scale,
      y: view.y + crop.y * scale,
      width: crop.width * scale,
      height: crop.height * scale,
    };
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.fill("evenodd");

    // Box outline, rule-of-thirds guides and corner handles - each drawn
    // white over a darker, wider line so they show on light and dark images
    const outlined = (width, path, alpha = 1) => {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width + 2 * ratio;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
      ctx.stroke(path);
      ctx.lineWidth = width;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke(path);
      ctx.globalAlpha = 1;
    };

    const guides = new Path2D();
    for (const f of [1 / 3, 2 / 3]) {
      guides.moveTo(box.x + box.width * f, box.y);
      guides.lineTo(box.x + box.width * f, box.y + box.height);
      guides.moveTo(box.x, box.y + box.height * f);
      guides.lineTo(box.x + box.width, box.y + box.height * f);
    }
    outlined(1 * ratio, guides, 0.5);

    const frame = new Path2D();
    frame.rect(box.x, box.y, box.width, box.height);
    outlined(1.5 * ratio, frame);

    const arm = Math.min(22 * ratio, box.width / 3, box.height / 3);
    const handles = new Path2D();
    for (const [cx, cy, dx, dy] of [
      [box.x, box.y, 1, 1],
      [box.x + box.width, box.y, -1, 1],
      [box.x + box.width, box.y + box.height, -1, -1],
      [box.x, box.y + box.height, 1, -1],
    ]) {
      handles.moveTo(cx + dx * arm, cy);
      handles.lineTo(cx, cy);
      handles.lineTo(cx, cy + dy * arm);
    }
    ctx.lineCap = "square";
    outlined(4 * ratio, handles);
  };

  // Dragging: which crop edges follow the pointer ("move" drags the whole box)
  let drag = null;
  const toImage = (event) => {
    const rect = canvas.getBoundingClientRect();
    const ratio = canvas.width / rect.width;
    return {
      x: ((event.clientX - rect.left) * ratio - view.x) / view.scale,
      y: ((event.clientY - rect.top) * ratio - view.y) / view.scale,
    };
  };
  const onPointerDown = (event) => {
    const p = toImage(event);
    const reach = (HANDLE_REACH * (canvas.width / canvas.getBoundingClientRect().width)) / view.scale;
    const { x, y, width, height } = state.crop;
    const near = (a, b) => Math.abs(a - b) <= reach;
    const withinX = p.x >= x - reach && p.x <= x + width + reach;
    const withinY = p.y >= y - reach && p.y <= y + height + reach;

    const edges = {
      left: withinY && near(p.x, x),
      right: withinY && near(p.x, x + width),
      top: withinX && near(p.y, y),
      bottom: withinX && near(p.y, y + height),
    };
    if (edges.left && edges.right) edges[p.x < x + width / 2 ? "right" : "left"] = false;
    if (edges.top && edges.bottom) edges[p.y < y + height / 2 ? "bottom" : "top"] = false;

    const inside = p.x > x && p.x < x + width && p.y > y && p.y < y + height;
    if (!Object.values(edges).some(Boolean) && !inside) return;

    drag = { edges, move: !Object.values(edges).some(Boolean), start: p, crop: { ...state.crop } };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event) => {
    if (!drag) return;
    const p = toImage(event);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const bounds = state.rotated;
    const min = Math.min(bounds.width, bounds.height) * MIN_CROP;
    let { x, y, width, height } = drag.crop;

    if (drag.move) {
      x = clamp(x + dx, 0, bounds.width - width);
      y = clamp(y + dy, 0, bounds.height - height);
    } else {
      let left = x;
      let top = y;
      let right = x + width;
      let bottom = y + height;
      if (drag.edges.left) left = clamp(left + dx, 0, right - min);
      if (drag.edges.right) right = clamp(right + dx, left + min, bounds.width);
      if (drag.edges.top) top = clamp(top + dy, 0, bottom - min);
      if (drag.edges.bottom) bottom = clamp(bottom + dy, top + min, bounds.height);
      [x, y, width, height] = [left, top, right - left, bottom - top];
    }
    state.crop = { x, y, width, height };
    draw();
  };
  const onPointerUp = () => {
    drag = null;
  };

  const rotateBy = (turns) => {
    state.quarterTurns = (state.quarterTurns + turns + 4) % 4;
    rebuild();
  };
  const onRotateLeft = () => rotateBy(-1);
  const onRotateRight = () => rotateBy(1);
  const onAngle = () => {
    state.fineAngle = Number(angleInput.value);
    rebuild();
  };
  const updateSourceButton = () => {
    sourceButton.querySelector("span").textContent =
      state.source === "enhanced" ? "Use original photo" : "Use enhanced image";
  };
  const onSource = async () => {
    state.source = state.source === "enhanced" ? "original" : "enhanced";
    sources.original ??= await loadImageCanvas(originalUrl, MAX_EDIT_SIZE);
    updateSourceButton();
    rebuild();
  };
  const reset = () => {
    state.source = "enhanced";
    state.quarterTurns = 0;
    state.fineAngle = 0;
    angleInput.value = 0;
    updateSourceButton();
    rebuild();
  };

  const listeners = [
    [canvas, "pointerdown", onPointerDown],
    [canvas, "pointermove", onPointerMove],
    [canvas, "pointerup", onPointerUp],
    [canvas, "pointercancel", onPointerUp],
    [document.getElementById("editor-rotate-left"), "click", onRotateLeft],
    [document.getElementById("editor-rotate-right"), "click", onRotateRight],
    [angleInput, "input", onAngle],
    [sourceButton, "click", onSource],
    [document.getElementById("editor-reset"), "click", reset],
    [window, "resize", draw],
  ];

  return new Promise((resolve) => {
    const finish = (apply) => {
      listeners.forEach(([target, type, fn]) => target.removeEventListener(type, fn));
      URL.revokeObjectURL(originalUrl);
      dialog.close();
      resolve(apply ? exportImage(state, enhanced) : enhanced);
    };
    const onDone = () => finish(true);
    const onSkip = () => finish(false);
    const onCancel = (event) => {
      // Escape: same as skipping, the card is still saved
      event.preventDefault();
      finish(false);
    };
    listeners.push(
      [document.getElementById("editor-done"), "click", onDone],
      [document.getElementById("editor-skip"), "click", onSkip],
      [dialog, "cancel", onCancel]
    );
    listeners.forEach(([target, type, fn]) => target.addEventListener(type, fn));

    dialog.showModal();
    reset(); // draws once the dialog has a size
  });
}

// The cropped, rotated result, or the untouched enhanced image if nothing changed
function exportImage(state, enhanced) {
  const { rotated, crop, source, quarterTurns, fineAngle } = state;
  const unchanged =
    source === "enhanced" &&
    quarterTurns === 0 &&
    fineAngle === 0 &&
    crop.x === 0 &&
    crop.y === 0 &&
    crop.width === rotated.width &&
    crop.height === rotated.height;
  if (unchanged) return enhanced;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  canvas
    .getContext("2d")
    .drawImage(rotated, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);

  // The enhanced image is a crisp black & white code: keep it lossless. A
  // full photo is far smaller as JPEG, with no visible difference.
  return source === "enhanced" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.92);
}

// Draws `source` rotated by `angle` (radians) onto a canvas just big enough
// to hold it; the corners uncovered by the rotation are filled white, which
// also serves as a quiet zone around the code.
function rotateCanvas(source, angle) {
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * cos + source.height * sin);
  canvas.height = Math.round(source.width * sin + source.height * cos);

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(angle);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

// Loads an image URL into a canvas, scaled down to at most `maxSize` px
async function loadImageCanvas(src, maxSize = Infinity) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
