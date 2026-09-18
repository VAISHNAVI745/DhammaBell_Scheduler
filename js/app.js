// app.js — main entry point, orchestrates the whole app.
//
// Startup is deliberately defensive: the clock starts FIRST and
// unconditionally, and every other init step runs inside its own
// try/catch, so a bug in one section can never take down the whole page.

let refreshBellList = () => {}; // set by initBellManager; called after profile/day-tab switches

document.addEventListener('DOMContentLoaded', () => {
  startLiveClock(); // always runs first, unconditionally

  const steps = [
    ['data migration', () => migrateLegacyBellsIfNeeded()],
    ['edit day index', () => setEditDayIndex(pickDefaultEditDayIndex(getActiveProfile()))],
    ['pause button', initPauseButton],
    ['timetable profiles', initTimetableProfiles],
    ['bell manager', initBellManager],
    ['alarm overlay', initAlarmRingOverlay],
    ['backup tools', initBackupTools],
    ['wake lock', initWakeLock],
    ['notifications', requestNotificationPermission],
    ['schedule overview', renderScheduleOverview],
    ['next bell', renderNextBell],
  ];

  steps.forEach(([label, fn]) => {
    try {
      fn();
    } catch (err) {
      console.error(`app.js: "${label}" failed to initialize —`, err);
    }
  });
});

/**
 * Picks a sensible day offset to open the Bell Schedule editor on: today's
 * offset if the profile is 'range' and today falls inside its window,
 * otherwise Day 0 (the first day of the template).
 */
function pickDefaultEditDayIndex(profile) {
  if (!profile || (profile.scheduleType || 'daily') !== 'range') return 0;
  if (!profile.rangeStart || !profile.numDays) return 0;
  const offset = daysBetween(profile.rangeStart, todayStr());
  return (offset >= 0 && offset < profile.numDays) ? offset : 0;
}

/**
 * Formats "YYYY-MM-DD" as e.g. "Mon, 21 Sep" for day tabs and subtitles.
 */
function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Updates the Bell Schedule card's subtitle to reflect what's being edited.
 */
function updateBellScheduleSubtitle() {
  const subtitle = document.getElementById('bell-schedule-subtitle');
  const profile = getActiveProfile();
  if (!profile || !subtitle) return;

  if ((profile.scheduleType || 'daily') !== 'range') {
    subtitle.textContent = 'Bells ring automatically at their set time, every day.';
    return;
  }

  const idx = getEditDayIndex();
  const dateLabel = profile.rangeStart ? ` (${formatDateLabel(addDays(profile.rangeStart, idx))})` : '';
  subtitle.textContent = `Editing Day ${idx + 1} of ${profile.numDays || '?'}${dateLabel}`;
}

/**
 * Renders the horizontal day-tab picker in the Bell Schedule EDITOR for
 * 'range' profiles (choosing which day to add/edit bells for).
 */
function renderDayTabs() {
  const container = document.getElementById('day-tabs');
  if (!container) return;

  const profile = getActiveProfile();
  if (!profile || (profile.scheduleType || 'daily') !== 'range' || !profile.numDays) {
    container.innerHTML = '';
    return;
  }

  const editIdx = getEditDayIndex();

  container.innerHTML = Array.from({ length: profile.numDays }, (_, i) => {
    const count = ((profile.dayBells && profile.dayBells[i]) || []).length;
    const label = profile.rangeStart ? formatDateLabel(addDays(profile.rangeStart, i)) : `Day ${i + 1}`;
    return `
      <button class="day-tab${i === editIdx ? ' active' : ''}" data-index="${i}">
        ${label}
        <span class="day-tab-count">${count} bell${count === 1 ? '' : 's'}</span>
      </button>
    `;
  }).join('');

  container.querySelectorAll('.day-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      setEditDayIndex(Number(btn.dataset.index));
      renderDayTabs();
      updateBellScheduleSubtitle();
      refreshBellList();
    });
  });
}

/**
 * Syncs the Schedule Type select, range fields, day tabs, and Bell
 * Schedule subtitle to match the currently active profile.
 */
function renderScheduleTypeUI() {
  const profile = getActiveProfile();
  if (!profile) return;

  const typeSelect = document.getElementById('schedule-type-select');
  const rangeFields = document.getElementById('date-range-fields');
  const numDaysInput = document.getElementById('range-num-days');
  const startInput = document.getElementById('range-start-date');

  const scheduleType = profile.scheduleType || 'daily';
  typeSelect.value = scheduleType;
  rangeFields.style.display = scheduleType === 'range' ? 'block' : 'none';
  numDaysInput.value = profile.numDays || '';
  startInput.value = profile.rangeStart || todayStr();

  renderDayTabs();
  updateBellScheduleSubtitle();
}

/**
 * Updates the #live-time and #live-date elements every second, and keeps
 * the Schedule Overview and Next Bell live too. Runs unconditionally and
 * first in DOMContentLoaded.
 */
function startLiveClock() {
  const timeEl = document.getElementById('live-time');
  const dateEl = document.getElementById('live-date');
  if (!timeEl || !dateEl) return;

  function tick() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    timeEl.textContent = `${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    });

    try { renderScheduleOverview(); } catch (err) { console.error('renderScheduleOverview failed:', err); }
    try { renderNextBell(); } catch (err) { console.error('renderNextBell failed:', err); }
  }

  tick();
  setInterval(tick, 1000);
}

/**
 * Wires up the "Pause" quick-action button — pauses ALL bells indefinitely,
 * across every profile, until tapped again.
 */
function initPauseButton() {
  const btn = document.getElementById('pause-btn');
  btn.addEventListener('click', () => {
    saveData('bellsPaused', !isPaused());
    syncPauseButton();
    renderScheduleOverview();
    renderNextBell();
  });

  syncPauseButton();
}

function syncPauseButton() {
  const btn = document.getElementById('pause-btn');
  const paused = isPaused();
  btn.textContent = paused ? 'Resume' : 'Pause';
  btn.classList.toggle('btn-pause', !paused);
  btn.classList.toggle('btn-danger', paused);
}

/**
 * Wires up Timetable Profiles: switching/adding/renaming/deleting profiles,
 * choosing a Schedule Type, applying Number of Days + Start Date, and the
 * day-tab picker for range profiles.
 */
function initTimetableProfiles() {
  const select = document.getElementById('profile-select');
  const addBtn = document.getElementById('add-profile-btn');
  const renameBtn = document.getElementById('rename-profile-btn');
  const deleteBtn = document.getElementById('delete-profile-btn');
  const typeSelect = document.getElementById('schedule-type-select');
  const numDaysInput = document.getElementById('range-num-days');
  const startInput = document.getElementById('range-start-date');
  const applyRangeBtn = document.getElementById('apply-range-btn');

  function renderProfileSelect() {
    const profiles = getProfiles();
    const activeId = getActiveProfileId();
    select.innerHTML = profiles
      .map(p => `<option value="${p.id}" ${p.id === activeId ? 'selected' : ''}>${p.name}</option>`)
      .join('');
  }

  function afterProfileChange() {
    setEditDayIndex(pickDefaultEditDayIndex(getActiveProfile()));
    renderScheduleTypeUI();
    refreshBellList();
    renderScheduleOverview();
    renderNextBell();
  }

  select.addEventListener('change', () => {
    setActiveProfileId(select.value);
    afterProfileChange();
  });

  addBtn.addEventListener('click', () => {
    const name = prompt('Name for new profile (e.g. "Weekend"):');
    if (!name || !name.trim()) return;
    const profile = addProfile(name.trim());
    setActiveProfileId(profile.id);
    renderProfileSelect();
    afterProfileChange();
  });

  renameBtn.addEventListener('click', () => {
    const current = getProfiles().find(p => p.id === select.value);
    if (!current) return;
    const name = prompt('Rename profile:', current.name);
    if (!name || !name.trim()) return;
    renameProfile(current.id, name.trim());
    renderProfileSelect();
  });

  deleteBtn.addEventListener('click', () => {
    if (getProfiles().length <= 1) return alert('You need at least one profile.');
    if (!confirm('Delete this profile and all its bells? This cannot be undone.')) return;
    deleteProfile(select.value);
    renderProfileSelect();
    afterProfileChange();
  });

  typeSelect.addEventListener('change', () => {
    setScheduleType(typeSelect.value);
    afterProfileChange();
  });

  applyRangeBtn.addEventListener('click', () => {
    const numDays = parseInt(numDaysInput.value, 10);
    const startDate = startInput.value;
    if (!numDays || numDays < 1) return alert('Please enter a valid number of days (1 or more).');
    if (!startDate) return alert('Please pick a start date.');

    setProfileRangeConfig(numDays, startDate);
    afterProfileChange();
  });

  renderProfileSelect();
  renderScheduleTypeUI();
}

/**
 * Wires up the alarm-style Bell Schedule: "+" opens a modal to add a bell
 * to the day currently being edited; tapping a row reopens it pre-filled;
 * the row's ✕ deletes instantly. "Test Sound" plays a short auto-stopping
 * preview. Also handles the Bell Tone dropdown's "Custom Sound" upload,
 * saved into IndexedDB (via audioStore.js) rather than localStorage.
 */
function initBellManager() {
  const overlay = document.getElementById('bell-modal-overlay');
  const modalTitle = document.getElementById('bell-modal-title');
  const timeInput = document.getElementById('bell-time');
  const labelInput = document.getElementById('bell-label');
  const soundSelect = document.getElementById('bell-sound');
  const announcementInput = document.getElementById('bell-announcement');
  const deleteBtn = document.getElementById('delete-bell-btn');
  const listEl = document.getElementById('bell-list');

  const customSoundField = document.getElementById('custom-sound-field');
  const customSoundInput = document.getElementById('custom-sound-input');
  const customSoundFilename = document.getElementById('custom-sound-filename');

  let editingId = null;
  let pendingCustomSoundId = null;
  let pendingCustomSoundName = '';
  let pendingCustomSoundBlob = null;
  let pendingCustomSoundObjectUrl = null;

  function syncCustomSoundFieldVisibility() {
    customSoundField.style.display = soundSelect.value === 'custom' ? 'block' : 'none';
  }

  soundSelect.addEventListener('change', syncCustomSoundFieldVisibility);

  customSoundInput.addEventListener('change', () => {
    const file = customSoundInput.files[0];
    if (!file) return;

    if (pendingCustomSoundObjectUrl) URL.revokeObjectURL(pendingCustomSoundObjectUrl);
    pendingCustomSoundBlob = file;
    pendingCustomSoundObjectUrl = URL.createObjectURL(file);
    pendingCustomSoundName = file.name;
    customSoundFilename.textContent = `Selected: ${file.name} (will be saved when you tap Save)`;
  });

  function openModal(bell = null) {
    stopRinging();
    editingId = bell ? bell.id : null;
    modalTitle.textContent = bell ? 'Edit Bell' : 'Add Bell';
    timeInput.value = bell ? bell.time : '';
    labelInput.value = bell ? bell.label || '' : '';
    soundSelect.value = bell ? bell.sound : 'classic';
    announcementInput.value = bell ? bell.announcement || '' : '';
    deleteBtn.style.display = bell ? 'block' : 'none';

    if (pendingCustomSoundObjectUrl) {
      URL.revokeObjectURL(pendingCustomSoundObjectUrl);
      pendingCustomSoundObjectUrl = null;
    }
    pendingCustomSoundBlob = null;
    pendingCustomSoundId = bell && bell.customSoundId ? bell.customSoundId : null;
    pendingCustomSoundName = bell && bell.customSoundName ? bell.customSoundName : '';
    customSoundInput.value = '';
    customSoundFilename.textContent = pendingCustomSoundName ? `Current: ${pendingCustomSoundName}` : '';
    syncCustomSoundFieldVisibility();

    overlay.style.display = 'flex';
  }

  function closeModal() {
    stopRinging();
    overlay.style.display = 'none';
    editingId = null;
  }

  function renderBells() {
    const bells = getBells().sort((a, b) => a.time.localeCompare(b.time));
    listEl.innerHTML = bells.length
      ? ''
      : '<p class="section-desc">No bells added for this day yet. Tap + to add one.</p>';

    bells.forEach(bell => {
      const [timeStr, ampm] = formatTime12h(bell.time).split(' ');
      const item = document.createElement('div');
      item.className = 'bell-item' + (bell.enabled ? '' : ' disabled');
      const soundLabel = bell.sound === 'custom' ? (bell.customSoundName || 'custom sound') : bell.sound;
      item.innerHTML = `
        <div class="bell-item-info">
          <span class="bell-item-time">${timeStr}<span class="ampm">${ampm}</span></span>
          <span class="bell-item-meta">${bell.label || 'Untitled'} · ${soundLabel}</span>
        </div>
        <div class="bell-item-actions">
          <label class="switch" onclick="event.stopPropagation()">
            <input type="checkbox" ${bell.enabled ? 'checked' : ''} data-id="${bell.id}" class="bell-toggle" />
            <span class="slider"></span>
          </label>
          <button class="icon-btn bell-quick-delete" data-id="${bell.id}" onclick="event.stopPropagation()">✕</button>
        </div>
      `;
      item.addEventListener('click', () => openModal(bell));
      listEl.appendChild(item);
    });

    listEl.querySelectorAll('.bell-toggle').forEach(toggle => {
      toggle.addEventListener('change', e => {
        updateBell(e.target.dataset.id, { enabled: e.target.checked });
        renderBells();
      });
    });

    listEl.querySelectorAll('.bell-quick-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('Delete this bell?')) return;
        const bell = getBells().find(b => b.id === btn.dataset.id);
        deleteBell(btn.dataset.id);
        if (bell && bell.customSoundId) deleteCustomSound(bell.customSoundId).catch(() => {});
        renderBells();
      });
    });

    renderDayTabs();
    renderScheduleOverview();
    renderNextBell();
  }

  document.getElementById('open-add-bell-btn').addEventListener('click', () => openModal());
  document.getElementById('close-bell-modal-btn').addEventListener('click', closeModal);
  document.getElementById('cancel-bell-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  document.getElementById('save-bell-btn').addEventListener('click', async () => {
    const time = timeInput.value;
    if (!time) return alert('Please select a time for the bell.');

    if (soundSelect.value === 'custom' && !pendingCustomSoundBlob && !pendingCustomSoundId) {
      return alert('Please upload a sound file, or choose a preset Bell Tone instead.');
    }

    let customSoundId = soundSelect.value === 'custom' ? pendingCustomSoundId : null;
    let customSoundName = soundSelect.value === 'custom' ? pendingCustomSoundName : '';

    if (soundSelect.value === 'custom' && pendingCustomSoundBlob) {
      customSoundId = `snd_${Date.now()}`;
      try {
        await saveCustomSound(customSoundId, pendingCustomSoundBlob);
      } catch (err) {
        console.error('Failed to save custom sound:', err);
        return alert('Could not save the audio file to this device. Please try a different file.');
      }
    }

    const bellData = {
      time,
      label: labelInput.value.trim(),
      sound: soundSelect.value,
      announcement: announcementInput.value.trim(),
      customSoundId: soundSelect.value === 'custom' ? customSoundId : null,
      customSoundName: soundSelect.value === 'custom' ? customSoundName : '',
    };

    const saveOk = editingId
      ? updateBell(editingId, bellData) !== false
      : addBell({ id: Date.now().toString(), enabled: true, ...bellData }) !== false;

    if (!saveOk) {
      alert('Could not save the bell — device storage may be full.');
      return;
    }

    renderBells();
    closeModal();
  });

  deleteBtn.addEventListener('click', () => {
    if (!editingId) return;
    const bell = getBells().find(b => b.id === editingId);
    deleteBell(editingId);
    if (bell && bell.customSoundId) deleteCustomSound(bell.customSoundId).catch(() => {});
    renderBells();
    closeModal();
  });

  document.getElementById('test-bell-btn').addEventListener('click', () => {
    if (soundSelect.value === 'custom' && !pendingCustomSoundBlob && !pendingCustomSoundId) {
      return alert('Please upload a sound file first, or pick a preset Bell Tone to test.');
    }

    const customSound = pendingCustomSoundObjectUrl
      ? { blobUrl: pendingCustomSoundObjectUrl }
      : (pendingCustomSoundId ? { id: pendingCustomSoundId } : null);

    previewBell(soundSelect.value, announcementInput.value.trim(), 6000, customSound);
  });

  refreshBellList = renderBells;
  renderBells();
}

/**
 * Wires up the full-screen Alarm Ringing overlay. scheduler.js calls
 * showAlarmRingOverlay(bell) when a bell's time arrives.
 */
function initAlarmRingOverlay() {
  document.getElementById('alarm-stop-btn').addEventListener('click', () => {
    stopRinging();
    hideAlarmRingOverlay();
  });
}

const ALARM_RING_DURATION_MS = 20000; // rings for at least 20s, or until user taps Stop — never cuts audio/speech short
let alarmAutoHideId = null;

function showAlarmRingOverlay(bell) {
  document.getElementById('alarm-ring-time').textContent = formatTime12h(bell.time);
  document.getElementById('alarm-ring-label').textContent = bell.label || 'Bell';
  document.getElementById('alarm-ring-overlay').style.display = 'flex';

  const customSound = bell.sound === 'custom' && bell.customSoundId ? { id: bell.customSoundId } : null;
  startRinging(bell.sound, bell.announcement, ALARM_RING_DURATION_MS, customSound);
  notifyBellFired(bell);

  clearTimeout(alarmAutoHideId);
  alarmAutoHideId = setTimeout(hideAlarmRingOverlay, ALARM_RING_DURATION_MS);
}

function hideAlarmRingOverlay() {
  clearTimeout(alarmAutoHideId);
  document.getElementById('alarm-ring-overlay').style.display = 'none';
  renderScheduleOverview();
  renderNextBell();
}

/**
 * Converts "HH:MM" (24hr) to "hh:mm AM/PM" for display.
 */
function formatTime12h(time24) {
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Builds one bell row's DOM element with a status pill. Shared by both
 * the 'daily' and 'range' branches of renderScheduleOverview().
 */
function buildBellRow(bell, status, statusClass) {
  const item = document.createElement('div');
  item.className = 'bell-item';
  item.innerHTML = `
    <div class="bell-item-info">
      <span class="bell-item-time">${formatTime12h(bell.time)}</span>
      <span class="bell-item-meta">${bell.label || 'Untitled'}</span>
    </div>
    <span class="status-pill ${statusClass}">${status}</span>
  `;
  return item;
}

/**
 * Computes a bell's live status against the given "now" (HH:MM) time.
 */
function computeLiveStatus(bell, currentTime, paused) {
  if (!bell.enabled) return ['Disabled', 'status-disabled'];
  if (paused) return ['Paused', 'status-paused'];
  if (bell.time === currentTime) return ['Ringing Now', 'status-now'];
  if (bell.time < currentTime) return ['Rung', 'status-rung'];
  return ['Upcoming', 'status-upcoming'];
}

/**
 * Renders "Schedule Overview":
 *  - 'daily' profile → one flat vertical list (today's live status), as before.
 *  - 'range' profile → a HORIZONTALLY scrollable row of day columns, one
 *    per configured day, each showing that day's bells vertically within
 *    its own card. The real current date's column is marked "Today".
 */
function renderScheduleOverview() {
  const listEl = document.getElementById('today-timetable-list');
  if (!listEl) return;

  const profile = getActiveProfile();
  if (!profile) { listEl.innerHTML = '<p class="section-desc">No profile found.</p>'; return; }

  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const paused = isPaused();
  listEl.innerHTML = '';

  if ((profile.scheduleType || 'daily') !== 'range') {
    listEl.classList.remove('schedule-days-row');
    const bells = (profile.bells || []).slice().sort((a, b) => a.time.localeCompare(b.time));
    if (bells.length === 0) {
      listEl.innerHTML = '<p class="section-desc">No bells are set.</p>';
      return;
    }
    bells.forEach(bell => {
      const [status, statusClass] = computeLiveStatus(bell, currentTime, paused);
      listEl.appendChild(buildBellRow(bell, status, statusClass));
    });
    return;
  }

  // 'range' profile — horizontal row of day columns.
  listEl.classList.add('schedule-days-row');

  if (!profile.rangeStart || !profile.numDays) {
    listEl.classList.remove('schedule-days-row');
    listEl.innerHTML = '<p class="section-desc">No date range configured yet.</p>';
    return;
  }

  const today = todayStr();
  const todayOffset = daysBetween(profile.rangeStart, today);

  for (let i = 0; i < profile.numDays; i++) {
    const dateStr = addDays(profile.rangeStart, i);
    const isToday = i === todayOffset;
    const isPast = dateStr < today;

    const col = document.createElement('div');
    col.className = 'schedule-day-col' + (isToday ? ' is-today' : '');

    const header = document.createElement('div');
    header.className = 'schedule-day-col-header';
    header.innerHTML = `
      <span class="schedule-day-col-title">Day ${i + 1} · ${formatDateLabel(dateStr)}</span>
      ${isToday ? '<span class="schedule-day-col-badge">Today</span>' : ''}
    `;
    col.appendChild(header);

    const bells = ((profile.dayBells && profile.dayBells[i]) || []).slice().sort((a, b) => a.time.localeCompare(b.time));
    if (bells.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'schedule-day-col-empty';
      empty.textContent = 'No bells set.';
      col.appendChild(empty);
    } else {
      bells.forEach(bell => {
        let status, statusClass;
        if (isToday) {
          [status, statusClass] = computeLiveStatus(bell, currentTime, paused);
        } else if (!bell.enabled) {
          status = 'Disabled'; statusClass = 'status-disabled';
        } else if (isPast) {
          status = 'Past'; statusClass = 'status-past';
        } else {
          status = 'Scheduled'; statusClass = 'status-scheduled';
        }
        col.appendChild(buildBellRow(bell, status, statusClass));
      });
    }

    listEl.appendChild(col);
  }
}

/**
 * Renders "Next Bell": the next 2–3 upcoming, enabled bells scheduled for
 * the REAL current date (getTodaysBells).
 */
function renderNextBell() {
  const listEl = document.getElementById('next-bell-list');
  if (!listEl) return;

  if (isPaused()) {
    listEl.innerHTML = '<p class="section-desc">Bells are paused.</p>';
    return;
  }

  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const upcoming = getTodaysBells()
    .filter(b => b.enabled && b.time > currentTime)
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, 3);

  if (upcoming.length === 0) {
    listEl.innerHTML = '<p class="section-desc">No more bells scheduled for today.</p>';
    return;
  }

  listEl.innerHTML = '';
  upcoming.forEach((bell, index) => {
    const soundLabel = bell.sound === 'custom' ? (bell.customSoundName || 'custom sound') : bell.sound;
    const item = document.createElement('div');
    item.className = 'bell-item' + (index === 0 ? ' next-bell' : '');
    item.innerHTML = `
      <div class="bell-item-info">
        <span class="bell-item-time">${formatTime12h(bell.time)}</span>
        <span class="bell-item-meta">${bell.label || 'Untitled'} · ${soundLabel}</span>
      </div>
      ${index === 0 ? '<span class="status-pill status-upcoming">Next</span>' : ''}
    `;
    listEl.appendChild(item);
  });
}

/**
 * Asks for notification permission once, up front, so we're allowed to
 * alert the user later even if the tab is in the background.
 */
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function notifyBellFired(bell) {
  if (document.visibilityState === 'visible') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  new Notification('DhammaBellScheduler', {
    body: `${formatTime12h(bell.time)} — ${bell.label || 'Bell'}`,
    icon: './icons/icon-192.png',
  });
}

let wakeLock = null;

async function initWakeLock() {
  if (!('wakeLock' in navigator)) return;

  const acquire = async () => {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.warn('Wake lock not granted:', err);
    }
  };

  await acquire();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquire();
  });
}