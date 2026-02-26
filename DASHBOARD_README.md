# Category Scanner Dashboard

A full-stack monitoring dashboard that scans brand marketing websites for empty product category pages (a symptom of a broken Umbraco/CMS connection).

## Architecture

```
┌─────────────────────────┐     ┌───────────────────────┐
│  Next.js Dashboard      │────▶│  Scanner Worker        │
│  (Vercel)               │     │  (Railway)             │
│                         │     │                        │
│  - Dashboard UI         │     │  - Express REST API    │
│  - Scan history         │     │  - Playwright scans    │
│  - Sites management     │     │  - Writes to Supabase  │
└─────────┬───────────────┘     └───────────────────────┘
          │ reads / subscribes              │ writes live
          ▼                                ▼
     ┌─────────────────────────────────────────┐
     │  Supabase (Postgres + Auth + Realtime)  │
     └─────────────────────────────────────────┘
```

---

## Setup

### 1. Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. In the SQL Editor, run the contents of **`supabase/schema.sql`** — this creates all tables, indexes, RLS policies, and seeds your initial 5 sites
3. Enable Realtime: go to **Database → Replication** and toggle on `scan_results` and `scans`
4. Create your first user: go to **Authentication → Users → Add user** and create an email/password account for yourself

### 2. Worker Service (Railway)

1. Create a new Railway project and link it to the `worker/` directory
2. Set the following environment variables in Railway:

   | Variable | Value |
   |---|---|
   | `PORT` | `3001` |
   | `WORKER_SECRET` | A random secret string (generate with `openssl rand -hex 32`) |
   | `SUPABASE_URL` | Your Supabase project URL |
   | `SUPABASE_SERVICE_KEY` | Your Supabase **service role** key (Settings → API) |

3. Railway will auto-detect the Dockerfile and build/deploy the service
4. Copy the Railway deployment URL (e.g. `https://your-worker.railway.app`)

> **Note:** The worker uses the Playwright Docker base image which includes Chromium. No additional browser installation is needed.

### 3. Dashboard (Vercel)

1. Create a new Vercel project and link it to the `dashboard/` directory
2. Set these environment variables in Vercel:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase **anon** key (Settings → API) |
   | `WORKER_URL` | Your Railway worker URL |
   | `WORKER_SECRET` | The same secret you set on the worker |

3. Deploy — Vercel will auto-detect Next.js

---

## Usage

### Dashboard (`/`)
- View the most recent scan results across all sites
- Color-coded: green = healthy, red = 0 products, yellow = page load error
- Click any URL in the table to open it in a new tab
- **Scan All** — triggers a full scan of all active sites
- **Scan Selected** — opens a dropdown to pick specific sites
- Live progress updates as the worker scans each page (no refresh needed)

### History (`/history`)
- Full log of all past scan runs with timestamps, page counts, and issue badges
- Click **View** on any scan to see its complete results

### Sites (`/sites`)
- Add, edit, or remove monitored sites
- Each site has a **CSS selector** that identifies product cards (configure per template)
- Toggle sites on/off without deleting them

---

## Adding a New Site

1. Go to `/sites` in the dashboard
2. Click **Add Site**
3. Enter the site name, URL, and product CSS selector
4. **Finding the selector:** Open the site in Chrome DevTools, inspect a product card, and note the element's class. Common patterns:
   - `li.product-grid__item` (Template A — most WebstaurantStore brand sites)
   - `a.product-card` (Template B)
   - `a.fancy-product-card, a.simple-product-card` (Template C)

---

## Scheduled Scans (Optional)

The GitHub Actions workflow in `.github/workflows/scan.yml` still runs daily at 8am UTC as a backup. To post results to the database instead of generating an HTML file, update the workflow to call the worker API:

```yaml
- name: Trigger scan
  run: |
    curl -X POST ${{ secrets.WORKER_URL }}/scan \
      -H "Authorization: Bearer ${{ secrets.WORKER_SECRET }}" \
      -H "Content-Type: application/json" \
      -d '{"scanId": "...", "sites": [...]}'
```

Or create a Vercel Cron Job (in `vercel.json`) to hit `/api/scan` on a schedule.

---

## Project Structure

```
category-scanner/
├── supabase/
│   └── schema.sql              # Database schema — run once in Supabase SQL Editor
│
├── worker/                     # Scanner service (deploy to Railway)
│   ├── src/
│   │   ├── server.ts           # Express REST API
│   │   ├── scanner.ts          # Playwright scan logic
│   │   └── discovery.ts        # URL discovery (nav + sitemap)
│   ├── Dockerfile
│   └── .env.example
│
└── dashboard/                  # Next.js app (deploy to Vercel)
    ├── app/
    │   ├── (auth)/login/       # Login page
    │   ├── (dashboard)/
    │   │   ├── page.tsx        # Main dashboard
    │   │   ├── history/        # Scan history list + detail pages
    │   │   └── sites/          # Sites management
    │   └── api/scan/           # API route that triggers worker
    ├── components/
    │   ├── DashboardClient.tsx # Real-time dashboard with Supabase subscriptions
    │   ├── ScanLauncher.tsx    # Scan all / scan selected UI
    │   ├── SiteResultsTable.tsx
    │   ├── SitesClient.tsx
    │   ├── StatusBadge.tsx
    │   └── Sidebar.tsx
    ├── lib/
    │   ├── supabase/           # Browser + server Supabase clients
    │   └── types.ts            # Shared TypeScript types
    └── proxy.ts                # Route protection (Next.js 16 middleware)
```

---

## Extending to Other Scraping Projects

The worker is generic — it accepts any `{ url, selector }` configuration via the POST body. To reuse it for WebstaurantStore product scraping or any other project:

1. Add a new API endpoint (e.g. `POST /scrape`) to `worker/src/server.ts`
2. Re-use the `getCategoryUrls` discovery logic or write a new one for the target site structure
3. The same Railway deployment handles all scraping workloads
