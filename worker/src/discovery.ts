import axios from 'axios';
import * as cheerio from 'cheerio';

const EXCLUDED_PATHS = [
  '/product/', '/products/', '/cart', '/checkout', '/account', '/faq',
  '/about', '/contact', '/blog', '/news', '/search',
  '/login', '/register', '/privacy', '/terms', '/sitemap',
  '/page/', '/support', '/policies', '/equipment-parts', '/#', '/flavors',
  '/shop-by-collection/artisan', '.xml', '.pdf',
];

function normalizeUrl(baseUrl: string): string {
  return baseUrl.includes('://www.')
    ? baseUrl
    : baseUrl.replace('://', '://www.');
}

export async function getCategoryUrls(baseUrl: string): Promise<string[]> {
  const wwwUrl = normalizeUrl(baseUrl);
  console.log(`  → Discovering categories from: ${wwwUrl}`);

  try {
    const { data } = await axios.get(wwwUrl, {
      timeout: 15000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CategoryScanner/1.0)' },
    });

    const $ = cheerio.load(data);
    const links = new Set<string>();

    $('a[href]').each((_, el) => {
      let href = $(el).attr('href');
      if (!href) return;
      if (href.startsWith('/')) href = wwwUrl + href;
      if (!href.startsWith(wwwUrl) && !href.startsWith(baseUrl)) return;

      const urlPath = href.replace(wwwUrl, '').replace(baseUrl, '').split('?')[0];
      if (!urlPath || urlPath === '/') return;
      if (EXCLUDED_PATHS.some((ex) => urlPath.toLowerCase().includes(ex))) return;

      const segments = urlPath.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
      if (segments.length === 0 || segments.length > 2) return undefined;

      const normalised = wwwUrl + '/' + segments.join('/') + '/';
      links.add(normalised);
    });

    const urls = [...links];
    if (urls.length > 0) {
      console.log(`  → Found ${urls.length} category URLs from nav`);
      return urls;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Nav scrape failed: ${msg}`);
  }

  console.log(`  → Falling back to sitemap...`);
  return getSitemapUrls(baseUrl);
}

async function getSitemapUrls(baseUrl: string): Promise<string[]> {
  const wwwUrl = normalizeUrl(baseUrl);

  for (const url of [`${wwwUrl}/sitemap_index.xml`, `${wwwUrl}/sitemap.xml`]) {
    try {
      const { data } = await axios.get(url, { timeout: 10000, maxRedirects: 5 });
      if (!data.includes('<urlset') && !data.includes('<sitemapindex')) continue;

      const $ = cheerio.load(data, { xmlMode: true });
      const childSitemaps = $('sitemap > loc').map((_, el) => $(el).text().trim()).get();

      if (childSitemaps.length > 0) {
        const all: string[] = [];
        for (const child of childSitemaps) {
          try {
            const { data: d } = await axios.get(child, { timeout: 10000 });
            const $c = cheerio.load(d, { xmlMode: true });
            $c('url > loc').each((_, el) => { all.push($c(el).text().trim()); });
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
