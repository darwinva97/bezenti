import { Hono } from "hono";
import { createAuth } from "@bezenti/auth/server";
import { createDb } from "@bezenti/db";
import type { Env } from "../env";

export const authRouter = new Hono<{ Bindings: Env }>();

// better-auth maneja todas las rutas bajo /api/auth/*
// incluyendo: sign-in, sign-up, sign-out, session, admin.*
authRouter.all("/*", async (c) => {
  const db   = createDb(c.env.DB);
  const auth = createAuth(db, {
    baseUrl:        c.env.BETTER_AUTH_URL,
    trustedOrigins: c.env.TRUSTED_ORIGINS?.split(",") ?? [],
  });

  return auth.handler(c.req.raw);
});
