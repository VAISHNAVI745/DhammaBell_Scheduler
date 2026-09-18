// backup.js — export/import all app data (profiles + pause state + every
// referenced custom bell sound) as a single JSON file, plus a full reset.
//
// Custom sound AUDIO BYTES live in IndexedDB (audioStore.js), not
// localStorage, so they're explicitly gathered as base64 into the export
// file, and written back into IndexedDB on import.

function initBackupTools() {
  const exportBtn = document.getElementById('export-backup-btn');
  const importBtn = document.getElementById('import-backup-btn');
  const importInput = document.getElementById('import-backup-input');
  const resetBtn = document.getElementById('reset-all-btn');

  exportBtn.addEventListener('click', () => {
    exportBackup().catch(err => {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    });
  });

  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) {
      importBackup(file).catch(err => {
        console.error('Import failed:', err);
        alert('Import failed. The file may be corrupted or not a valid backup.');
      });
    }
    importInput.value = ''; // allow re-selecting the same file later
  });

  resetBtn.addEventListener('click', async () => {
    if (!confirm('This will permanently delete ALL bells, profiles, settings, and custom sounds on this device. Continue?')) return;
    removeData('profiles');
    removeData('activeProfileId');
    removeData('bellsPaused');
    removeData('bells'); // clears any legacy key too
    try {
      await clearAllCustomSounds();
    } catch (err) {
      console.warn('Failed to clear custom sounds during reset:', err);
    }
    location.reload();
  });
}

/**
 * Collects every distinct customSoundId referenced anywhere across all
 * profiles (both 'daily' bells and every day of every 'range' profile).
 */
function collectCustomSoundIds(profiles) {
  const ids = new Set();
  profiles.forEach(p => {
    (p.bells || []).forEach(b => { if (b.customSoundId) ids.add(b.customSoundId); });
    Object.values(p.dayBells || {}).forEach(dayBells => {
      dayBells.forEach(b => { if (b.customSoundId) ids.add(b.customSoundId); });
    });
  });
  return [...ids];
}

/**
 * Downloads all app data — profiles, pause state, and every referenced
 * custom sound (converted to base64 so the JSON file stays self-contained
 * and portable) — as a single JSON file.
 */
async function exportBackup() {
  const profiles = getProfiles();
  const soundIds = collectCustomSoundIds(profiles);

  const customSounds = {};
  for (const id of soundIds) {
    try {
      const blob = await getCustomSound(id);
      if (blob) customSounds[id] = await blobToDataURI(blob);
    } catch (err) {
      console.warn('Skipping unreadable custom sound in export:', id, err);
    }
  }

  const payload = {
    app: 'DhammaBellScheduler',
    version: 4,
    exportedAt: new Date().toISOString(),
    profiles,
    activeProfileId: getActiveProfileId(),
    bellsPaused: loadData('bellsPaused', false),
    customSounds,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dhammabell-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Restores app data from a previously exported JSON file: writes any
 * custom sounds back into IndexedDB first, then restores profiles/settings,
 * after confirming with the user since this replaces everything on the device.
 */
async function importBackup(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    alert('That file is not valid JSON.');
    return;
  }

  if (!Array.isArray(data.profiles)) {
    alert("That file doesn't look like a DhammaBellScheduler backup.");
    return;
  }

  if (!confirm('This will replace all current bells, profiles, settings, and custom sounds with the backup file. Continue?')) return;

  const customSounds = data.customSounds || {};
  for (const [id, dataURI] of Object.entries(customSounds)) {
    try {
      const blob = await dataURIToBlob(dataURI);
      await saveCustomSound(id, blob);
    } catch (err) {
      console.warn('Skipping unrestorable custom sound on import:', id, err);
    }
  }

  saveProfiles(data.profiles);
  setActiveProfileId(data.activeProfileId || data.profiles[0]?.id || null);
  saveData('bellsPaused', !!data.bellsPaused);

  location.reload();
}