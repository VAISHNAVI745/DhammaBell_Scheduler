// audioStore.js — stores uploaded custom bell sounds as Blobs in IndexedDB,
// which has a MUCH larger storage quota than localStorage (typically tens
// of MB up to several GB, vs localStorage's ~5-10MB total). localStorage
// (via storage.js) only ever holds a small customSoundId string per bell —
// never the actual audio bytes.

const AUDIO_DB_NAME = 'dhammaBellAudioDB';
const AUDIO_DB_VERSION = 1;
const AUDIO_STORE_NAME = 'sounds';

function openAudioDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUDIO_DB_NAME, AUDIO_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE_NAME)) {
        db.createObjectStore(AUDIO_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Stores a Blob under the given id, overwriting any existing entry with
 * the same id.
 */
async function saveCustomSound(id, blob) {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, 'readwrite');
    tx.objectStore(AUDIO_STORE_NAME).put(blob, id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieves a Blob by id. Resolves to null if not found.
 */
async function getCustomSound(id) {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, 'readonly');
    const req = tx.objectStore(AUDIO_STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Deletes one custom sound by id. Safe to call even if it doesn't exist.
 */
async function deleteCustomSound(id) {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, 'readwrite');
    tx.objectStore(AUDIO_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Wipes every stored custom sound. Used by "Reset All Data".
 */
async function clearAllCustomSounds() {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, 'readwrite');
    tx.objectStore(AUDIO_STORE_NAME).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Converts a Blob to a base64 data URI. Used only by Export Backup, so a
 * custom sound can travel inside the portable JSON backup file.
 */
function blobToDataURI(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Converts a base64 data URI back to a Blob. Used only by Import Backup.
 */
async function dataURIToBlob(dataURI) {
  const res = await fetch(dataURI);
  return res.blob();
}