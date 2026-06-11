import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import type { Db } from "@bezenti/db";
import * as schema from "@bezenti/db/schema";

export type AuthInstance = ReturnType<typeof createAuth>;

export function createAuth(db: Db, options?: {
  trustedOrigins?: string[];
  baseUrl?: string;
}) {
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
