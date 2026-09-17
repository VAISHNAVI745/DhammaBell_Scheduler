// storage.js — all localStorage access lives here, nowhere else.
// Bells now live inside "profiles" (e.g. Weekday, Weekend) instead of one
// flat list, so only the active profile's bells are ever returned by getBells().

const STORAGE_PREFIX = 'dhammaBell_';

function saveData(key, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('storage.js: failed to save', key, err);
    return false;
  }
}

function loadData(key, defaultValue = null) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw === null ? defaultValue : JSON.parse(raw);
  } catch (err) {
    console.error('storage.js: failed to load', key, err);
    return defaultValue;
  }
}

function removeData(key) {
  localStorage.removeItem(STORAGE_PREFIX + key);
}

/* ===== Profiles ===== */

function getProfiles() {
  return loadData('profiles', []);
}

function saveProfiles(profiles) {
  saveData('profiles', profiles);
}

function getActiveProfileId() {
  return loadData('activeProfileId', null);
}

function setActiveProfileId(id) {
  saveData('activeProfileId', id);
}

/**
 * One-time migration: if this device still has bells stored the old flat
 * way (from before Profiles existed), wrap them in a "Default" profile so
 * nothing is lost. Safe to call repeatedly — it no-ops once profiles exist.
 */
function migrateLegacyBellsIfNeeded() {
  if (getProfiles().length > 0) return;

  const legacyBells = loadData('bells', []);
  const defaultProfile = { id: 'default', name: 'Default', bells: legacyBells };
  saveProfiles([defaultProfile]);
  setActiveProfileId('default');
  removeData('bells');
}

function getActiveProfile() {
  migrateLegacyBellsIfNeeded();
  const profiles = getProfiles();
  const active = profiles.find(p => p.id === getActiveProfileId());
  return active || profiles[0] || null;
}

function addProfile(name) {
  const profiles = getProfiles();
  const profile = { id: Date.now().toString(), name, bells: [] };
  profiles.push(profile);
  saveProfiles(profiles);
  return profile;
}

function renameProfile(id, newName) {
  saveProfiles(getProfiles().map(p => (p.id === id ? { ...p, name: newName } : p)));
}

function deleteProfile(id) {
  let profiles = getProfiles().filter(p => p.id !== id);
  if (profiles.length === 0) {
    profiles = [{ id: 'default', name: 'Default', bells: [] }];
  }
  saveProfiles(profiles);
  if (getActiveProfileId() === id) setActiveProfileId(profiles[0].id);
}

/* ===== Bell helpers — operate on the ACTIVE profile's bells ===== */

function getBells() {
  const profile = getActiveProfile();
  return profile ? profile.bells : [];
}

function saveBells(bells) {
  const activeId = getActiveProfileId();
  saveProfiles(getProfiles().map(p => (p.id === activeId ? { ...p, bells } : p)));
}

function addBell(bell) {
  const bells = getBells();
  bells.push(bell);
  saveBells(bells);
}

function updateBell(id, updates) {
  saveBells(getBells().map(b => (b.id === id ? { ...b, ...updates } : b)));
}

function deleteBell(id) {
  saveBells(getBells().filter(b => b.id !== id));
}