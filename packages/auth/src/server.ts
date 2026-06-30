import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import type { Db } from "@bezenti/db";
import * as schema from "@bezenti/db/schema";

export type AuthInstance = ReturnType<typeof createAuth>;

export interface ResetPasswordRequest {
  user:  { email: string; name?: string | null };
  url:   string;   // enlace de un solo uso → /api/auth/reset-password/<token>?callbackURL=...
  token: string;
}

export function createAuth(db: Db, options?: {
  trustedOrigins?: string[];
  baseUrl?: string;
  // Transporte de correo inyectado (el paquete auth no conoce SMTP/Stalwart).
  // Sin esto, el flujo de "olvidé mi contraseña" no envía nada.
  sendResetPassword?: (data: ResetPasswordRequest) => Promise<void>;
}) {
  const sendReset = options?.sendResetPassword;

  return betterAuth({
    baseURL:        options?.baseUrl ?? "http://localhost:8787",
    trustedOrigins: options?.trustedOrigins ?? ["http://localhost:3001"],

    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user:         schema.user,
        session:      schema.session,
        account:      schema.account,
        verification: schema.verification,
      },
    }),

    emailAndPassword: {
      enabled:          true,
      requireEmailVerification: false, // habilitar en producción con Resend/etc
      // Flujo "olvidé mi contraseña": better-auth genera el token de un solo
      // uso y nos entrega la URL; el envío real lo hace el transporte inyectado.
      // El token caduca en 1 hora (valor por defecto de better-auth).
      sendResetPassword: sendReset
        ? async ({ user, url, token }) =>
            sendReset({ user: { email: user.email, name: user.name }, url, token })
        : undefined,
    },

    plugins: [
      admin({
        // Solo los usuarios con role "admin" pueden acceder al panel admin.
        // better-auth admin plugin gestiona: ban, impersonation, role changes.
        defaultRole: "user",
        adminRoles:  ["admin"],
      }),
    ],

    session: {
      expiresIn:          60 * 60 * 24 * 7,  // 7 días
      updateAge:          60 * 60 * 24,       // renovar si tiene >1 día de antigüedad
      cookieCache: {
        enabled:   true,
        maxAge:    5 * 60,                    // cache de sesión 5 min en cookie
      },
    },

    user: {
      additionalFields: {
        // No se necesitan campos extra en user — toda la info de hosting
        // vive en la tabla `clients` relacionada.
      },
    },
  });
}
