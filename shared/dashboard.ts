export type EntityDomain = "light" | "switch" | "scene";

export type DashboardEntity = {
  entityId: string;
  domain: EntityDomain;
  name: string;
  state: string;
  active: boolean;
  available: boolean;
};

export type DashboardClock = {
  hours: number;
  minutes: number;
  weekday: string;
  month: string;
  day: number;
};

export type DashboardPayload = {
  entities: DashboardEntity[];
  lightMode: boolean;
  clock: DashboardClock;
  pendingEntityIds: string[];
};

export type DashboardAction = {
  entityId: string;
  expectedActive?: boolean;
};
