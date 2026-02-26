/**
 * Category Product Scanner
 * Crawls category pages across your brand sites and flags any showing 0 products.
 *
 * Setup:
 *   npm install playwright cheerio axios
 *   npx playwright install chromium
 *
 * Run:
 *   node scanner.js
 *   node scanner.js --site avantcorefrigeration.com   (single site)
 *   node scanner.js --concurrency 3                   (run 3 sites in parallel)
 */

const { chromium } = require('playwright');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = {
  concurrency: 2,
  pageTimeout: 20000,
  renderWait: 2000,
  defaultSelector: 'li.product-grid__item',
  reportPath: './report.html',
  sites: [
  // Template A: li.product-grid__item (default)
  'https://www.avantcorefrigeration.com',
  'https://www.carnivalkingsupplies.com',
  'https://www.acopatableware.com',

  // Template B: a.product-card
  { url: 'https://www.avantcoequipment.com', selector: 'a.product-card' },

  // Template C: a.fancy-product-card + a.simple-product-card
  { url: 'https://www.capora.com', selector: 'a.fancy-product-card, a.simple-product-card' },

    // Add more sites below:
    // 'https://www.yournextsite.com',
    // { url: 'https://www.differenttemplate.com', selector: 'a.product-card' },
  ],
};

// ─── CATEGORY URL DISCOVERY ──────────────────────────────────────────────────

const EXCLUDED_PATHS = [
  '/product/', '/products/', '/cart', '/checkout', '/account', '/faq',
  '/about', '/contact', '/blog', '/news', '/search',
  '/login', '/register', '/privacy', '/terms', '/sitemap',
  '/page/', '/support', '/policies', '/equipment-parts', '/#', '/flavors', '/shop-by-collection/artisan',
  '.xml', '.pdf', 
];

async function getCategoryUrls(baseUrl) {
  const axios = require('axios');

  // Normalise — ensure www. prefix
  const wwwUrl = baseUrl.includes('://www.')
    ? baseUrl
    : baseUrl.replace('://', '://www.');

  console.log(`  → Discovering categories from: ${wwwUrl}`);

  try {
    const { data } = await axios.get(wwwUrl, {
      timeout: 15000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CategoryScanner/1.0)' },
    });

    const $ = cheerio.load(data);
    const links = new Set();

    $('a[href]').each((_, el) => {
      let href = $(el).attr('href');
      if (!href) return;
      if (href.startsWith('/')) href = wwwUrl + href;
      if (!href.startsWith(wwwUrl) && !href.startsWith(baseUrl)) return;

      const urlPath = href.replace(wwwUrl, '').replace(baseUrl, '').split('?')[0];
      if (!urlPath || urlPath === '/') return;
      if (EXCLUDED_PATHS.some((ex) => urlPath.toLowerCase().includes(ex))) return;

      const segments = urlPath.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
      if (segments.length === 0 || segments.length > 2) return;

      const normalised = wwwUrl + '/' + segments.join('/') + '/';
      links.add(normalised);
    });

    const urls = [...links];
    if (urls.length > 0) {
      console.log(`  → Found ${urls.length} category URLs from nav`);
      return urls;
    }
  } catch (err) {
    console.warn(`  ⚠ Nav scrape failed: ${err.message}`);
  }

  // Fallback: try sitemap
  console.log(`  → Falling back to sitemap...`);
  return getSitemapUrls(baseUrl);
}

async function getSitemapUrls(baseUrl) {
  const axios = require('axios');
  const wwwUrl = baseUrl.includes('://www.') ? baseUrl : baseUrl.replace('://', '://www.');

  for (const url of [`${wwwUrl}/sitemap_index.xml`, `${wwwUrl}/sitemap.xml`]) {
    try {
      const { data } = await axios.get(url, { timeout: 10000, maxRedirects: 5 });
      if (!data.includes('<urlset') && !data.includes('<sitemapindex')) continue;

      const $ = cheerio.load(data, { xmlMode: true });
      const childSitemaps = $('sitemap > loc').map((_, el) => $(el).text().trim()).get();

      if (childSitemaps.length > 0) {
        const all = [];
        for (const child of childSitemaps) {
          try {
            const { data: d } = await axios.get(child, { timeout: 10000 });
            const $c = cheerio.load(d, { xmlMode: true });
            $c('url > loc').each((_, el) => all.push($c(el).text().trim()));
          } catch { /* skip */ }
        }
        return all;
      }

      return $('url > loc').map((_, el) => $(el).text().trim()).get();
    } catch { /* try next */ }
  }

  console.warn(`  ⚠ No sitemap found either`);
  return [];
}

// ─── PAGE SCANNER ────────────────────────────────────────────────────────────

async function scanPage(page, url, selector) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: CONFIG.pageTimeout });
    await page.waitForTimeout(CONFIG.renderWait);
    const count = await page.$$eval(selector, (els) => els.length);
    return { url, count, error: null };
  } catch (err) {
    return { url, count: null, error: err.message };
  }
}

// ─── SITE SCANNER ────────────────────────────────────────────────────────────

async function scanSite(browser, siteConfig) {
  // siteConfig can be a plain URL string or { url, selector }
  const baseUrl = typeof siteConfig === 'string' ? siteConfig : siteConfig.url;
  const selector = typeof siteConfig === 'string' ? CONFIG.defaultSelector : (siteConfig.selector || CONFIG.defaultSelector);

  console.log(`\n📦 Scanning: ${baseUrl} (selector: ${selector})`);

  const categoryUrls = await getCategoryUrls(baseUrl);

  if (categoryUrls.length === 0) {
    return { site: baseUrl, results: [], warning: 'No category URLs found' };
  }

  console.log(`  → Scanning ${categoryUrls.length} pages...`);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (compatible; CategoryScanner/1.0; +internal-monitoring)',
  });
  const page = await context.newPage();

  const results = [];
  for (const url of categoryUrls) {
    process.stdout.write(`  Checking ${url} ... `);
    const result = await scanPage(page, url, selector);
    const icon = result.error ? '❌' : result.count === 0 ? '🚨' : '✅';
    console.log(`${icon} ${result.error ?? result.count + ' products'}`);
    results.push(result);
  }

  await context.close();
  return { site: baseUrl, results };
}


// ─── REPORT GENERATOR ────────────────────────────────────────────────────────

function generateReport(siteResults) {
  const timestamp = new Date().toLocaleString();
  const totalPages = siteResults.reduce((n, s) => n + s.results.length, 0);
  const emptyPages = siteResults.reduce((n, s) => n + s.results.filter((r) => r.count === 0).length, 0);
  const errorPages = siteResults.reduce((n, s) => n + s.results.filter((r) => r.error).length, 0);

  const siteSections = siteResults.map(({ site, results, warning }) => {
    if (warning) {
      return `<div class="site-block warning-site"><div class="site-header"><span class="site-name">${site}</span><span class="badge badge-warn">⚠ ${warning}</span></div></div>`;
    }

    const empty = results.filter((r) => r.count === 0);
    const errors = results.filter((r) => r.error);
    const hasIssues = empty.length > 0 || errors.length > 0;

    const rows = results
      .sort((a, b) => {
        if (a.error && !b.error) return -1;
        if (!a.error && b.error) return 1;
        if (a.count === 0 && b.count !== 0) return -1;
        if (a.count !== 0 && b.count === 0) return 1;
        return a.url.localeCompare(b.url);
      })
      .map((r) => {
        const rowClass = r.error ? 'row-error' : r.count === 0 ? 'row-empty' : 'row-ok';
        const status = r.error
          ? `<span class="status error">ERROR</span>`
          : r.count === 0
          ? `<span class="status empty">0 PRODUCTS</span>`
          : `<span class="status ok">${r.count} products</span>`;
        return `<tr class="${rowClass}"><td><a href="${r.url}" target="_blank">${r.url}</a></td><td>${status}</td>${r.error ? `<td class="error-msg">${r.error}</td>` : '<td></td>'}</tr>`;
      })
      .join('');

    return `
    <div class="site-block ${hasIssues ? 'has-issues' : 'all-ok'}">
      <div class="site-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <span class="site-name">${site}</span>
        <div class="site-stats">
          ${empty.length > 0 ? `<span class="badge badge-empty">🚨 ${empty.length} empty</span>` : ''}
          ${errors.length > 0 ? `<span class="badge badge-error">❌ ${errors.length} errors</span>` : ''}
          ${!hasIssues ? `<span class="badge badge-ok">✅ All good</span>` : ''}
          <span class="badge badge-total">${results.length} pages</span>
        </div>
      </div>
      <div class="site-body">
        <table>
          <thead><tr><th>URL</th><th>Status</th><th>Details</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Category Scanner Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; }
    header { background: linear-gradient(135deg, #1a1f2e 0%, #0f1117 100%); border-bottom: 1px solid #2d3748; padding: 2rem; }
    header h1 { font-size: 1.75rem; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
    header p { color: #718096; margin-top: 0.25rem; font-size: 0.875rem; }
    .summary { display: flex; gap: 1rem; padding: 1.5rem 2rem; border-bottom: 1px solid #2d3748; flex-wrap: wrap; }
    .stat-card { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 8px; padding: 1rem 1.5rem; min-width: 140px; }
    .stat-card .value { font-size: 2rem; font-weight: 800; line-height: 1; }
    .stat-card .label { font-size: 0.75rem; color: #718096; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.25rem; }
    .stat-card.danger .value { color: #fc8181; }
    .stat-card.warn .value { color: #f6ad55; }
    .stat-card.ok .value { color: #68d391; }
    .stat-card.neutral .value { color: #63b3ed; }
    main { padding: 1.5rem 2rem; max-width: 1400px; }
    .filters { display: flex; gap: 0.75rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
    .filter-btn { background: #1a1f2e; border: 1px solid #2d3748; color: #a0aec0; border-radius: 6px; padding: 0.4rem 0.9rem; font-size: 0.8rem; cursor: pointer; transition: all 0.15s; }
    .filter-btn:hover, .filter-btn.active { background: #2d3748; color: #fff; border-color: #4a5568; }
    .site-block { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 10px; margin-bottom: 1rem; overflow: hidden; }
    .site-block.has-issues { border-color: #744210; }
    .site-block.all-ok { border-color: #276749; }
    .site-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; cursor: pointer; user-select: none; flex-wrap: wrap; gap: 0.5rem; }
    .site-header:hover { background: #212840; }
    .site-name { font-weight: 600; font-size: 0.95rem; color: #90cdf4; }
    .site-stats { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .badge { font-size: 0.72rem; padding: 0.2rem 0.6rem; border-radius: 999px; font-weight: 600; }
    .badge-empty { background: #742a2a; color: #fed7d7; }
    .badge-error { background: #553c22; color: #fbd38d; }
    .badge-ok { background: #1c4532; color: #9ae6b4; }
    .badge-total { background: #1a365d; color: #bee3f8; }
    .badge-warn { background: #744210; color: #fefcbf; }
    .site-block.collapsed .site-body { display: none; }
    .site-body { padding: 0 1.25rem 1.25rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    thead tr { border-bottom: 1px solid #2d3748; }
    th { text-align: left; padding: 0.6rem 0.75rem; color: #718096; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 0.55rem 0.75rem; border-bottom: 1px solid #1a202c; vertical-align: middle; }
    td a { color: #90cdf4; text-decoration: none; font-size: 0.82rem; }
    td a:hover { text-decoration: underline; }
    .row-empty td { background: rgba(197, 48, 48, 0.08); }
    .row-error td { background: rgba(214, 122, 0, 0.08); }
    .status { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.03em; }
    .status.empty { background: #742a2a; color: #fed7d7; }
    .status.error { background: #553c22; color: #fbd38d; }
    .status.ok { background: #1c4532; color: #9ae6b4; }
    .error-msg { color: #fc8181; font-size: 0.78rem; }
    footer { text-align: center; padding: 2rem; color: #4a5568; font-size: 0.8rem; border-top: 1px solid #2d3748; margin-top: 2rem; }
  </style>
</head>
<body>
<header>
  <h1>🔍 Category Product Scanner</h1>
  <p>Report generated: ${timestamp}</p>
</header>
<div class="summary">
  <div class="stat-card ${emptyPages > 0 ? 'danger' : 'ok'}">
    <div class="value">${emptyPages}</div>
    <div class="label">Empty Categories</div>
  </div>
  <div class="stat-card ${errorPages > 0 ? 'warn' : 'ok'}">
    <div class="value">${errorPages}</div>
    <div class="label">Scan Errors</div>
  </div>
  <div class="stat-card neutral">
    <div class="value">${totalPages}</div>
    <div class="label">Pages Scanned</div>
  </div>
  <div class="stat-card neutral">
    <div class="value">${siteResults.length}</div>
    <div class="label">Sites</div>
  </div>
</div>
<main>
  <div class="filters">
    <button class="filter-btn active" onclick="filterSites('all', this)">All Sites</button>
    <button class="filter-btn" onclick="filterSites('issues', this)">Issues Only</button>
    <button class="filter-btn" onclick="filterSites('ok', this)">Healthy Only</button>
  </div>
  ${siteSections}
</main>
<footer>Category Scanner — ${totalPages} pages across ${siteResults.length} sites</footer>
<script>
  document.querySelectorAll('.site-block.all-ok').forEach(el => el.classList.add('collapsed'));
  function filterSites(type, btn) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.site-block').forEach(el => {
      if (type === 'all') el.style.display = '';
      else if (type === 'issues') el.style.display = el.classList.contains('has-issues') ? '' : 'none';
      else if (type === 'ok') el.style.display = el.classList.contains('all-ok') ? '' : 'none';
    });
  }
</script>
</body>
</html>`;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const singleSite = args.includes('--site') ? args[args.indexOf('--site') + 1] : null;
  const concurrencyArg = args.includes('--concurrency')
    ? parseInt(args[args.indexOf('--concurrency') + 1])
    : CONFIG.concurrency;

  // When --site is used, check if it matches a configured site so we can use its custom selector
  let sites;
  if (singleSite) {
    const normalised = `https://www.${singleSite.replace(/^https?:\/\/(www\.)?/, '')}`;
    const match = CONFIG.sites.find((s) => {
      const url = typeof s === 'string' ? s : s.url;
      return url.replace(/\/$/, '') === normalised.replace(/\/$/, '');
    });
    sites = [match || normalised];
  } else {
    sites = CONFIG.sites;
  }

  console.log(`\n🚀 Category Scanner`);
  console.log(`   Sites: ${sites.length}`);
  console.log(`   Default selector: ${CONFIG.defaultSelector}`);
  console.log(`   Concurrency: ${concurrencyArg}\n`);

  const browser = await chromium.launch({ headless: true });
  const allResults = [];

  for (let i = 0; i < sites.length; i += concurrencyArg) {
    const batch = sites.slice(i, i + concurrencyArg);
    const batchResults = await Promise.all(batch.map((siteConfig) => scanSite(browser, siteConfig)));
    allResults.push(...batchResults);
  }

  await browser.close();

  const html = generateReport(allResults);
  fs.writeFileSync(CONFIG.reportPath, html);

  const emptyPages = allResults.flatMap((s) => s.results.filter((r) => r.count === 0));
  const errorPages = allResults.flatMap((s) => s.results.filter((r) => r.error));

  console.log('\n─────────────────────────────────');
  console.log('📊 SUMMARY');
  console.log(`   Pages scanned: ${allResults.reduce((n, s) => n + s.results.length, 0)}`);

  if (emptyPages.length > 0) {
    console.log(`\n🚨 EMPTY CATEGORIES (${emptyPages.length}):`);
    emptyPages.forEach((p) => console.log(`   • ${p.url}`));
  } else {
    console.log('\n✅ No empty categories found!');
  }

  if (errorPages.length > 0) {
    console.log(`\n⚠  ERRORS (${errorPages.length}):`);
    errorPages.forEach((p) => console.log(`   • ${p.url}: ${p.error}`));
  }

  console.log(`\n📄 Report saved: ${path.resolve(CONFIG.reportPath)}\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
