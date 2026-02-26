import { chromium, type Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { getCategoryUrls } from './discovery';

export interface SiteConfig {
  url: string;
  selector: string;
  siteId?: string;
}

export interface PageResult {
  url: string;
  productCount: number | null;
  status: 'ok' | 'empty' | 'error';
  errorMessage: string | null;
}

export interface SiteResult {
  site: string;
  siteId?: string;
  results: PageResult[];
  warning?: string;
}

interface ScannerOptions {
  scanId: string;
  sites: SiteConfig[];
  concurrency?: number;
  pageTimeout?: number;
  renderWait?: number;
  supabaseUrl: string;
  supabaseServiceKey: string;
  isCancelled?: () => boolean;
}

async function scanPage(
  page: Page,
  url: string,
  selector: string,
  pageTimeout: number,
  renderWait: number,
): Promise<PageResult> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: pageTimeout });
    await page.waitForTimeout(renderWait);
    const count = await page.$$eval(selector, (els) => els.length);
    return {
      url,
      productCount: count,
      status: count === 0 ? 'empty' : 'ok',
      errorMessage: null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { url, productCount: null, status: 'error', errorMessage: msg };
  }
}

export async function runScan(options: ScannerOptions): Promise<SiteResult[] | null> {
  const {
    scanId,
    sites,
    concurrency = 2,
    pageTimeout = 20000,
    renderWait = 2000,
    supabaseUrl,
    supabaseServiceKey,
    isCancelled = () => false,
  } = options;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  await supabase.from('scans').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', scanId);

  const browser = await chromium.launch({ headless: true });
  const allResults: SiteResult[] = [];

  try {
    for (let i = 0; i < sites.length; i += concurrency) {
      if (isCancelled()) {
        console.log(`  ⛔ Scan cancelled before batch ${i}`);
        return null;
      }

      const batch = sites.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (siteConfig) => {
          const { url: baseUrl, selector, siteId } = siteConfig;
          console.log(`\n Scanning: ${baseUrl} (selector: ${selector})`);

          const categoryUrls = await getCategoryUrls(baseUrl);

          if (categoryUrls.length === 0) {
            return { site: baseUrl, siteId, results: [], warning: 'No category URLs found' };
          }

          console.log(`  → Scanning ${categoryUrls.length} pages...`);

          const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (compatible; CategoryScanner/1.0; +internal-monitoring)',
          });

          try {
            const page = await context.newPage();
            const results: PageResult[] = [];

            for (const pageUrl of categoryUrls) {
              if (isCancelled()) {
                console.log(`  ⛔ Scan cancelled mid-site`);
                return { site: baseUrl, siteId, results };
              }

              const result = await scanPage(page, pageUrl, selector, pageTimeout, renderWait);
              console.log(`  ${result.status === 'error' ? '❌' : result.status === 'empty' ? '🚨' : '✅'} ${pageUrl}`);
              results.push(result);

              // Write result to Supabase immediately for real-time dashboard updates
              const { error: insertError } = await supabase.from('scan_results').insert({
                scan_id: scanId,
                site_id: siteId ?? null,
                site_url: baseUrl,
                page_url: pageUrl,
                product_count: result.productCount,
                status: result.status,
                error_message: result.errorMessage,
              });
              if (insertError) {
                console.error(`  ⚠ Failed to save result for ${pageUrl}:`, insertError.message);
              }
            }

            return { site: baseUrl, siteId, results };
          } finally {
            await context.close();
          }
        }),
      );

      allResults.push(...batchResults);
    }
  } finally {
    await browser.close();
  }

  // Compute final totals from collected results (avoids race conditions from concurrent counter updates)
  const allPageResults = allResults.flatMap((s) => s.results);
  const totalPages = allPageResults.length;
  const emptyCount = allPageResults.filter((r) => r.status === 'empty').length;
  const errorCount = allPageResults.filter((r) => r.status === 'error').length;

  await supabase.from('scans').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    total_pages: totalPages,
    empty_count: emptyCount,
    error_count: errorCount,
  }).eq('id', scanId);

  return allResults;
}
