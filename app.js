import "./assets/vendor/beercss/beer.min.js";
import "./assets/vendor/material-dynamic-colors/material-dynamic-colors.min.js";
import "./assets/vendor/long-press-event/long-press-event.js";
import { processCardImage } from "./card-scan.js";
import { editImage } from "./image-editor.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });

  // Reload once a new service worker takes over so its fresh assets are used
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await ui("theme", "#2fff00");

  enforcePortraitOnPhones();

  offerInstall();

  hideSplashWhenReady(loadImages());

  const inputElement = document.getElementById("upload");
  const resetBtn = document.getElementById("reset");
  const exportBtn = document.getElementById("export");
  const importBtn = document.getElementById("import");

  resetBtn.addEventListener("click", async (event) => {
    const confirmed = await confirmAction(
      "Delete all cards?",
      "All saved cards will be permanently removed from this device. This cannot be undone.",
      "Delete all"
    );
    if (confirmed) {
      // Collect the names first: deleting while iterating can skip entries
      const root = await navigator.storage.getDirectory();
      for (const name of await getFileNames()) {
        await root.removeEntry(name);
      }
      document.getElementById("list").replaceChildren();
    }
  });

  exportBtn.addEventListener("click", async (event) => {
    exportFilesAsJson();
  });

  importBtn.addEventListener("click", async (event) => {
    document.getElementById("file-input").click();
  });

  document.getElementById("file-input").addEventListener("change", async function () {
    if (this.files && this.files[0]) {
      await importFilesFromJson(this.files[0]);
      this.value = "";
    }
  });

  document.getElementById("licenses").addEventListener("click", () => {
    document.getElementById("licenses-dialog").showModal();
  });

  inputElement.addEventListener("change", async function () {
    if (this.files && this.files[0]) {
      const file = this.files[0];
      const timestamp = Date.now();
      // Find and crop the code while the user fills in the card details
      const processing = processCardImage(file);
      this.value = "";

      const details = await askCardDetails();
      if (!details) return;
      const base64String = await editImage(await processing, file);
      const card = JSON.stringify({ ...details, image: base64String });

      await writeCardFile(timestamp, card);
      loadImages();
    }
  });
});

// Shows the new card dialog; resolves to { title, color }, or null if cancelled.
function askCardDetails() {
  const dialog = document.getElementById("card-dialog");
  const titleInput = document.getElementById("card-title");
  const colorInput = document.getElementById("card-color");
  titleInput.value = "";
  colorInput.value = "#ffffff";

  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        if (dialog.returnValue !== "save") return resolve(null);
        resolve({ title: titleInput.value.trim(), color: colorInput.value });
      },
      { once: true }
    );
    dialog.returnValue = "";
    dialog.showModal();
    titleInput.focus();
  });
}

// Swallows the click (if any) produced by lifting the finger after a long press,
// so it neither opens the viewer nor hits a button in the dialog that just
// opened underneath it. Deliberately not done via the long-press event's
// preventDefault(): that arms a "cancel the next click" listener which iOS
// never uses up (it fires no click after a long press), so it would eat the
// first real tap on the dialog instead.
function suppressReleaseClick() {
  const swallow = (event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  const releaseEvents = ["pointerup", "pointercancel", "touchend", "touchcancel", "mouseup"];
  const onRelease = () => {
    releaseEvents.forEach((type) => document.removeEventListener(type, onRelease, true));
    setTimeout(() => document.removeEventListener("click", swallow, true), 350);
  };

  document.addEventListener("click", swallow, true);
  releaseEvents.forEach((type) => document.addEventListener(type, onRelease, true));
}

// Asks to confirm a destructive action; resolves to true if confirmed.
function confirmAction(title, message, actionLabel) {
  const dialog = document.getElementById("confirm-dialog");
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-message").textContent = message;
  document.getElementById("confirm-action").textContent = actionLabel;

  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), {
      once: true,
    });
    dialog.returnValue = "";
    dialog.showModal();
  });
}

// Shows the image alone on a full screen white background (the brightest the
// page can get; browsers don't allow changing the display brightness itself)
// and keeps the screen from dimming while it's open. Tap anywhere to close.
async function showViewer(image) {
  const dialog = document.getElementById("viewer");
  document.getElementById("viewer-image").src = image;

  let wakeLock = null;
  dialog.addEventListener("click", () => dialog.close(), { once: true });
  dialog.addEventListener(
    "close",
    () => {
      wakeLock?.release();
      wakeLock = null;
      if (document.fullscreenElement) document.exitFullscreen();
    },
    { once: true }
  );
  dialog.showModal();

  try {
    await document.documentElement.requestFullscreen?.();
    if (!dialog.open && document.fullscreenElement) document.exitFullscreen();
  } catch {
    // Not supported or not allowed; the viewer still works without it.
  }
  try {
    const lock = await navigator.wakeLock?.request("screen");
    // The viewer may have been closed while the lock was being requested
    if (dialog.open) wakeLock = lock;
    else lock?.release();
  } catch {
    // Same as above.
  }
}

// Black or white, whichever reads better on the given #rrggbb background.
function textColorFor(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#000000" : "#ffffff";
}

// Phones get portrait mode only. Installed on Android the manifest already
// locks it, but iOS ignores that and browsers don't let pages lock rotation,
// so while a phone is held in landscape a notice covers the app. It's a
// modal dialog so it also covers other open dialogs (viewer, editor).
// Orientation comes from the screen rather than the viewport: on Android the
// on-screen keyboard shrinks the viewport, which would look like landscape.
function enforcePortraitOnPhones() {
  const notice = document.getElementById("rotate-notice");

  const update = () => {
    const phone =
      window.matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 600;
    const type =
      screen.orientation?.type ?? (Math.abs(window.orientation) === 90 ? "landscape" : "portrait");
    const landscape = phone && type.startsWith("landscape");

    if (landscape && !notice.open) notice.showModal();
    else if (!landscape && notice.open) notice.close();
  };

  notice.addEventListener("cancel", (event) => event.preventDefault()); // Escape can't dismiss it
  screen.orientation?.addEventListener("change", update);
  window.addEventListener("orientationchange", update);
  update();
}

// Caught at module load: it can fire before the page setup reaches
// offerInstall(), which picks it up from here.
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); // show our banner instead of the browser's mini-infobar
  installPrompt = event;
  window.dispatchEvent(new Event("install-available"));
});

// Suggests installing the app while it runs in a browser tab. Chrome/Edge
// (Android and desktop) fire "beforeinstallprompt", which is kept so the
// banner's Install button can show the browser's own install dialog. iOS has
// no such API, so there the banner explains Share > Add to Home Screen instead
// (not in in-app browsers like Instagram's, which can't add to the home screen:
// their user agent has no "Safari/" token). Dismissing it is remembered.
const INSTALL_DISMISSED_KEY = "install-banner-dismissed";

function offerInstall() {
  const banner = document.getElementById("install-banner");
  const text = document.getElementById("install-text");
  const installButton = document.getElementById("install-button");

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    // Storage blocked (e.g. private mode): just show the banner again next time
  }
  if (standalone || dismissed) return;

  const hide = () => (banner.hidden = true);

  document.getElementById("install-close").addEventListener("click", () => {
    hide();
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
      // See above
    }
  });

  const ios =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS reports as a Mac
  if (ios) {
    if (!/Safari\//.test(navigator.userAgent)) return;
    text.innerHTML =
      'Tap <i>ios_share</i> Share (in the <b>•••</b> menu on newer iPhones), then <b>Add to Home Screen</b>.';
    banner.hidden = false;
    return;
  }

  const offerPrompt = () => {
    text.textContent = "Open your cards straight from the home screen, even offline.";
    installButton.hidden = false;
    banner.hidden = false;
  };
  if (installPrompt) offerPrompt();
  window.addEventListener("install-available", offerPrompt);

  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null; // a prompt can only be shown once
    prompt.prompt();
    await prompt.userChoice;
    hide(); // installed, or declined for now: the browser offers again later
  });

  window.addEventListener("appinstalled", hide);
}

// Fades out the loading screen once the styles, icon font and cards are
// ready - or after a few seconds at most, so a slow part never blocks the app.
function hideSplashWhenReady(cardsLoaded) {
  const splash = document.getElementById("splash");
  if (!splash) return;

  const cssLoaded = new Promise((resolve) => {
    if (window.cssLoaded) resolve();
    else window.addEventListener("css-loaded", resolve, { once: true });
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, 4000));

  Promise.race([Promise.all([cssLoaded, cardsLoaded, document.fonts.ready]), timeout])
    .catch(() => {})
    .finally(() => {
      splash.classList.add("hidden");
      setTimeout(() => splash.remove(), 400);
    });
}

async function readFile(timestamp) {
  const root = await navigator.storage.getDirectory();
  const existingFileHandle = await root.getFileHandle(timestamp);
  return await existingFileHandle.getFile();
}

async function getFileNames() {
  let keys = [];

  const root = await navigator.storage.getDirectory();
  for await (let key of root.keys()) {
    keys.push(key);
  }

  return keys;
}

// Cards are stored as JSON { title, color, image }; older entries are a bare image data URL.
function parseCard(content) {
  if (content.startsWith("data:")) return { title: "", image: content };
  return JSON.parse(content);
}

async function loadImages() {
  document.getElementById("list").replaceChildren();

  const list = document.getElementById("list");
  const files = (await getFileNames()).sort();

  for (const file of files) {
    const { title, color, image } = parseCard(await (await readFile(file)).text());

    let card = document.createElement("article");
    card.classList.add("card");
    if (color) {
      card.style.backgroundColor = color;
      card.style.color = textColorFor(color);
    }

    let img = document.createElement("img");
    img.src = image;
    img.classList.add("card-image");
    img.draggable = false;
    card.appendChild(img);

    if (title) {
      let heading = document.createElement("h6");
      heading.classList.add("card-title");
      heading.textContent = title;
      card.appendChild(heading);
    }

    card.addEventListener("click", () => showViewer(image));
    card.addEventListener("long-press", async () => {
      suppressReleaseClick();
      const confirmed = await confirmAction(
        "Delete card?",
        title
          ? `"${title}" will be permanently removed. This cannot be undone.`
          : "This card will be permanently removed. This cannot be undone.",
        "Delete"
      );
      if (confirmed) {
        let root = await navigator.storage.getDirectory();
        await root.removeEntry(file);
        loadImages();
      }
    });
    list.appendChild(card);
  }
}

// Saves one card file via the worker; resolves once it's really written.
function writeCardFile(name, content) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("worker.js");
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data?.error) reject(new Error(event.data.error));
      else resolve();
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage([content, String(name)]);
  });
}

function showMessage(text) {
  document.getElementById("snackbar-text").textContent = text;
  ui("#snackbar", 4000);
}

// Backup file format (version 2). Cards keep their ids (creation
// timestamps), so the order survives a restore and importing the same
// backup twice doesn't duplicate cards. Version 1 backups were a plain JSON
// array of the raw card file contents and can still be imported.
const BACKUP_FORMAT = "card-manager-backup";

async function exportFilesAsJson() {
  const names = (await getFileNames()).sort();
  if (names.length === 0) {
    showMessage("There are no cards to export yet");
    return;
  }

  const cards = [];
  for (const name of names) {
    cards.push({ id: name, ...parseCard(await (await readFile(name)).text()) });
  }
  const backup = { format: BACKUP_FORMAT, version: 2, exportedAt: new Date().toISOString(), cards };

  const date = new Date().toISOString().slice(0, 10);
  const file = new File([JSON.stringify(backup)], `card-manager-backup-${date}.json`, {
    type: "application/json",
  });

  // On phones, offer the share sheet ("Save to Files", AirDrop, mail, ...):
  // plain downloads are unreliable there, especially in an installed app.
  const touch = window.matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Card Manager backup" });
      return;
    } catch (err) {
      if (err.name === "AbortError") return; // user closed the share sheet
      // Otherwise fall back to a normal download below
    }
  }

  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking right away can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  showMessage(`Exported ${cards.length} ${cards.length === 1 ? "card" : "cards"}`);
}

// A valid card is { title?, color?, image } with an image data URL
function isValidCard(card) {
  return (
    card &&
    typeof card.image === "string" &&
    card.image.startsWith("data:image/") &&
    (card.title === undefined || typeof card.title === "string") &&
    (card.color === undefined || /^#[0-9a-f]{6}$/i.test(card.color))
  );
}

// Reads a backup file into [{ id?, card }], or throws if it isn't one
function readBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a Card Manager backup");
  }

  let entries;
  if (Array.isArray(data)) {
    // Version 1: raw card file contents (card JSON or a bare image data URL)
    entries = data.map((content) => {
      try {
        return { card: typeof content === "string" ? parseCard(content) : content };
      } catch {
        return { card: null };
      }
    });
  } else if (data?.format === BACKUP_FORMAT && Array.isArray(data.cards)) {
    entries = data.cards.map(({ id, title, color, image }) => ({
      id: /^\d+$/.test(String(id)) ? String(id) : undefined,
      card: { title, color, image },
    }));
  } else {
    throw new Error("This file isn't a Card Manager backup");
  }
  return entries;
}

async function importFilesFromJson(jsonFile) {
  let entries;
  try {
    entries = readBackup(await jsonFile.text());
  } catch (err) {
    showMessage(err.message);
    return;
  }

  // Skip cards that are already on this device (same id or same content)
  const normalize = (card) => JSON.stringify({ title: card.title ?? "", color: card.color, image: card.image });
  const existing = new Map();
  for (const name of await getFileNames()) {
    try {
      existing.set(name, normalize(parseCard(await (await readFile(name)).text())));
    } catch {
      existing.set(name, null); // unreadable file: keep its id reserved
    }
  }
  const existingContents = new Set(existing.values());

  let imported = 0;
  let skipped = 0;
  let invalid = 0;
  const base = Date.now();
  for (const [index, { id, card }] of entries.entries()) {
    if (!isValidCard(card)) {
      invalid++;
      continue;
    }
    const content = normalize(card);
    if (existingContents.has(content) || (id && existing.has(id))) {
      skipped++;
      continue;
    }
    // Old backups have no ids: number them in order so the order is kept
    const name = id ?? String(base + index);
    await writeCardFile(name, content);
    existing.set(name, content);
    existingContents.add(content);
    imported++;
  }

  await loadImages();

  const parts = [`Imported ${imported} ${imported === 1 ? "card" : "cards"}`];
  if (skipped) parts.push(`${skipped} already existed`);
  if (invalid) parts.push(`${invalid} couldn't be read`);
  showMessage(parts.join(", "));
}
