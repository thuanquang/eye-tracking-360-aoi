function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function normalizeMaxEvents(maxEvents) {
  return Number.isFinite(maxEvents) ? Math.max(1, Math.floor(maxEvents)) : 600;
}

function normalizeOnScreen(value) {
  if (value === true) {
    return true;
  }

  if (value === false) {
    return false;
  }

  return null;
}

function countDroppedReasons(events) {
  return events.reduce((counts, event) => {
    if (!event.accepted) {
      const reason = event.reason || 'rejected';
      counts[reason] = (counts[reason] || 0) + 1;
    }

    return counts;
  }, {});
}

function countOnScreenEvents(events, value) {
  return events.filter((event) => event.onScreen === value).length;
}

function countAcceptedEvents(events) {
  return events.filter((event) => event.accepted).length;
}

function numberOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function updateGazeStreamStats(previous, event, { maxEvents = 600 } = {}) {
  const previousEvents = previous?.events || [];
  const accepted = Boolean(event.accepted);
  const reason = accepted ? null : event.reason || 'rejected';
  const onScreen = normalizeOnScreen(event.onScreen);
  const droppedReasons = {
    ...(previous?.droppedReasons || countDroppedReasons(previousEvents)),
  };

  if (!accepted) {
    droppedReasons[reason] = (droppedReasons[reason] || 0) + 1;
  }

  const events = [
    ...previousEvents,
    {
      atMs: event.atMs,
      accepted,
      reason,
      onScreen,
    },
  ].slice(-normalizeMaxEvents(maxEvents));

  return {
    totalEvents: numberOr(previous?.totalEvents, previousEvents.length) + 1,
    acceptedEvents: numberOr(previous?.acceptedEvents, countAcceptedEvents(previousEvents)) + (accepted ? 1 : 0),
    droppedEvents: numberOr(
      previous?.droppedEvents,
      previousEvents.length - countAcceptedEvents(previousEvents),
    ) + (accepted ? 0 : 1),
    droppedReasons,
    onScreenEvents: numberOr(previous?.onScreenEvents, countOnScreenEvents(previousEvents, true))
      + (onScreen === true ? 1 : 0),
    offScreenEvents: numberOr(previous?.offScreenEvents, countOnScreenEvents(previousEvents, false))
      + (onScreen === false ? 1 : 0),
    events,
  };
}

export function shouldRecordGazeStreamDrop(stats, event, minIntervalMs = 0) {
  const reason = event?.reason || 'rejected';
  const atMs = event?.atMs;

  if (!Number.isFinite(atMs)) {
    return true;
  }

  const intervalMs = Math.max(0, minIntervalMs);
  const events = stats?.events || [];

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const previous = events[index];

    if (!previous.accepted && previous.reason === reason) {
      return !Number.isFinite(previous.atMs) || atMs - previous.atMs >= intervalMs;
    }
  }

  return true;
}

export function summarizeGazeStreamQuality(stats) {
  const events = stats?.events || [];
  const totalEvents = numberOr(stats?.totalEvents, events.length);
  const acceptedEvents = numberOr(stats?.acceptedEvents, countAcceptedEvents(events));
  const droppedEvents = numberOr(stats?.droppedEvents, totalEvents - acceptedEvents);
  const droppedReasons = {
    ...(stats?.droppedReasons || countDroppedReasons(events)),
  };
  const onScreenEvents = numberOr(stats?.onScreenEvents, countOnScreenEvents(events, true));
  const offScreenEvents = numberOr(stats?.offScreenEvents, countOnScreenEvents(events, false));
  const knownScreenEvents = onScreenEvents + offScreenEvents;
  const first = events[0]?.atMs;
  const last = events.at(-1)?.atMs;
  const windowDurationSec = Number.isFinite(first) && Number.isFinite(last) && last > first
    ? (last - first) / 1000
    : 0;
  const acceptedWindowEvents = events.filter((event) => event.accepted && Number.isFinite(event.atMs));
  const firstAccepted = acceptedWindowEvents[0]?.atMs;
  const lastAccepted = acceptedWindowEvents.at(-1)?.atMs;
  const acceptedDurationSec = (
    acceptedWindowEvents.length > 1 &&
    Number.isFinite(firstAccepted) &&
    Number.isFinite(lastAccepted) &&
    lastAccepted > firstAccepted
  )
    ? (lastAccepted - firstAccepted) / 1000
    : 0;

  return {
    totalEvents,
    acceptedEvents,
    droppedEvents,
    droppedReasons,
    effectiveHz: windowDurationSec > 0 ? round((events.length - 1) / windowDurationSec, 2) : 0,
    acceptedHz: acceptedDurationSec > 0
      ? round((acceptedWindowEvents.length - 1) / acceptedDurationSec, 2)
      : 0,
    dataIntegrityPercent: totalEvents ? round((acceptedEvents / totalEvents) * 100, 2) : 0,
    onScreenEvents,
    offScreenEvents,
    onScreenPercent: knownScreenEvents ? round((onScreenEvents / knownScreenEvents) * 100, 2) : null,
    windowEventCount: events.length,
    windowDurationSec: round(windowDurationSec, 3) || 0,
    windowed: totalEvents > events.length,
  };
}
