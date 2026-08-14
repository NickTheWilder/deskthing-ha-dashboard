import { describe, expect, test } from "bun:test";
import type { DashboardEntity } from "../shared/dashboard";
import {
  applyPendingState,
  mapWithConcurrency,
  mergeSettings,
  normalizeEntityIds,
  normalizeHomeAssistantUrl,
  type DashboardSettings,
} from "../server/core";

const settings: DashboardSettings = {
  entityIds: ["light.office"],
  homeAssistantUrl: "http://homeassistant.local:8123",
  lightMode: false,
};

describe("settings", () => {
  test("partial updates preserve unrelated values", () => {
    expect(mergeSettings(settings, { light_mode: { value: true } })).toEqual({
      ...settings,
      lightMode: true,
    });
  });

  test("entity ids are trimmed, normalized, validated, and deduplicated", () => {
    expect(normalizeEntityIds([
      " Light.Office ",
      "light.office",
      "not-an-entity",
      "sensor.temperature",
      42,
      "switch.router",
    ])).toEqual(["light.office", "switch.router"]);
  });
});

describe("home assistant url", () => {
  test("accepts an http or https origin", () => {
    expect(normalizeHomeAssistantUrl(" http://homeassistant.local:8123/ "))
      .toBe("http://homeassistant.local:8123");
    expect(normalizeHomeAssistantUrl("https://example.com"))
      .toBe("https://example.com");
  });

  test.each([
    "file:///tmp/token",
    "http://user:secret@example.com",
    "http://example.com/path",
    "http://example.com?target=other",
    "http://example.com#fragment",
  ])("rejects unsafe input: %s", (url) => {
    expect(() => normalizeHomeAssistantUrl(url)).toThrow();
  });
});

describe("optimistic state", () => {
  const entity: DashboardEntity = {
    entityId: "light.office",
    domain: "light",
    name: "Office",
    state: "off",
    active: false,
    available: false,
  };

  test("an unavailable read does not confirm expected off", () => {
    const result = applyPendingState(entity, { expectedActive: false, expiresAt: 200 }, 100);
    expect(result.confirmed).toBe(false);
    expect(result.entity.available).toBe(true);
  });

  test("only an available matching read confirms the action", () => {
    const result = applyPendingState(
      { ...entity, available: true },
      { expectedActive: false, expiresAt: 200 },
      100,
    );
    expect(result.confirmed).toBe(true);
  });
});

test("bounded mapping preserves order and limits concurrent work", async () => {
  let active = 0;
  let maximumActive = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await Bun.sleep(5);
    active -= 1;
    return value * 2;
  });

  expect(result).toEqual([2, 4, 6, 8, 10]);
  expect(maximumActive).toBe(2);
});
