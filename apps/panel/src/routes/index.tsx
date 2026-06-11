import { createFileRoute, redirect } from "@tanstack/react-router";
import { authClient } from "../lib/auth";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (!session) throw redirect({ to: "/login" });
    if (session.user.role === "admin") throw redirect({ to: "/admin" });
    throw redirect({ to: "/portal" });
  },
});
