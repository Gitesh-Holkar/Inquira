/**
 * File storage adapter (GOAL G-PLT-6). Cloud: the private Supabase Storage bucket `documents`
 * (migration 0002), reached with the service role key from the server only. Local and development:
 * a folder on disk. Chosen by FILE_STORAGE (`supabase` | `disk`); without it, Supabase when its URL
 * and service role key are set, else disk outside deployed builds, else none (the Documents screen
 * then says what to set). Keys look like `<org id>/<document id>.<ext>`.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";

export type FileStore = {
  kind: "supabase" | "disk";
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
};

/** Document files: `<company id>/<file id>.<ext>`. Backups: `backups/<company id>/<time stamp>.json.gz`. No dots or slashes beyond these. */
const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/;
const BACKUP_KEY = /^backups\/[0-9a-f-]{36}\/[0-9A-Z-]{10,40}\.json\.gz$/;
function checkKey(key: string) {
  if (!KEY.test(key) && !BACKUP_KEY.test(key)) throw new AppError("VALIDATION", "Invalid file key");
}

export function diskStore(dir: string): FileStore {
  const full = (key: string) => {
    checkKey(key);
    return path.join(dir, ...key.split("/"));
  };
  return {
    kind: "disk",
    async put(key, data) {
      const p = full(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, data, { flag: "wx" }); // never overwrite
    },
    async get(key) {
      const p = full(key); // a bad key is refused, not reported as missing
      try {
        return new Uint8Array(await readFile(p));
      } catch {
        throw new AppError("NOT_FOUND", "The file is missing from storage");
      }
    },
    async remove(key) {
      await rm(full(key), { force: true });
    },
  };
}

export function supabaseStore(cfg: { url: string; serviceKey: string; bucket?: string }, f: typeof fetch = fetch): FileStore {
  const base = `${cfg.url.replace(/\/$/, "")}/storage/v1/object`;
  const bucket = cfg.bucket ?? "documents";
  const auth = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}` };
  const fail = async (what: string, res: Response) => new AppError("INTEGRATION", `File storage could not ${what} the file (${res.status}). ${(await res.text()).slice(0, 120)}`);
  return {
    kind: "supabase",
    async put(key, data, contentType) {
      checkKey(key);
      const res = await f(`${base}/${bucket}/${key}`, { method: "POST", headers: { ...auth, "Content-Type": contentType, "x-upsert": "false" }, body: new Blob([data as BlobPart], { type: contentType }) });
      if (!res.ok) throw await fail("save", res);
    },
    async get(key) {
      checkKey(key);
      const res = await f(`${base}/${bucket}/${key}`, { headers: auth });
      if (res.status === 404 || res.status === 400) throw new AppError("NOT_FOUND", "The file is missing from storage");
      if (!res.ok) throw await fail("read", res);
      return new Uint8Array(await res.arrayBuffer());
    },
    async remove(key) {
      checkKey(key);
      const res = await f(`${base}/${bucket}`, { method: "DELETE", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [key] }) });
      if (!res.ok) throw await fail("remove", res);
    },
  };
}

/** Which store this deployment uses, or null when none is set up. */
export function fileStoreKind(): FileStore["kind"] | null {
  const e = env();
  if (e.FILE_STORAGE) return e.FILE_STORAGE;
  if (e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY) return "supabase";
  if (e.NODE_ENV !== "production" && !e.VERCEL) return "disk";
  return null;
}

export function fileStore(): FileStore | null {
  const e = env();
  switch (fileStoreKind()) {
    case "supabase":
      if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) return null;
      return supabaseStore({ url: e.NEXT_PUBLIC_SUPABASE_URL, serviceKey: e.SUPABASE_SERVICE_ROLE_KEY });
    case "disk":
      // A folder chosen at run time; the comment keeps the bundler from packing the whole project.
      return diskStore(path.resolve(/*turbopackIgnore: true*/ e.FILE_STORAGE_DIR ?? ".data/files"));
    default:
      return null;
  }
}
