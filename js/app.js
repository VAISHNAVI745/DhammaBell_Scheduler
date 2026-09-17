// app.js — main entry point, orchestrates the whole app

let refreshBellList = () => {}; // set by initBellManager; called after profile switches

document.addEventListener('DOMContentLoaded', () => {
  migrateLegacyBellsIfNeeded();
  startLiveClock();
  initHolidayPause();
  initPauseTodayButton();
  initTimetableProfiles();
  initBellManager();
  initAlarmRingOverlay();
  initBackupTools();
  initWakeLock();
  requestNotificationPermission();
  renderTodayTimetable();
});

/**
 * Updates the #live-time and #live-date elements every second, and keeps
 * Today's Timetable statuses (Upcoming/Ringing Now/Rung) live too.
 */
function startLiveClock() {
  const timeEl = document.getElementById('live-time');
  const dateEl = document.getElementById('live-date');

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

    renderTodayTimetable();
  }

  tick();
  setInterval(tick, 1000);
}

/**
 * Wires up the Holiday/Vacation Pause form.
 */
function initHolidayPause() {
  const fromInput = document.getElementById('holiday-from-date');
  const toInput = document.getElementById('holiday-to-date');
  const reasonInput = document.getElementById('holiday-reason');
  const banner = document.getElementById('holiday-status-banner');
  const setBtn = document.getElementById('set-holiday-btn');
  const removeBtn = document.getElementById('remove-holiday-btn');

  function refreshBanner(period) {
    if (!period) {
      banner.style.display = 'none';
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const isActiveNow = today >= period.fromDate && today <= period.toDate;
    const reasonText = period.reason ? ` (${period.reason})` : '';

    banner.style.display = 'block';
    banner.classList.toggle('active-now', isActiveNow);
    banner.textContent = isActiveNow
      ? `Bells are currently paused (${period.fromDate} to ${period.toDate})${reasonText}`
      : `Bells will be paused from ${period.fromDate} to ${period.toDate}${reasonText}`;
  }

  const saved = loadData('holidayPause', null);
  if (saved) {
    fromInput.value = saved.fromDate;
    toInput.value = saved.toDate;
    reasonInput.value = saved.reason || '';
  }
  refreshBanner(saved);

  setBtn.addEventListener('click', () => {
    const fromDate = fromInput.value;
    const toDate = toInput.value;
    if (!fromDate || !toDate) return alert('Please select both a From Date and a To Date.');
    if (fromDate > toDate) return alert('From Date cannot be after To Date.');

    const period = { fromDate, toDate, reason: reasonInput.value.trim() };
    saveData('holidayPause', period);
    refreshBanner(period);
    renderTodayTimetable();
    syncPauseTodayButton();
  });

  removeBtn.addEventListener('click', () => {
    removeData('holidayPause');
    fromInput.value = toInput.value = reasonInput.value = '';
    refreshBanner(null);
    renderTodayTimetable();
    syncPauseTodayButton();
  });

  // Exposed so initPauseTodayButton() can refresh this form's UI too,
  // since both features write to the same holidayPause storage key.
  window._refreshHolidayPauseUI = () => {
    const p = loadData('holidayPause', null);
    if (p) {
      fromInput.value = p.fromDate;
      toInput.value = p.toDate;
      reasonInput.value = p.reason || '';
    } else {
      fromInput.value = toInput.value = reasonInput.value = '';
    }
    refreshBanner(p);
  };
}

/**
 * Wires up the "Pause Bells for Today" quick-action button. Acts as a
 * toggle: tapping it sets today as a one-day holiday pause; tapping it
 * again (while that same pause is active) removes it. If a longer,
 * user-set date range is already active, asks before overwriting it.
 */
function initPauseTodayButton() {
  const btn = document.getElementById('pause-today-btn');
  btn.addEventListener('click', () => {
    const today = new Date().toISOString().split('T')[0];
    const current = loadData('holidayPause', null);
    const isTodayOnlyPause = current && current.fromDate === today && current.toDate === today;

    if (isTodayOnlyPause) {
      removeData('holidayPause');
    } else {
      if (current && !confirm('A holiday pause is already set. Replace it with a pause for today only?')) return;
      saveData('holidayPause', { fromDate: today, toDate: today, reason: 'Paused for today' });
    }

    window._refreshHolidayPauseUI?.();
    renderTodayTimetable();
    syncPauseTodayButton();
  });

  syncPauseTodayButton();
}

/**
 * Updates the Pause Bells for Today button's label/style to reflect
 * whether today is currently paused, so the toggle state is visible.
 */
function syncPauseTodayButton() {
  const btn = document.getElementById('pause-today-btn');
  const today = new Date().toISOString().split('T')[0];
  const current = loadData('holidayPause', null);
  const isPausedNow = current && today >= current.fromDate && today <= current.toDate;

  btn.textContent = isPausedNow ? 'Resume Bells for Today' : 'Pause Bells for Today';
  btn.classList.toggle('btn-pause', !isPausedNow);
  btn.classList.toggle('btn-danger', isPausedNow);
}

/**
 * Wires up the Timetable Profiles dropdown: switching, adding, renaming,
 * and deleting profiles. Switching a profile re-renders the Bell Schedule
 * and Today's Timetable so they reflect the newly active profile's bells.
 */
function initTimetableProfiles() {
  const select = document.getElementById('profile-select');
  const addBtn = document.getElementById('add-profile-btn');
  const renameBtn = document.getElementById('rename-profile-btn');
  const deleteBtn = document.getElementById('delete-profile-btn');

  function renderProfileSelect() {
    const profiles = getProfiles();
    const activeId = getActiveProfileId();
    select.innerHTML = profiles
      .map(p => `<option value="${p.id}" ${p.id === activeId ? 'selected' : ''}>${p.name} (${p.bells.length})</option>`)
      .join('');
  }

  select.addEventListener('change', () => {
    setActiveProfileId(select.value);
    refreshBellList();
    renderTodayTimetable();
  });

  addBtn.addEventListener('click', () => {
    const name = prompt('Name for new profile (e.g. "Weekend"):');
    if (!name || !name.trim()) return;
    const profile = addProfile(name.trim());
    setActiveProfileId(profile.id);
    renderProfileSelect();
    refreshBellList();
    renderTodayTimetable();
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
    refreshBellList();
    renderTodayTimetable();
  });

  renderProfileSelect();
}

/**
 * Wires up the alarm-style Bell Schedule: "+" opens a modal to add a bell;
 * tapping a row reopens it pre-filled to edit; the row's ✕ deletes instantly.
 * Every bell rings continuously until stopped when it fires. "Test Sound"
 * plays a short auto-stopping preview.
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

  let editingId = null;

  function openModal(bell = null) {
    stopRinging();
    editingId = bell ? bell.id : null;
    modalTitle.textContent = bell ? 'Edit Bell' : 'Add Bell';
    timeInput.value = bell ? bell.time : '';
    labelInput.value = bell ? bell.label || '' : '';
    soundSelect.value = bell ? bell.sound : 'classic';
    announcementInput.value = bell ? bell.announcement || '' : '';
    deleteBtn.style.display = bell ? 'block' : 'none';
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
      : '<p class="section-desc">No bells added yet. Tap + to add one.</p>';

    bells.forEach(bell => {
      const [timeStr, ampm] = formatTime12h(bell.time).split(' ');
      const item = document.createElement('div');
      item.className = 'bell-item' + (bell.enabled ? '' : ' disabled');
      item.innerHTML = `
        <div class="bell-item-info">
          <span class="bell-item-time">${timeStr}<span class="ampm">${ampm}</span></span>
          <span class="bell-item-meta">${bell.label || 'Untitled'} · ${bell.sound}</span>
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
        if (confirm('Delete this bell?')) {
          deleteBell(btn.dataset.id);
          renderBells();
        }
      });
    });

    renderTodayTimetable();
  }

  document.getElementById('open-add-bell-btn').addEventListener('click', () => openModal());
  document.getElementById('close-bell-modal-btn').addEventListener('click', closeModal);
  document.getElementById('cancel-bell-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  document.getElementById('save-bell-btn').addEventListener('click', () => {
    const time = timeInput.value;
    if (!time) return alert('Please select a time for the bell.');

    const bellData = {
      time,
      label: labelInput.value.trim(),
      sound: soundSelect.value,
      announcement: announcementInput.value.trim(),
    };

    if (editingId) updateBell(editingId, bellData);
    else addBell({ id: Date.now().toString(), enabled: true, ...bellData });

    renderBells();
    closeModal();
  });

  deleteBtn.addEventListener('click', () => {
    if (!editingId) return;
    deleteBell(editingId);
    renderBells();
    closeModal();
  });

  document.getElementById('test-bell-btn').addEventListener('click', () => {
    previewBell(soundSelect.value, announcementInput.value.trim(), 6000);
  });

  refreshBellList = renderBells; // expose so profile switching can trigger a re-render
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

const ALARM_RING_DURATION_MS = 20000; // rings for 20s, or until user taps Stop — adjust 15000–30000 to taste
let alarmAutoHideId = null;

function showAlarmRingOverlay(bell) {
  document.getElementById('alarm-ring-time').textContent = formatTime12h(bell.time);
  document.getElementById('alarm-ring-label').textContent = bell.label || 'Bell';
  document.getElementById('alarm-ring-overlay').style.display = 'flex';

  startRinging(bell.sound, bell.announcement, ALARM_RING_DURATION_MS);
  notifyBellFired(bell); // shows an OS notification if the tab isn't focused

  clearTimeout(alarmAutoHideId);
  alarmAutoHideId = setTimeout(hideAlarmRingOverlay, ALARM_RING_DURATION_MS);
}

function hideAlarmRingOverlay() {
  clearTimeout(alarmAutoHideId);
  document.getElementById('alarm-ring-overlay').style.display = 'none';
  renderTodayTimetable(); // reflect "Rung" status right away once dismissed
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
 * Renders the read-only "Today's Timetable" summary: every bell in the
 * ACTIVE profile, tagged with its live status.
 */
function renderTodayTimetable() {
  const listEl = document.getElementById('today-timetable-list');
  if (!listEl) return;

  const bells = getBells().slice().sort((a, b) => a.time.localeCompare(b.time));
  if (bells.length === 0) {
    listEl.innerHTML = '<p class="section-desc">No bells are set. Please add a new record.</p>';
    return;
  }

  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const paused = isHolidayActive();

  listEl.innerHTML = '';
  bells.forEach(bell => {
    let status, statusClass;
    if (!bell.enabled) {
      status = 'Disabled'; statusClass = 'status-disabled';
    } else if (paused) {
      status = 'Paused'; statusClass = 'status-paused';
    } else if (bell.time === currentTime) {
      status = 'Ringing Now'; statusClass = 'status-now';
    } else if (bell.time < currentTime) {
      status = 'Rung'; statusClass = 'status-rung';
    } else {
      status = 'Upcoming'; statusClass = 'status-upcoming';
    }

    const item = document.createElement('div');
    item.className = 'bell-item';
    item.innerHTML = `
      <div class="bell-item-info">
        <span class="bell-item-time">${formatTime12h(bell.time)}</span>
        <span class="bell-item-meta">${bell.label || 'Untitled'}</span>
      </div>
      <span class="status-pill ${statusClass}">${status}</span>
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

/**
 * Shows an OS-level notification when a bell fires and the tab is hidden.
 */
function notifyBellFired(bell) {
  if (document.visibilityState === 'visible') return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  new Notification('DhammaBellScheduler', {
    body: `${formatTime12h(bell.time)} — ${bell.label || 'Bell'}`,
    icon: './icons/icon-192.png',
  });
}

/**
 * Requests a screen wake lock so the tab keeps running while open.
 */
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