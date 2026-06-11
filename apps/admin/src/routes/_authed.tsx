import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { authClient } from "../lib/auth";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (!session) throw redirect({ to: "/login" });
    if (session.user.role !== "admin") throw redirect({ to: "/login" });
    return { user: session.user };
  },
  component: () => <Outlet />,
});
