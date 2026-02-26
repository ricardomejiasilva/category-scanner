import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { runScan, type SiteConfig } from './scanner';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? 'http://localhost:3000';

const app = express();
app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  }),
);
app.use(express.json({ limit: '256kb' }));

const PORT = process.env.PORT ?? 3001;
const WORKER_SECRET = process.env.WORKER_SECRET ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  process.exit(1);
}
if (!WORKER_SECRET) {
  console.warn('⚠  WORKER_SECRET is not set — all /scan requests will be rejected');
}

// Track which scans have been requested to cancel
const cancelledScans = new Set<string>();

export function isCancelled(scanId: string): boolean {
  return cancelledScans.has(scanId);
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization;
  if (!WORKER_SECRET || auth !== `Bearer ${WORKER_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

/**
 * POST /scan
 * Body: { scanId: string, sites: Array<{ url: string, selector: string, siteId?: string }>, concurrency?: number }
 */
app.post('/scan', requireAuth, async (req, res) => {
  const { scanId, sites, concurrency } = req.body as {
    scanId: string;
    sites: SiteConfig[];
    concurrency?: number;
  };

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!scanId || !UUID_RE.test(scanId) || !Array.isArray(sites) || sites.length === 0 || sites.length > 50) {
    res.status(400).json({ error: 'Invalid request: scanId (UUID) and 1–50 sites are required' });
    return;
  }

  // Cap concurrency between 1 and 5 regardless of what caller sends
  const safeConcurrency = Math.min(Math.max(Number(concurrency) || 2, 1), 5);

  res.json({ scanId, status: 'started' });

  console.log(`\n🚀 Starting scan ${scanId}`);
  console.log(`   Sites: ${sites.map((s) => s.url).join(', ')}`);

  try {
    const results = await runScan({
      scanId,
      sites,
      concurrency: safeConcurrency,
      supabaseUrl: SUPABASE_URL,
      supabaseServiceKey: SUPABASE_SERVICE_KEY,
      isCancelled: () => cancelledScans.has(scanId),
    });
    cancelledScans.delete(scanId);

    if (results === null) {
      console.log(`\n⛔ Scan ${scanId} was cancelled`);
    } else {
      const total = results.flatMap((s) => s.results).length;
      const empty = results.flatMap((s) => s.results).filter((r) => r.status === 'empty').length;
      const errors = results.flatMap((s) => s.results).filter((r) => r.status === 'error').length;
      console.log(`\n✅ Scan ${scanId} completed — ${total} pages, ${empty} empty, ${errors} errors`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Scan ${scanId} failed:`, msg);
    cancelledScans.delete(scanId);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    await supabase.from('scans').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', scanId);
  }
});

/**
 * POST /scan/:scanId/cancel
 * Signals the running scan to stop after the current page finishes.
 */
app.post('/scan/:scanId/cancel', requireAuth, async (req, res) => {
  const scanId = Array.isArray(req.params.scanId) ? req.params.scanId[0] : req.params.scanId;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(scanId)) {
    res.status(400).json({ error: 'Invalid scanId' });
    return;
  }
  cancelledScans.add(scanId);
  console.log(`\n⛔ Cancel requested for scan ${scanId}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  await supabase.from('scans').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', scanId);

  res.json({ scanId, status: 'cancelling' });
});

app.listen(PORT, () => {
  console.log(`🚀 Scanner worker listening on port ${PORT}`);
});
