import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema/index";

export type Db = ReturnType<typeof createDb>;

// En producción: recibe el binding D1 del Worker.
// En desarrollo:  wrangler dev emula D1 localmente con SQLite de forma
//                 transparente — el código no cambia entre entornos.
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
