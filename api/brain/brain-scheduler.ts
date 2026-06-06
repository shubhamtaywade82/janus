import { evolveStrategies } from "./brain-evolution";

let schedulerIntervalId: NodeJS.Timeout | null = null;
let lastExecutedDay = -1;

export function startBrainScheduler() {
  if (schedulerIntervalId) return;

  console.log("[Brain Scheduler] Initializing background tasks...");

  // Check every 15 minutes
  const intervalMs = 15 * 60 * 1000;
  
  schedulerIntervalId = setInterval(async () => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDate();

    // Trigger daily at 2:00 AM
    if (currentHour === 2 && currentDay !== lastExecutedDay) {
      lastExecutedDay = currentDay;
      console.log(`[Brain Scheduler] Daily trigger hit at ${now.toISOString()}. Starting evolution...`);
      try {
        await evolveStrategies();
      } catch (err: any) {
        console.error("[Brain Scheduler] Evolution error:", err.message);
      }
    }
  }, intervalMs);
}

export function stopBrainScheduler() {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
    console.log("[Brain Scheduler] Background tasks stopped.");
  }
}
