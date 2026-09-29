import "./vendor/beercss/beer.min.js";
import "./vendor/material-dynamic-colors/material-dynamic-colors.min.js";
import "./long-press-event.js";
import { processCardImage } from "./card-scan.js";

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

  loadImages();

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
      let root = await navigator.storage.getDirectory();
      for await (const key of root.keys()) {
        await root.removeEntry(key);
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

  inputElement.addEventListener("change", async function () {
    if (this.files && this.files[0]) {
      const file = this.files[0];
      const timestamp = Date.now();
      const base64String = await processCardImage(file);
      this.value = "";

      const details = await askCardDetails();
      if (!details) return;
      const card = JSON.stringify({ ...details, image: base64String });

      new Worker("worker.js").postMessage([card, timestamp]);
      await new Promise((res) => setTimeout(res, 1000));

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

async function exportFilesAsJson() {
  const root = await navigator.storage.getDirectory();
  const files = await getFileNames();

  const fileData = [];

  for (const file of files) {
    const fileHandle = await root.getFileHandle(file);
    const fileObject = await fileHandle.getFile();

    const fileContent = await fileObject.text();

    fileData.push(fileContent);
  }

  const jsonData = JSON.stringify(fileData);
  const blob = new Blob([jsonData], {type: "application/json"});

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "opfs_files.json";
  a.click();

  URL.revokeObjectURL(url);
}

async function importFilesFromJson(jsonFile) {
  const jsonData = await jsonFile.text();
  const fileData = JSON.parse(jsonData);

  for (const file of fileData) {
    new Worker("worker.js").postMessage([file, Date.now()]);
    await new Promise((res) => setTimeout(res, 1000));
  }

  loadImages();
}
