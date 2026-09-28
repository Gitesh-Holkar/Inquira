import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [/^\/login/, /^\/auth\//, /^\/api\//, /^\/\.well-known\//, /^\/_next\//, /^\/favicon/, /^\/icon/, /^\/manifest/];

/** Refreshes the Supabase session cookie and sends signed-out users to /login. */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((re) => re.test(path));
  let response = NextResponse.next({ request });

  const devMode = process.env.AUTH_MODE === "dev" && process.env.NODE_ENV !== "production" && !process.env.VERCEL;
  let signedIn = false;
  if (devMode) {
    signedIn = !!request.cookies.get("inquira_dev_session")?.value;
  } else if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    signedIn = !!data.user;
  }

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Skip all Next internals (static files, image optimiser, dev HMR websocket) and static assets.
  matcher: ["/((?!_next/|favicon.ico|icon.svg|.*\.(?:png|svg|jpg|jpeg|ico|webp|css|js|map)$).*)"],
};
