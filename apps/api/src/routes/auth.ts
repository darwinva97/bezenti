import { Hono } from "hono";
import { createAuth } from "@bezenti/auth/server";
import { createDb } from "@bezenti/db";
import type { Env } from "../env";
import { sendResetPasswordEmail } from "../lib/mailer";

export const authRouter = new Hono<{ Bindings: Env }>();

// better-auth maneja todas las rutas bajo /api/auth/*
// incluyendo: sign-in, sign-up, sign-out, session, admin.*, request/reset-password
authRouter.all("/*", async (c) => {
  const db   = createDb(c.env.DB);
  const auth = createAuth(db, {
    baseUrl:        c.env.BETTER_AUTH_URL,
    trustedOrigins: c.env.TRUSTED_ORIGINS?.split(",") ?? [],
    // El correo de "olvidé mi contraseña" sale por SMTP (Stalwart). El nombre
    // de la app se infiere del destino (callbackURL embebido en la URL) para
    // que el mensaje diga "Administración" o no, según el panel de origen.
    sendResetPassword: async ({ user, url }) => {
      // El callbackURL viaja URL-encoded dentro de `url`; basta con detectar el
      // host del panel de origen (admin.* vs panel.*) para el texto del correo.
      const appName = /admin\.bezenti\.com/.test(url) ? "Bezenti · Administración" : "Bezenti";
      await sendResetPasswordEmail(c.env, { to: user.email, userName: user.name, url, appName });
    },
  });

  return auth.handler(c.req.raw);
});
