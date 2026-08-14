import type { DashboardClock } from "./dashboard";

export function createDashboardClock(date = new Date()): DashboardClock {
  return {
    hours: date.getHours(),
    minutes: date.getMinutes(),
    weekday: date.toLocaleDateString("en-US", { weekday: "short" }),
    month: date.toLocaleDateString("en-US", { month: "short" }),
    day: date.getDate(),
  };
}

export function formatDashboardTime(
  clock: DashboardClock | undefined,
  receivedAt: number,
  now: number,
): string {
  if (!clock) return "--:--";

  const elapsedMinutes = Math.max(0, Math.floor((now - receivedAt) / 60000));
  const totalMinutes = clock.hours * 60 + clock.minutes + elapsedMinutes;
  const hours = Math.floor(totalMinutes / 60) % 24 % 12 || 12;
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}
