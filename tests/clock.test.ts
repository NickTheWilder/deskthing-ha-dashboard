import { expect, test } from "bun:test";
import { createDashboardClock, formatDashboardTime } from "../shared/clock";

test("clock payload uses the supplied host date", () => {
  const clock = createDashboardClock(new Date(2026, 7, 13, 23, 58));
  expect(clock.hours).toBe(23);
  expect(clock.minutes).toBe(58);
  expect(clock.day).toBe(13);
});

test("clock advances from one payload receipt timestamp", () => {
  const clock = {
    hours: 23,
    minutes: 58,
    weekday: "Thu",
    month: "Aug",
    day: 13,
  };
  expect(formatDashboardTime(clock, 1000, 121000)).toBe("12:00");
});
