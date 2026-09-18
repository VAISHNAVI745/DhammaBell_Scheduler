// storage.js — all localStorage access lives here, nowhere else.
//
// Profile shape:
//   'daily' — one flat bell list, rings every day (profile.bells)
//   'range' — a template of N relative days (profile.dayBells: {0: [...], 1: [...], ...}),
//             mapped onto real dates starting from profile.rangeStart.
//
// Every read of profiles goes through normalizeProfile(), which is defensive: if a
// saved profile is missing fields, has the wrong types, or is otherwise malformed
// (e.g. leftover data from an earlier version of this app), it is repaired into a
// safe, valid shape instead of throwing — so a bad profile can never crash the app
// or block anything else (like the clock) from rendering.

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

/* ===== Date helpers =====
   Work entirely in LOCAL date components (never toISOString(), which
   converts to UTC first and shifts dates back a day for timezones ahead
   of UTC, e.g. IST). */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatLocalDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayStr() {
  return formatLocalDate(new Date());
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return formatLocalDate(d);
}

function daysBetween(fromDateStr, toDateStr) {
  const ms = new Date(toDateStr + 'T00:00:00') - new Date(fromDateStr + 'T00:00:00');
  return Math.round(ms / 86400000);
}

/* ===== Profiles ===== */

function blankProfile(id, name) {
  return {
    id: String(id),
    name: name || 'Untitled',
    scheduleType: 'daily',
    bells: [],
    numDays: null,
    rangeStart: null,
    dayBells: {},
  };
}

/**
 * Repairs a profile object into a guaranteed-valid shape, no matter what
 * was actually in storage. Never throws — any unexpected shape just falls
 * back to safe defaults for the affected fields only, so partial data
 * (e.g. valid bells but a corrupted dayBells object) is preserved as much
 * as possible rather than wiping the whole profile.
 */
function normalizeProfile(raw) {
  try {
    if (!raw || typeof raw !== 'object') {
      return blankProfile(Date.now().toString() + Math.random().toString(36).slice(2), 'Default');
    }

    const id = raw.id != null ? String(raw.id) : Date.now().toString();
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Untitled';
    const scheduleType = raw.scheduleType === 'range' ? 'range' : 'daily';
    const bells = Array.isArray(raw.bells) ? raw.bells : [];

    let numDays = Number.isInteger(raw.numDays) && raw.numDays > 0 ? raw.numDays : null;
    let rangeStart = typeof raw.rangeStart === 'string' && raw.rangeStart ? raw.rangeStart : null;

    let dayBells = {};
    if (raw.dayBells && typeof raw.dayBells === 'object' && !Array.isArray(raw.dayBells)) {
      Object.entries(raw.dayBells).forEach(([k, v]) => {
        if (Array.isArray(v)) dayBells[k] = v;
      });
    } else if (raw.dailyBells && typeof raw.dailyBells === 'object' && rangeStart) {
      // Old shape from an earlier version: dailyBells keyed by "YYYY-MM-DD" + rangeEnd.
      const end = typeof raw.rangeEnd === 'string' && raw.rangeEnd ? raw.rangeEnd : rangeStart;
      const computedDays = Math.max(1, daysBetween(rangeStart, end) + 1);
      numDays = numDays || computedDays;
      for (let i = 0; i < numDays; i++) {
        const dateKey = addDays(rangeStart, i);
        dayBells[i] = Array.isArray(raw.dailyBells[dateKey]) ? raw.dailyBells[dateKey] : [];
      }
    }

    // If range mode but numDays is set and dayBells is missing entries, fill gaps with [].
    if (scheduleType === 'range' && numDays) {
      for (let i = 0; i < numDays; i++) {
        if (!Array.isArray(dayBells[i])) dayBells[i] = [];
      }
    }

    return { id, name, scheduleType, bells, numDays, rangeStart, dayBells };
  } catch (err) {
    console.error('storage.js: failed to normalize a profile, resetting it', err);
    return blankProfile(Date.now().toString() + Math.random().toString(36).slice(2), 'Default');
  }
}

/**
 * Returns every saved profile, each guaranteed valid. Never throws. If the
 * raw stored value isn't even an array (corrupted), returns [] rather than
 * crashing — migrateLegacyBellsIfNeeded() will then create a fresh Default.
 */
function getProfiles() {
  let raw;
  try {
    raw = loadData('profiles', []);
  } catch (err) {
    console.error('storage.js: failed to read profiles, starting fresh', err);
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const normalized = raw.map(normalizeProfile);
  saveData('profiles', normalized); // persist the repair so this only has to run once
  return normalized;
}

function saveProfiles(profiles) {
  return saveData('profiles', profiles);
}

function getActiveProfileId() {
  return loadData('activeProfileId', null);
}

function setActiveProfileId(id) {
  saveData('activeProfileId', id);
}

/**
 * One-time migration: if this device has no profiles at all yet, create a
 * "Default" one — carrying over any very old flat bell list if present.
 * Safe to call repeatedly — no-ops once at least one profile exists.
 */
function migrateLegacyBellsIfNeeded() {
  if (getProfiles().length > 0) return;
  const legacyBells = loadData('bells', []);
  const defaultProfile = { ...blankProfile('default', 'Default'), bells: Array.isArray(legacyBells) ? legacyBells : [] };
  saveProfiles([defaultProfile]);
  setActiveProfileId('default');
  removeData('bells');
}

/**
 * Returns the active profile, guaranteed to be valid and to exist in the
 * profiles list. Falls back to the first profile (and corrects the stored
 * activeProfileId) if the stored ID points at nothing — guards against a
 * stale ID left over from a deleted/renamed profile.
 */
function getActiveProfile() {
  migrateLegacyBellsIfNeeded();
  const profiles = getProfiles();
  if (profiles.length === 0) return null;

  let active = profiles.find(p => p.id === getActiveProfileId());
  if (!active) {
    active = profiles[0];
    setActiveProfileId(active.id);
  }
  return active;
}

function addProfile(name) {
  const profiles = getProfiles();
  const profile = blankProfile(Date.now().toString(), name);
  profiles.push(profile);
  saveProfiles(profiles);
  return profile;
}

function renameProfile(id, newName) {
  saveProfiles(getProfiles().map(p => (p.id === id ? { ...p, name: newName } : p)));
}

function deleteProfile(id) {
  let profiles = getProfiles().filter(p => p.id !== id);
  if (profiles.length === 0) profiles = [blankProfile('default', 'Default')];
  saveProfiles(profiles);
  if (getActiveProfileId() === id) setActiveProfileId(profiles[0].id);
}

/**
 * Switches the active profile between 'daily' and 'range'. Existing bell
 * data for either mode is preserved so switching back and forth never
 * loses anything.
 */
function setScheduleType(type) {
  const activeId = getActiveProfileId();
  saveProfiles(getProfiles().map(p => (p.id === activeId ? { ...p, scheduleType: type } : p)));
}

/**
 * Sets the active profile's day-count and start date. Existing dayBells
 * (keyed by offset, e.g. "3") are preserved untouched — this is what lets
 * the same template be re-applied to a new start date. Any new day slots
 * introduced by increasing numDays are created empty.
 */
function setProfileRangeConfig(numDays, startDate) {
  const activeId = getActiveProfileId();
  saveProfiles(getProfiles().map(p => {
    if (p.id !== activeId) return p;
    const dayBells = { ...(p.dayBells || {}) };
    for (let i = 0; i < numDays; i++) {
      if (!Array.isArray(dayBells[i])) dayBells[i] = [];
    }
    return { ...p, numDays, rangeStart: startDate, dayBells };
  }));
}

/* ===== Editing context (which day offset the Bell Schedule UI is editing) =====
   In-memory only — resets on reload, which recalculates a sensible default. */

let currentEditDayIndex = 0;

function setEditDayIndex(index) {
  currentEditDayIndex = index;
}

function getEditDayIndex() {
  return currentEditDayIndex || 0;
}

/* ===== Bell helpers — operate on the day offset CURRENTLY BEING EDITED ===== */

function getBells() {
  const profile = getActiveProfile();
  if (!profile) return [];
  if ((profile.scheduleType || 'daily') === 'daily') return profile.bells || [];
  const idx = getEditDayIndex();
  return (profile.dayBells && profile.dayBells[idx]) || [];
}

function saveBells(bells) {
  const activeId = getActiveProfileId();
  return saveProfiles(getProfiles().map(p => {
    if (p.id !== activeId) return p;
    if ((p.scheduleType || 'daily') === 'daily') return { ...p, bells };
    const idx = getEditDayIndex();
    return { ...p, dayBells: { ...(p.dayBells || {}), [idx]: bells } };
  }));
}

function addBell(bell) {
  const bells = getBells();
  bells.push(bell);
  return saveBells(bells);
}

function updateBell(id, updates) {
  return saveBells(getBells().map(b => (b.id === id ? { ...b, ...updates } : b)));
}

function deleteBell(id) {
  return saveBells(getBells().filter(b => b.id !== id));
}

/* ===== Bells for the REAL current date — used by the scheduler, ===== */
/* ===== Schedule Overview, and Next Bell. Independent of editing state. */

function getTodaysBells() {
  const profile = getActiveProfile();
  if (!profile) return [];
  if ((profile.scheduleType || 'daily') === 'daily') return profile.bells || [];

  if (!profile.rangeStart || !profile.numDays) return [];
  const offset = daysBetween(profile.rangeStart, todayStr());
  if (offset < 0 || offset >= profile.numDays) return []; // today falls outside this template's window

  return (profile.dayBells && profile.dayBells[offset]) || [];
}