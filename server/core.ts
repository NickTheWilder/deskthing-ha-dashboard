import type { DashboardEntity } from "../shared/dashboard";

export type DashboardSettings = {
  entityIds: string[];
  homeAssistantUrl: string;
  lightMode: boolean;
};

export type SettingsPayload = {
  entities?: { value?: unknown };
  home_assistant_url?: { value?: unknown };
  light_mode?: { value?: unknown };
};

export type PendingEntityState = {
  expectedActive: boolean;
  expiresAt: number;
};

const entityIdPattern = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const maximumEntityIdLength = 255;
const supportedDomains = new Set(["light", "switch", "scene"]);

export function normalizeEntityIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const entityIds: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const entityId = entry.trim().toLowerCase();
    const domain = entityId.split(".", 1)[0];
    if (
      entityId.length === 0 ||
      entityId.length > maximumEntityIdLength ||
      !entityIdPattern.test(entityId) ||
      !supportedDomains.has(domain) ||
      seen.has(entityId)
    ) {
      continue;
    }

    seen.add(entityId);
    entityIds.push(entityId);
  }

  return entityIds;
}

export function normalizeHomeAssistantUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }

  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("home assistant url must use http or https");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("home assistant url cannot contain credentials, a query, or a fragment");
  }

  if (url.pathname !== "/") {
    throw new Error("home assistant url cannot contain a path");
  }

  return url.origin;
}

export function mergeSettings(
  current: DashboardSettings,
  payload: SettingsPayload,
): DashboardSettings {
  const next = { ...current };

  if (Object.prototype.hasOwnProperty.call(payload, "entities")) {
    next.entityIds = normalizeEntityIds(payload.entities?.value);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "home_assistant_url")) {
    try {
      next.homeAssistantUrl = normalizeHomeAssistantUrl(payload.home_assistant_url?.value);
    } catch {
      next.homeAssistantUrl = "";
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "light_mode")) {
    next.lightMode = payload.light_mode?.value === true;
  }

  return next;
}

export function applyPendingState(
  entity: DashboardEntity,
  pending: PendingEntityState | undefined,
  now: number,
): { entity: DashboardEntity; confirmed: boolean; expired: boolean } {
  if (!pending) {
    return { entity, confirmed: false, expired: false };
  }

  if (entity.available && entity.active === pending.expectedActive) {
    return { entity, confirmed: true, expired: false };
  }

  if (now >= pending.expiresAt) {
    return { entity, confirmed: false, expired: true };
  }

  return {
    entity: {
      ...entity,
      active: pending.expectedActive,
      state: pending.expectedActive ? "on" : "off",
      available: true,
    },
    confirmed: false,
    expired: false,
  };
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) {
    return [];
  }

  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
