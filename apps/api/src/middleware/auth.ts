// Tipos que better-auth retorna en getSession() — todos los campos opcionales son
// `T | null | undefined` porque el adapter no garantiza non-null en runtime.
export type BAuthUser = {
  id:            string;
  name:          string;
  email:         string;
  emailVerified: boolean;
  image?:        string | null;
  createdAt:     Date;
  updatedAt:     Date;
  role?:         string | null;
  banned?:       boolean | null;
  banReason?:    string | null;
  banExpires?:   Date | null;
};

export type BAuthSession = {
  id:               string;
  userId:           string;
  token:            string;
  expiresAt:        Date;
  createdAt:        Date;
  updatedAt:        Date;
  ipAddress?:       string | null;
  userAgent?:       string | null;
  impersonatedBy?:  string | null;
};

declare module "hono" {
  interface ContextVariableMap {
    user:    BAuthUser;
    session: BAuthSession;
  }
}
