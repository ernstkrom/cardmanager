// Writes one card file to the origin private file system. Runs in a worker
// because Safari only supports writing OPFS files through the synchronous
// access handle, which is only available in workers.
// Message: [content, fileName]; replies { ok: true } or { error }.
onmessage = async (e) => {
  const [content, fileName] = e.data;

  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(String(fileName), { create: true });
    const accessHandle = await fileHandle.createSyncAccessHandle();
    try {
      // Replace any previous content rather than appending to it
      accessHandle.truncate(0);
      accessHandle.write(new TextEncoder().encode(content), { at: 0 });
      accessHandle.flush();
    } finally {
      // Always close FileSystemSyncAccessHandle if done.
      accessHandle.close();
    }
    postMessage({ ok: true });
  } catch (err) {
    postMessage({ error: String(err) });
  }
};
