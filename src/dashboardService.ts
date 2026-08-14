import { DeskThing } from "@deskthing/client";
import type { SocketData } from "@deskthing/types";
import { createDashboardClock } from "../shared/clock";
import type {
  DashboardAction,
  DashboardEntity,
  DashboardPayload,
} from "../shared/dashboard";

export type { DashboardEntity, DashboardPayload, EntityDomain } from "../shared/dashboard";

type DashboardListener = (payload: DashboardPayload) => void;

const mockMode = import.meta.env.VITE_HA_DASHBOARD_MOCK === "1";
const mockEntities: DashboardEntity[] = [
  {
    entityId: "light.office_light",
    domain: "light",
    name: "Office Light",
    state: "on",
    available: true,
    active: true,
  },
  {
    entityId: "switch.bedroom_plug",
    domain: "switch",
    name: "Bedroom Plug",
    state: "off",
    available: true,
    active: false,
  },
  {
    entityId: "scene.night",
    domain: "scene",
    name: "Night",
    state: "unknown",
    available: true,
    active: false,
  },
];

let mockListener: DashboardListener | undefined;
const mockTimers = new Set<number>();

function getMockPayload(pendingEntityIds: string[] = []): DashboardPayload {
  return {
    lightMode: false,
    clock: createDashboardClock(),
    entities: mockEntities.map((entity) => ({ ...entity })),
    pendingEntityIds,
  };
}

function isDashboardPayload(value: unknown): value is DashboardPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<DashboardPayload>;
  return (
    Array.isArray(payload.entities) &&
    payload.entities.every((entity) => (
      typeof entity?.entityId === "string" &&
      typeof entity?.name === "string" &&
      typeof entity?.state === "string" &&
      typeof entity?.active === "boolean" &&
      typeof entity?.available === "boolean" &&
      (entity?.domain === "light" || entity?.domain === "switch" || entity?.domain === "scene")
    )) &&
    typeof payload.lightMode === "boolean" &&
    typeof payload.clock?.hours === "number" &&
    typeof payload.clock?.minutes === "number" &&
    Array.isArray(payload.pendingEntityIds)
  );
}

export const dashboardService = {
  subscribe(listener: DashboardListener): () => void {
    if (mockMode) {
      mockListener = listener;
      listener(getMockPayload());
      return () => {
        mockListener = undefined;
        for (const timer of mockTimers) window.clearTimeout(timer);
        mockTimers.clear();
      };
    }

    return DeskThing.on("entities", (data: SocketData) => {
      if (isDashboardPayload(data.payload)) {
        listener(data.payload);
      }
    });
  },

  requestEntities(): void {
    if (mockMode) {
      mockListener?.(getMockPayload());
      return;
    }
    DeskThing.send({ type: "get", request: "entities" });
  },

  activateEntity(entityId: string, expectedActive?: boolean): void {
    const action: DashboardAction = { entityId, expectedActive };
    if (!mockMode) {
      DeskThing.send({ type: "set", request: "activate-entity", payload: action });
      return;
    }

    const entity = mockEntities.find((item) => item.entityId === entityId);
    if (!entity) return;

    mockListener?.(getMockPayload([entityId]));
    const timer = window.setTimeout(() => {
      mockTimers.delete(timer);
      if (entity.domain !== "scene" && typeof expectedActive === "boolean") {
        entity.active = expectedActive;
        entity.state = expectedActive ? "on" : "off";
      }
      mockListener?.(getMockPayload());
    }, 150);
    mockTimers.add(timer);
  },
};
