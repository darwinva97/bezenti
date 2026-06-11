import { createClient } from "@bezenti/auth/client";

export const authClient = createClient(
  import.meta.env["VITE_API_URL"] ?? "http://localhost:8787",
);
