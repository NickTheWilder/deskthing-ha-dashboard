import { useEffect, useState } from "react";
import { dashboardService } from "./dashboardService";
import type { DashboardClock, DashboardEntity } from "../shared/dashboard";
import { formatDashboardTime } from "../shared/clock";

type ClockState = DashboardClock & {
  receivedAt: number;
};

type PendingAction = {
  entityId: string;
  startedAt: number;
};

const pendingTimeoutMs = 12000;
const stalePayloadMs = 12000;

function EntityIcon({ entity }: { entity: DashboardEntity }) {
  if (entity.domain === "scene") {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M17.5,12A1.5,1.5 0 0,1 16,10.5A1.5,1.5 0 0,1 17.5,9A1.5,1.5 0 0,1 19,10.5A1.5,1.5 0 0,1 17.5,12M14.5,8A1.5,1.5 0 0,1 13,6.5A1.5,1.5 0 0,1 14.5,5A1.5,1.5 0 0,1 16,6.5A1.5,1.5 0 0,1 14.5,8M9.5,8A1.5,1.5 0 0,1 8,6.5A1.5,1.5 0 0,1 9.5,5A1.5,1.5 0 0,1 11,6.5A1.5,1.5 0 0,1 9.5,8M6.5,12A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,1 6.5,9A1.5,1.5 0 0,1 8,10.5A1.5,1.5 0 0,1 6.5,12M12,3A9,9 0 0,0 3,12A9,9 0 0,0 12,21A1.5,1.5 0 0,0 13.5,19.5C13.5,19.11 13.35,18.76 13.11,18.5C12.88,18.23 12.73,17.88 12.73,17.5A1.5,1.5 0 0,1 14.23,16H16A5,5 0 0,0 21,11C21,6.58 16.97,3 12,3Z" />
      </svg>
    );
  }

  if (entity.domain === "switch") {
    return (
      <svg viewBox="0 0 24 24">
        <path d={entity.active
          ? "M18.4 1.6C18 1.2 17.5 1 17 1H7C6.5 1 6 1.2 5.6 1.6C5.2 2 5 2.5 5 3V21C5 21.5 5.2 22 5.6 22.4C6 22.8 6.5 23 7 23H17C17.5 23 18 22.8 18.4 22.4C18.8 22 19 21.5 19 21V3C19 2.5 18.8 2 18.4 1.6M16 7C16 7.6 15.6 8 15 8H9C8.4 8 8 7.6 8 7V5C8 4.4 8.4 4 9 4H15C15.6 4 16 4.4 16 5V7Z"
          : "M5.6 1.6C6 1.2 6.5 1 7 1H17C17.5 1 18 1.2 18.4 1.6C18.8 2 19 2.5 19 3V21C19 21.5 18.8 22 18.4 22.4C18 22.8 17.5 23 17 23H7C6.5 23 6 22.8 5.6 22.4C5.2 22 5 21.5 5 21V3C5 2.5 5.2 2 5.6 1.6M8 3C7.4 3 7 3.4 7 4V20C7 20.6 7.4 21 8 21H16C16.6 21 17 20.6 17 20V4C17 3.4 16.6 3 16 3H8M8 17C8 16.4 8.4 16 9 16H15C15.6 16 16 16.4 16 17V19C16 19.6 15.6 20 15 20H9C8.4 20 8 19.6 8 19V17Z"} />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24">
      <path d={entity.active
        ? "M12,2A7,7 0 0,0 5,9C5,11.38 6.19,13.47 8,14.74V17A1,1 0 0,0 9,18H15A1,1 0 0,0 16,17V14.74C17.81,13.47 19,11.38 19,9A7,7 0 0,0 12,2M9,21A1,1 0 0,0 10,22H14A1,1 0 0,0 15,21V20H9V21Z"
        : "M12,2C9.76,2 7.78,3.05 6.5,4.68L16.31,14.5C17.94,13.21 19,11.24 19,9A7,7 0 0,0 12,2M3.28,4L2,5.27L5.04,8.3C5,8.53 5,8.76 5,9C5,11.38 6.19,13.47 8,14.74V17A1,1 0 0,0 9,18H14.73L18.73,22L20,20.72L3.28,4M9,20V21A1,1 0 0,0 10,22H14A1,1 0 0,0 15,21V20H9Z"} />
    </svg>
  );
}

function statusText(entity: DashboardEntity, pending: boolean): string {
  if (pending && entity.domain === "scene") return "Activating...";
  if (!entity.available) return "Unavailable";
  if (entity.domain === "scene") return "Tap to activate";
  return entity.active ? "On" : "Off";
}

export default function App() {
  const [entities, setEntities] = useState<DashboardEntity[]>([]);
  const [lightMode, setLightMode] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>();
  const [clock, setClock] = useState<ClockState>();
  const [now, setNow] = useState(() => Date.now());
  const [lastPayloadAt, setLastPayloadAt] = useState<number>();

  useEffect(() => {
    const removeListener = dashboardService.subscribe((payload) => {
      const receivedAt = Date.now();
      setEntities(payload.entities);
      setLightMode(payload.lightMode);
      setClock({ ...payload.clock, receivedAt });
      setNow(receivedAt);
      setLastPayloadAt(receivedAt);
      setPendingAction((currentAction) => {
        if (!currentAction) return undefined;
        const pendingEntityIds = payload.pendingEntityIds ?? [];
        return pendingEntityIds.includes(currentAction.entityId) ? currentAction : undefined;
      });
    });
    const clockInterval = window.setInterval(() => setNow(Date.now()), 1000);

    dashboardService.requestEntities();
    return () => {
      removeListener();
      window.clearInterval(clockInterval);
    };
  }, []);

  useEffect(() => {
    if (pendingAction && now - pendingAction.startedAt >= pendingTimeoutMs) {
      setPendingAction(undefined);
    }
  }, [now, pendingAction]);

  const activate = (entity: DashboardEntity) => {
    if (pendingAction || !entity.available) return;
    setPendingAction({ entityId: entity.entityId, startedAt: Date.now() });
    const expectedActive = entity.domain === "scene" ? undefined : !entity.active;
    if (entity.domain !== "scene") {
      setEntities((currentEntities) => currentEntities.map((currentEntity) => {
        if (currentEntity.entityId !== entity.entityId) return currentEntity;
        const active = expectedActive as boolean;
        return { ...currentEntity, active, state: active ? "on" : "off" };
      }));
    }
    dashboardService.activateEntity(entity.entityId, expectedActive);
  };

  const availableCount = entities.filter((entity) => entity.available).length;
  const connected = lastPayloadAt !== undefined && now - lastPayloadAt < stalePayloadMs;
  const connectionLive = connected && entities.length > 0 && availableCount === entities.length;
  const connectionText = entities.length === 0
    ? "No entities"
    : !connected
      ? "Disconnected"
      : availableCount === entities.length
      ? "Connected"
      : `${availableCount}/${entities.length} available`;

  return (
    <main className={`dashboard ${lightMode ? "light-mode" : ""}`}>
      <header className="app-bar">
        <span className="app-title">
          <svg className="ha-logo" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.939 10.627 13.061.749a1.505 1.505 0 0 0-2.121 0l-9.879 9.878C.478 11.21 0 12.363 0 13.187v9c0 .826.675 1.5 1.5 1.5h9.227l-4.063-4.062a2.034 2.034 0 0 1-.664.113c-1.13 0-2.05-.92-2.05-2.05s.92-2.05 2.05-2.05 2.05.92 2.05 2.05c0 .233-.041.456-.113.665l3.163 3.163V9.928a2.05 2.05 0 0 1-1.15-1.84c0-1.13.92-2.05 2.05-2.05s2.05.92 2.05 2.05a2.05 2.05 0 0 1-1.15 1.84v8.127l3.146-3.146A2.051 2.051 0 0 1 18 12.239c1.13 0 2.05.92 2.05 2.05s-.92 2.05-2.05 2.05c-.25 0-.488-.047-.709-.13L12.9 20.602v3.088h9.6c.825 0 1.5-.675 1.5-1.5v-9c0-.825-.477-1.977-1.061-2.561z" />
          </svg>
          <span>Home Assistant</span>
        </span>
        <span className="clock">{formatDashboardTime(clock, clock?.receivedAt ?? now, now)}</span>
      </header>

      <section className="content">
        <div className="section-heading">
          <span>Home</span>
          <span className={connectionLive ? "connection live" : "connection"}>
            {connectionText}
          </span>
        </div>

        {entities.length ? (
          <div className="entity-grid">
            {entities.map((entity) => {
              const pending = pendingAction?.entityId === entity.entityId;
              return (
                <button
                  className={`entity-card domain-${entity.domain} ${entity.active ? "entity-card-on" : ""}`}
                  type="button"
                  key={entity.entityId}
                  onClick={() => activate(entity)}
                  disabled={!entity.available}
                >
                  <span className="entity-icon" aria-hidden="true">
                    <EntityIcon entity={entity} />
                  </span>
                  <span className="entity-copy">
                    <span className="entity-name">{entity.name}</span>
                    <span className={`entity-state ${entity.available ? "" : "state-offline"}`}>
                      {statusText(entity, pending)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <strong>No entities configured</strong>
            <span>Add Home Assistant entity IDs in this app's settings.</span>
          </div>
        )}
      </section>
    </main>
  );
}
