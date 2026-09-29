import "https://cdn.jsdelivr.net/npm/beercss@3.7.12/dist/cdn/beer.min.js";
import "https://cdn.jsdelivr.net/npm/material-dynamic-colors@1.1.2/dist/cdn/material-dynamic-colors.min.js";
import "./long-press-event.js";

document.addEventListener("DOMContentLoaded", async () => {
  await ui("theme", "#2fff00");

  loadImages();

  const inputElement = document.getElementById("upload");
  const resetBtn = document.getElementById("reset");
  const exportBtn = document.getElementById("export");
  const importBtn = document.getElementById("import");

  resetBtn.addEventListener("click", async (event) => {
    if (confirm("🗑️💯🤔\nDelete all data?") == true) {
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
      const base64String = await convertToBase64(file);

      new Worker("worker.js").postMessage([base64String, timestamp]);
      await new Promise((res) => setTimeout(res, 1000));

      loadImages();
    }
  });
});

async function readFile(timestamp) {
  const root = await navigator.storage.getDirectory();
  const existingFileHandle = await root.getFileHandle(timestamp);
  return await existingFileHandle.getFile();
}

async function convertToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
}

async function getFileNames() {
  let keys = [];

  const root = await navigator.storage.getDirectory();
  for await (let key of root.keys()) {
    keys.push(key);
  }

  return keys;
}

async function loadImages() {
  document.getElementById("list").replaceChildren();

  const list = document.getElementById("list");
  const files = await getFileNames();

  files.forEach(async (file) => {
    let img = document.createElement("img");
    let url = await readFile(file);

    img.src = await url.text();
    img.style.display = "block";
    img.style.width = "100%";
    img.addEventListener("long-press", async () => {
      if (confirm("👉🗑️🤔\nDelete this item?") == true) {
        let root = await navigator.storage.getDirectory();
        await root.removeEntry(file);
        loadImages();
      }
    });
    list.appendChild(img);

    // add a divider
    let hr = document.createElement("hr");
    hr.classList.add("small");
    list.appendChild(hr);
  });
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
