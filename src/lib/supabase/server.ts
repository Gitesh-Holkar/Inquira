import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function supabaseConfigured() {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Supabase client bound to the request cookies (Server Components, actions, route handlers). */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes cookies instead.
        }
      },
    },
  });
}
