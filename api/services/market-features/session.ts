import { SessionFeature } from "./types";

export function computeSession(time: Date = new Date()): SessionFeature {
  const hour = time.getUTCHours();
  const minute = time.getUTCMinutes();
  const second = time.getUTCSeconds();
  const ms = time.getUTCMilliseconds();

  const msSinceMidnight = ((hour * 3600 + minute * 60 + second) * 1000) + ms;

  let activeSession: SessionFeature["activeSession"] = "DORMANT";
  let sessionName = "DORMANT";
  let timeToCloseMs = 0;

  if (hour >= 12 && hour < 16) {
    activeSession = "OVERLAP";
    sessionName = "EUROPE_US_OVERLAP";
    timeToCloseMs = (16 * 3600 * 1000) - msSinceMidnight;
  } else if (hour >= 7 && hour < 9) {
    activeSession = "OVERLAP";
    sessionName = "ASIA_EUROPE_OVERLAP";
    timeToCloseMs = (9 * 3600 * 1000) - msSinceMidnight;
  } else if (hour >= 0 && hour < 7) {
    activeSession = "ASIA";
    sessionName = "ASIA";
    timeToCloseMs = (7 * 3600 * 1000) - msSinceMidnight;
  } else if (hour >= 9 && hour < 12) {
    activeSession = "EUROPE";
    sessionName = "EUROPE";
    timeToCloseMs = (12 * 3600 * 1000) - msSinceMidnight;
  } else if (hour >= 16 && hour < 21) {
    activeSession = "US";
    sessionName = "US";
    timeToCloseMs = (21 * 3600 * 1000) - msSinceMidnight;
  } else {
    // 21:00 to 00:00 UTC is dormant
    activeSession = "DORMANT";
    sessionName = "DORMANT";
    timeToCloseMs = (24 * 3600 * 1000) - msSinceMidnight;
  }

  return {
    activeSession,
    timeToCloseMs,
    sessionName,
  };
}
