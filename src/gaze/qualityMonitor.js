function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function updateGazeStreamStats(previous, event, { maxEvents = 600 } = {}) {
  const events = [
    ...(previous?.events || []),
    {
      atMs: event.atMs,
      accepted: Boolean(event.accepted),
      reason: event.accepted ? null : event.reason || 'rejected',
      onScreen: event.onScreen ?? null,
    },
  ].slice(-maxEvents);

  return { events };
}

export function summarizeGazeStreamQuality(stats) {
  const events = stats?.events || [];
  const acceptedEvents = events.filter((event) => event.accepted).length;
  const droppedEvents = events.length - acceptedEvents;
  const droppedReasons = {};

  events.forEach((event) => {
    if (!event.accepted) {
      droppedReasons[event.reason] = (droppedReasons[event.reason] || 0) + 1;
    }
  });

  const first = events[0]?.atMs;
  const last = events.at(-1)?.atMs;
  const durationSec = Number.isFinite(first) && Number.isFinite(last) && last > first
    ? (last - first) / 1000
    : 0;

  return {
    totalEvents: events.length,
    acceptedEvents,
    droppedEvents,
    droppedReasons,
    effectiveHz: durationSec > 0 ? round((events.length - 1) / durationSec, 2) : 0,
    acceptedHz: durationSec > 0 ? round((acceptedEvents - 1) / durationSec, 2) : 0,
    dataIntegrityPercent: events.length ? round((acceptedEvents / events.length) * 100, 2) : 0,
  };
}
