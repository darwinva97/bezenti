import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { authClient } from "../lib/auth";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession();
    if (!session) throw redirect({ to: "/login" });
    if (
      location.pathname.startsWith("/admin") &&
      session.user.role !== "admin"
    ) {
      throw redirect({ to: "/portal" });
    }
    return { user: session.user };
  },
  component: () => <Outlet />,
});
