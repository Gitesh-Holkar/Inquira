# Running Inquira on your own computer

Local mode (GOAL G-PLT-5): the whole app on one computer, with one command. It has its own database, its own sign-in (email and password), its own scheduler, and keeps uploaded documents on disk. Nothing needs Supabase or Vercel.

For the cloud version, see [`SETUP.md`](SETUP.md).

## What you need

- **Docker Desktop** (Windows or Mac) or Docker Engine with the Compose plugin (Linux). Install it once from docker.com and start it.
- About 3 GB of free disk space.
- This repository, either downloaded as a ZIP from GitHub (Code → Download ZIP) or with `git clone https://github.com/Gitesh-Holkar/Inquira`.

## Start it

Open a terminal in the Inquira folder and run:

```bash
docker compose up -d
```

The first start builds Inquira and takes a few minutes. Then open **http://localhost:3000**.

The first time, the page says **Create the owner account**. Enter your email and a password (at least 10 characters). That account owns this Inquira; nobody else can use this screen afterwards.

By default you see a **fictional example company** (Example Ingredients Pvt. Ltd.) so you can try everything safely. To make it yours, rename it under **Settings → Organisation → Company name**, delete the example products on **Rates** (the bin on each row) and add your own, or start with your own data folder as below.

## Use your own company's data

Your company's products, prices and terms live in a folder under `seed/`. To start with them instead of the example, before the **first** start create a file named `.env` in the Inquira folder with:

```
SEED_DIR=seed/stdm
```

If you already started with the example data, start over (this deletes everything in this local copy):

```bash
docker compose down -v
docker compose up -d
```

## Everyday use

| To | Do |
| --- | --- |
| Stop Inquira | `docker compose stop` |
| Start it again | `docker compose start` (or `docker compose up -d`) |
| See what it is doing | `docker compose logs -f app` |
| Update to a newer version | `git pull` (or download the ZIP again), then `docker compose up -d --build`. Database changes are applied on start. |
| Add a teammate | Settings → Members → Add member. Inquira shows a one-time link; send it to them. They open it, choose a password and are signed in. The link works once, for 7 days. |
| Someone forgot their password | Settings → Members → **Sign-in link** next to their name. |
| You (the owner) forgot your password | On the computer running Inquira: `docker compose exec app npm run local:sign-in-link -- you@example.com`, then open the link it prints. |

Inquira is reachable only from this computer (`localhost`). To let others in your office use it, change `127.0.0.1:3000:3000` to `3000:3000` under `ports` in `docker-compose.yml`, set `APP_URL=http://<this computer's address>:3000` in `.env`, and run `docker compose up -d` again. Do this only on a network you trust: local mode uses plain http.

## Where your data is

Docker keeps two volumes:

- `inquira_db`: the database (leads, rates, quotations, members).
- `inquira_data`: uploaded documents (`/data/files`) and the keys file `/data/secrets.env`.

`secrets.env` holds the key that encrypts saved Gmail and TradeIndia credentials and the key the scheduler uses. It is created on the first start. If it is lost, you re-enter those credentials in Settings; nothing else is lost.

**Backups:** Inquira backs itself up every night after 01:00 (while the computer and Docker are on) and keeps 14 days, inside the `inquira_data` volume. That does not protect you if the computer is lost, so once a week open **Settings → Backups → Download** and keep the file on another drive or a cloud folder. To restore one, follow [`RUNBOOK.md`](RUNBOOK.md) section 5.2.

For a full copy of both volumes (database and files, including the keys file), use Docker Desktop's volume export, or:

```bash
docker compose exec -T db pg_dump -U postgres inquira > inquira-backup.sql
docker run --rm -v inquira_data:/data -v "$PWD":/backup alpine tar czf /backup/inquira-files.tgz -C /data .
```

`docker compose down -v` **deletes both volumes**. `docker compose down` (without `-v`) keeps them.

## Connections

- **Gmail:** works the same as in the cloud (Settings → Integrations). In Google Cloud, add `http://localhost:3000/api/integrations/gmail/callback` as an authorised redirect URI (or your `APP_URL` with that path).
- **TradeIndia:** the same as in the cloud.
- **Claude connector:** Claude on the web cannot reach `localhost`. Use Claude Code or Claude Desktop on the same computer with `http://localhost:3000/api/mcp`.
- **Sync:** the `worker` service checks for new enquiries every 10 minutes, like the cloud scheduler. Settings → Integrations → Sync now runs it at once.

## How it works

| Part | Cloud | Local |
| --- | --- | --- |
| Database | Supabase Postgres | Postgres 16 container (`db`), with `scripts/local-db/supabase-shim.sql` |
| Sign-in | Supabase Auth | `AUTH_MODE=local`: passwords (scrypt) in the local database, signed session cookie (`src/lib/local-auth.ts`) |
| New teammates | Email from Supabase | One-time link shown on the Members screen |
| Scheduler | Supabase `pg_cron` calls `/api/cron/tick` | The `worker` container calls `/api/cron/tick` (`scripts/worker.mjs`) |
| Documents | Supabase Storage bucket | Folder `/data/files` (`FILE_STORAGE=disk`) |
| Start-up | Owner deploys on Vercel | `docker/start-app.sh` runs `scripts/local-setup.ts` (keys, database, data), then the app |

Decision record: [ADR-029](decisions/ADR-029-local-mode.md).

## For developers: local mode without Docker

You need Node.js 22+ and PostgreSQL 16.

```bash
npm ci
npm run db:local:up
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres DATA_DIR=.data npm run local:setup
# .env.local: DATABASE_URL as above, AUTH_MODE=local, FILE_STORAGE=disk, and the two keys from .data/secrets.env
npm run build && npm start        # and in a second terminal: CRON_SECRET=… npm run worker
```

Check a fresh install end to end: `docker compose down -v && docker compose up -d --build && npm run test:e2e:local`.
