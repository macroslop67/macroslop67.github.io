import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { GroupPage } from "../features/groups/GroupPage";
import { HomePage } from "../features/home/HomePage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { ThreadPage } from "../features/threads/ThreadPage";
import { AppShell } from "./AppShell";

const rootRoute = createRootRoute({
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/home" });
  },
  component: () => null,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/home",
  component: HomePage,
});

const groupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/groups/$groupId",
  component: GroupRoute,
});

function GroupRoute() {
  const { groupId } = groupRoute.useParams();
  return <GroupPage groupId={groupId} />;
}

const threadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/threads/$threadId",
  component: ThreadRoute,
});

function ThreadRoute() {
  const { threadId } = threadRoute.useParams();
  return <ThreadPage threadId={threadId} />;
}

const legacyThreadsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/threads",
  beforeLoad: () => {
    throw redirect({ to: "/home" });
  },
  component: () => null,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: SettingsPage,
});

const legacySettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  beforeLoad: () => {
    throw redirect({ to: "/login" });
  },
  component: () => null,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  homeRoute,
  groupRoute,
  threadRoute,
  legacyThreadsRoute,
  loginRoute,
  legacySettingsRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
