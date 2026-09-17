// backup.js — export/import all app data (profiles + holiday pause) as a
// single JSON file, plus a full reset. Kept separate from storage.js since
// this is file I/O / user-facing tooling, not core data access.

function initBackupTools() {
  const exportBtn = document.getElementById('export-backup-btn');
  const importBtn = document.getElementById('import-backup-btn');
  const importInput = document.getElementById('import-backup-input');
  const resetBtn = document.getElementById('reset-all-btn');

  exportBtn.addEventListener('click', exportBackup);

  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importBackup(file);
    importInput.value = ''; // allow re-selecting the same file later
  });

  resetBtn.addEventListener('click', () => {
    if (!confirm('This will permanently delete ALL bells, profiles, and settings on this device. Continue?')) return;
    removeData('profiles');
    removeData('activeProfileId');
    removeData('holidayPause');
    removeData('bells'); // clears any legacy key too
    location.reload();
  });
}

/**
 * Downloads all app data as a single JSON file.
 */
function exportBackup() {
  const payload = {
    app: 'DhammaBellScheduler',
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: getProfiles(),
    activeProfileId: getActiveProfileId(),
    holidayPause: loadData('holidayPause', null),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dhammabell-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Restores app data from a previously exported JSON file, after confirming
 * with the user since this replaces everything currently on the device.
 */
function importBackup(file) {
  const reader = new FileReader();

  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch {
      return alert('That file is not valid JSON.');
    }

    if (!Array.isArray(data.profiles)) {
      return alert("That file doesn't look like a DhammaBellScheduler backup.");
    }

    if (!confirm('This will replace all current bells, profiles, and settings with the backup file. Continue?')) return;

    saveProfiles(data.profiles);
    setActiveProfileId(data.activeProfileId || data.profiles[0]?.id || null);
    if (data.holidayPause) saveData('holidayPause', data.holidayPause);
    else removeData('holidayPause');

    location.reload();
  };

  reader.readAsText(file);
}