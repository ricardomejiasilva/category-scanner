# Category Product Scanner

Scans your brand marketing sites and flags any category pages showing 0 products. Built for Next.js / Umbraco sites pulling product data from WebstaurantStore.

---

## Setup (one time only)

```bash
npm install playwright cheerio axios
npx playwright install chromium
```

---

## Running the Scanner

**Scan all configured sites:**
```bash
node scanner.js
```

**Scan a single site (for testing):**
```bash
node scanner.js --site avantcorefrigeration.com
```

**Run multiple sites in parallel:**
```bash
node scanner.js --concurrency 3
```

When complete, the terminal will print a summary and save a `report.html` file in the same folder. Open that file in any browser to view the full report.

---

## Adding Sites

Open `scanner.js` and find the `sites` array in the `CONFIG` block at the top.

Sites fall into two template types based on their product card HTML. Add new sites to the correct group:

```js
sites: [
  // Template A: li.product-grid__item (default)
  'https://www.avantcorefrigeration.com',
  'https://www.carnivalkingsupplies.com',
  'https://www.acopatableware.com',

  // Template B: a.product-card
  { url: 'https://www.avantcoequipment.com', selector: 'a.product-card' },

  // Add more sites below:
  // 'https://www.yournextsite.com',
  // { url: 'https://www.differenttemplate.com', selector: 'a.product-card' },
],
```

### How to identify which template a site uses

1. Go to any category page on the site with products showing
2. Right-click a product card and click **Inspect**
3. Look for the element that wraps each product:
   - `<li class="product-grid__item ...">` → Template A (plain URL string)
   - `<a class="product-card ...">` → Template B (object with selector)

If a site shows 0 products across all categories when you know products exist, it likely uses a third template. Inspect a product card, note the class name, and add it as a custom selector:

```js
{ url: 'https://www.newsite.com', selector: 'div.your-class-here' },
```

---

## Excluded URL Patterns

The scanner automatically skips these on every site:

- `/product/` — individual product pages
- `/products/` — all-products navigation page
- `/cart`, `/checkout`, `/account`
- `/about`, `/contact`, `/support`
- `/blog`, `/news`, `/search`
- `/privacy`, `/terms`, `/policies`
- `/sitemap`, `/page/`
- `.xml`, `.pdf`

To add more exclusions, find the `EXCLUDED_PATHS` array near the top of `scanner.js`.

---

## Reading the Report

Open `report.html` in any browser after a scan.

| Indicator | Meaning |
|-----------|---------|
| 🚨 Red — 0 PRODUCTS | CMS connection likely broken, needs fixing in Umbraco |
| ❌ Orange — ERROR | Page timed out or failed to load |
| ✅ Green | Healthy — products found |

- Click any site header to expand/collapse its results
- Use the **Issues Only** filter to focus on problems
- Healthy sites are collapsed by default

---

## Configuration Options

All options are in the `CONFIG` block at the top of `scanner.js`:

| Option | Default | Description |
|--------|---------|-------------|
| `concurrency` | `2` | How many sites to scan in parallel |
| `pageTimeout` | `20000` | Max ms to wait for a page to load |
| `renderWait` | `2000` | Extra ms after load for JS to render products |
| `defaultSelector` | `li.product-grid__item` | CSS selector for Template A sites |
| `reportPath` | `./report.html` | Where to save the report |

---

## How It Works

1. Fetches the homepage HTML for each site and extracts all internal nav links
2. Filters to likely category pages (1–2 path segments, no excluded patterns)
3. Opens each page in a headless Chromium browser
4. Waits for the page to fully load and JS to render
5. Counts elements matching the product selector
6. Flags any page returning 0 products
7. Generates an HTML report with all results

**Note on pagination:** The scanner counts products visible on initial load (typically 24 before "Load More"). This is intentional — a broken category shows 0 on first load, which is the signal we need.

---

## Scheduling (Optional)

**Run daily via cron (Mac):**
```bash
crontab -e
# Add this line to run every day at 8am:
0 8 * * * cd /path/to/category-scanner && node scanner.js
```

**GitHub Actions** — see `.github/workflows/scan.yml` for a ready-made workflow that runs on a schedule and saves the report as a downloadable artifact.
