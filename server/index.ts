import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DeskThing } from "@deskthing/server";
import { DESKTHING_EVENTS, SETTING_TYPES } from "@deskthing/types";
import { createDashboardClock } from "../shared/clock";
import type {
  DashboardAction,
  DashboardEntity,
  DashboardPayload,
  EntityDomain,
} from "../shared/dashboard";
import {
  applyPendingState,
  mapWithConcurrency,
  mergeSettings,
  type DashboardSettings,
  type PendingEntityState,
  type SettingsPayload,
} from "./core";

type HomeAssistantState = {
  entity_id: string;
  state: string;
  attributes?: {
    friendly_name?: string;
  };
};

type PendingAction = PendingEntityState & {
  timeout: ReturnType<typeof setTimeout>;
  operation: symbol;
};

const tokenPath = join(homedir(), ".config", "home-assistant", "token");
const pollIntervalMs = 5000;
const requestTimeoutMs = 5000;
const optimisticTimeoutMs = requestTimeoutMs * 2 + 1000;
const requestConcurrency = 4;
const maximumConcurrentActions = 2;
const supportedDomains = new Set<EntityDomain>(["light", "switch", "scene"]);

let settings: DashboardSettings = {
  entityIds: [],
  homeAssistantUrl: "",
  lightMode: false,
};
let running = false;
let lifecycleGeneration = 0;
let pollInterval: ReturnType<typeof setInterval> | undefined;
let tokenPromise: Promise<string> | undefined;
let requestInFlight = false;
let refreshQueued = false;
let stateRevision = 0;

const activeRequests = new Set<AbortController>();
const pendingActions = new Map<string, PendingAction>();
const activeActions = new Map<string, symbol>();

function getDomain(entityId: string): EntityDomain | undefined {
  const domain = entityId.split(".", 1)[0] as EntityDomain;
  return supportedDomains.has(domain) ? domain : undefined;
}

function getFallbackName(entityId: string): string {
  const objectId = entityId.split(".", 2)[1] ?? entityId;
  return objectId
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function clearPendingAction(entityId: string, operation?: symbol): void {
  const pending = pendingActions.get(entityId);
  if (!pending || (operation && pending.operation !== operation)) {
    return;
  }

  clearTimeout(pending.timeout);
  pendingActions.delete(entityId);
}

function setPendingAction(entityId: string, expectedActive: boolean, operation: symbol): void {
  clearPendingAction(entityId);
  const expiresAt = Date.now() + optimisticTimeoutMs;
  const timeout = setTimeout(() => {
    if (pendingActions.get(entityId)?.operation !== operation) {
      return;
    }
    pendingActions.delete(entityId);
    stateRevision += 1;
    void publishEntities();
  }, optimisticTimeoutMs);

  pendingActions.set(entityId, { expectedActive, expiresAt, timeout, operation });
}

function clearAllPendingActions(): void {
  for (const entityId of pendingActions.keys()) {
    clearPendingAction(entityId);
  }
}

async function getToken(): Promise<string> {
  if (!tokenPromise) {
    tokenPromise = readFile(tokenPath, "utf8").then((token) => {
      const trimmedToken = token.trim();
      if (!trimmedToken) {
        throw new Error("home assistant token is empty");
      }
      return trimmedToken;
    });
  }

  return tokenPromise;
}

async function requestHomeAssistant(path: string, init?: RequestInit): Promise<Response> {
  const homeAssistantUrl = settings.homeAssistantUrl;
  if (!running || !homeAssistantUrl) {
    throw new Error("home assistant url is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  activeRequests.add(controller);

  try {
    const token = await getToken();
    if (controller.signal.aborted || !running || settings.homeAssistantUrl !== homeAssistantUrl) {
      throw new Error("home assistant request was cancelled");
    }

    const response = await fetch(`${homeAssistantUrl}${path}`, {
      ...init,
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`home assistant request failed with status ${response.status}`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
    activeRequests.delete(controller);
  }
}

async function getEntity(entityId: string): Promise<DashboardEntity> {
  const domain = getDomain(entityId) ?? "switch";

  try {
    const response = await requestHomeAssistant(`/api/states/${encodeURIComponent(entityId)}`);
    const homeAssistantState = (await response.json()) as HomeAssistantState;
    return {
      entityId,
      domain,
      name: homeAssistantState.attributes?.friendly_name ?? getFallbackName(entityId),
      state: homeAssistantState.state,
      active: homeAssistantState.state === "on",
      available:
        homeAssistantState.state !== "unavailable" &&
        (domain === "scene" || homeAssistantState.state !== "unknown"),
    };
  } catch {
    return {
      entityId,
      domain,
      name: getFallbackName(entityId),
      state: "unavailable",
      active: false,
      available: false,
    };
  }
}

async function publishEntities(): Promise<void> {
  if (!running) {
    return;
  }

  refreshQueued = true;
  if (requestInFlight) {
    return;
  }

  requestInFlight = true;
  try {
    while (running && refreshQueued) {
      refreshQueued = false;
      const generation = lifecycleGeneration;
      const revision = stateRevision;
      const entityIds = [...settings.entityIds];
      const entities = await mapWithConcurrency(entityIds, requestConcurrency, getEntity);

      if (!running || generation !== lifecycleGeneration) {
        return;
      }

      if (revision !== stateRevision) {
        refreshQueued = true;
        continue;
      }

      const now = Date.now();
      const displayedEntities = entities.map((entity) => {
        const pending = pendingActions.get(entity.entityId);
        const result = applyPendingState(entity, pending, now);
        if (result.confirmed || result.expired) {
          clearPendingAction(entity.entityId);
        }
        return result.entity;
      });

      const payload: DashboardPayload = {
        entities: displayedEntities,
        lightMode: settings.lightMode,
        clock: createDashboardClock(),
        pendingEntityIds: [...new Set([...pendingActions.keys(), ...activeActions.keys()])],
      };

      DeskThing.send({ type: "entities", payload });
    }
  } finally {
    requestInFlight = false;
    if (running && refreshQueued) {
      void publishEntities();
    }
  }
}

function applySettings(appSettings: SettingsPayload): void {
  const previousEntityIds = settings.entityIds;
  settings = mergeSettings(settings, appSettings);

  const configuredEntities = new Set(settings.entityIds);
  for (const entityId of pendingActions.keys()) {
    if (!configuredEntities.has(entityId)) {
      clearPendingAction(entityId);
    }
  }

  if (
    previousEntityIds !== settings.entityIds ||
    Object.prototype.hasOwnProperty.call(appSettings, "home_assistant_url") ||
    Object.prototype.hasOwnProperty.call(appSettings, "light_mode")
  ) {
    stateRevision += 1;
    void publishEntities();
  }
}

async function callService(
  domain: EntityDomain,
  service: "turn_on" | "turn_off",
  entityId: string,
): Promise<void> {
  await requestHomeAssistant(`/api/services/${domain}/${service}`, {
    method: "POST",
    body: JSON.stringify({ entity_id: entityId }),
  });
}

async function handleAction(action: DashboardAction): Promise<void> {
  const entityId = typeof action.entityId === "string" ? action.entityId.trim().toLowerCase() : "";
  if (!settings.entityIds.includes(entityId)) {
    return;
  }

  const domain = getDomain(entityId);
  if (
    !running ||
    !domain ||
    pendingActions.has(entityId) ||
    activeActions.has(entityId) ||
    activeActions.size >= maximumConcurrentActions
  ) {
    return;
  }

  if (domain !== "scene" && typeof action.expectedActive !== "boolean") {
    return;
  }

  const operation = Symbol(entityId);
  const generation = lifecycleGeneration;
  activeActions.set(entityId, operation);
  if (domain !== "scene") {
    setPendingAction(entityId, action.expectedActive as boolean, operation);
  }
  stateRevision += 1;
  void publishEntities();

  try {
    const service = domain === "scene" || action.expectedActive ? "turn_on" : "turn_off";
    await callService(domain, service, entityId);
  } catch {
    if (generation === lifecycleGeneration) {
      clearPendingAction(entityId, operation);
      stateRevision += 1;
      console.error("home assistant entity action failed");
    }
  } finally {
    if (activeActions.get(entityId) === operation) {
      activeActions.delete(entityId);
    }
    if (running && generation === lifecycleGeneration) {
      void publishEntities();
    }
  }
}

async function start(): Promise<void> {
  if (running) {
    return;
  }

  running = true;
  lifecycleGeneration += 1;
  const generation = lifecycleGeneration;
  tokenPromise = undefined;

  try {
    await DeskThing.initSettings({
      entities: {
        id: "entities",
        label: "Entity IDs",
        type: SETTING_TYPES.LIST,
        value: [],
        description: "Home Assistant entity IDs, shown in this order",
        unique: true,
        orderable: true,
        options: [],
      },
      home_assistant_url: {
        id: "home_assistant_url",
        label: "Home Assistant URL",
        type: SETTING_TYPES.STRING,
        value: "",
        description: "Base URL, for example http://homeassistant.local:8123",
      },
      light_mode: {
        id: "light_mode",
        label: "Light mode",
        type: SETTING_TYPES.BOOLEAN,
        value: false,
        description: "Use the light dashboard theme",
      },
    });

    if (!running || generation !== lifecycleGeneration) {
      return;
    }

    const savedSettings = await DeskThing.getSettings();
    if (!running || generation !== lifecycleGeneration) {
      return;
    }

    if (savedSettings) {
      applySettings(savedSettings as SettingsPayload);
    }

    await publishEntities();
    if (running && generation === lifecycleGeneration) {
      pollInterval = setInterval(() => void publishEntities(), pollIntervalMs);
    }
  } catch {
    if (running && generation === lifecycleGeneration) {
      console.error("home assistant dashboard failed to start");
      stop();
    }
  }
}

function stop(): void {
  running = false;
  lifecycleGeneration += 1;
  refreshQueued = false;

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = undefined;
  }

  for (const controller of activeRequests) {
    controller.abort();
  }
  activeRequests.clear();
  clearAllPendingActions();
  activeActions.clear();
  tokenPromise = undefined;
}

DeskThing.on(DESKTHING_EVENTS.SETTINGS, (appSettings) => {
  const settingsEvent = appSettings as unknown as { payload?: SettingsPayload };
  if (settingsEvent.payload) {
    applySettings(settingsEvent.payload);
  }
});

DeskThing.on("set", (data) => {
  const actionData = data as unknown as { request?: string; payload?: DashboardAction };
  if (actionData.request === "activate-entity" && actionData.payload) {
    void handleAction(actionData.payload);
  }
});

DeskThing.on("get", (data) => {
  const requestData = data as unknown as { request?: string };
  if (requestData.request === "entities") {
    void publishEntities();
  }
});

DeskThing.on(DESKTHING_EVENTS.START, () => {
  void start();
});

DeskThing.on(DESKTHING_EVENTS.STOP, stop);
