let lastCheckedMinute = null;

function isHolidayActive() {
  const period = loadData('holidayPause', null);
  if (!period) return false;
  const today = new Date().toISOString().split('T')[0];
  return today >= period.fromDate && today <= period.toDate;
}

function checkBells() {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const minuteKey = `${now.toDateString()} ${currentTime}`;

  if (minuteKey === lastCheckedMinute) return;
  lastCheckedMinute = minuteKey;

  if (isHolidayActive()) return;

  const dueBell = getBells().find(b => b.enabled && b.time === currentTime);
  if (dueBell) showAlarmRingOverlay(dueBell);
}

setInterval(checkBells, 1000);
checkBells();