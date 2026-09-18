// scheduler.js — checks the clock every second and fires any enabled bell
// scheduled for TODAY (independent of whatever day is being edited in the
// UI), unless bells are currently paused.

let lastCheckedMinute = null;

function isPaused() {
  return loadData('bellsPaused', false);
}

function checkBells() {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const minuteKey = `${now.toDateString()} ${currentTime}`;

  if (minuteKey === lastCheckedMinute) return; // already handled this minute
  lastCheckedMinute = minuteKey;

  if (isPaused()) return;

  const dueBell = getTodaysBells().find(b => b.enabled && b.time === currentTime);
  if (dueBell) showAlarmRingOverlay(dueBell);
}

setInterval(checkBells, 1000);
checkBells(); // catch a bell whose time is right now, at page load