/**
 * scripts/classify-backfill.ts — Phase 2 Step 1 backfill
 *
 * One-time(-ish): walk every lead where status NOT IN ('won','lost')
 * and POST /api/leads/:id/classify so the Haiku classifier writes back
 * conversation_state, suggested_prompt_id, state_confidence,
 * state_reasoning, state_updated_at on every active lead.
 *
 * Hits the deployed API over HTTP (not Supabase direct) so the same
 * code path that runs at request-time runs here — no risk of the
 * backfill drifting from the live behavior.
 *
 * Usage (PowerShell, from the repo root):
 *
 *   $env:KLEIN_API_BASE_URL = "https://kleinmfgllc.com"           # required
 *   $env:COWORK_API_TOKEN   = "<bearer-token-from-Vercel-env>"    # required
 *   npx tsx scripts/classify-backfill.ts                           # dry-list only
 *   npx tsx scripts/classify-backfill.ts --apply                   # actually classify
 *   npx tsx scripts/classify-backfill.ts --apply --throttle 500    # ms between calls
 *   npx tsx scripts/classify-backfill.ts --apply --skip-classified # skip leads with state_updated_at set
 *   npx tsx scripts/classify-backfill.ts --apply --limit 25        # cap (testing)
 *
 * Cowork / production usage (Phase 2 Step 2 prompt):
 *   - Sean runs this from Claude Cowork after Phase 2 Step 1 is deployed.
 *   - COWORK_API_TOKEN comes from Vercel project env (also embedded in
 *     scheduled-task SKILLs — rotate together if you ever change it).
 *
 * Logs are intentionally chatty so it's obvious what's happening.
 * Failures per-lead are logged and counted but do NOT abort the run.
 */

interface LeadStub {
  id: string;
  status: string;
  conversation_state: string | null;
  state_updated_at: string | null;
}

interface ClassifyResult {
  lead_id: string;
  conversation_state: string;
  suggested_prompt_id: string | null;
  suggested_prompt_title: string;
  state_confidence: number;
  state_reasoning: string;
  state_updated_at: string;
  matched_prompt: boolean;
}

// ── CLI ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const SKIP_CLASSIFIED = argv.includes("--skip-classified");
function intArg(flag: string, fallback: number): number {
  const i = argv.indexOf(flag);
  if (i === -1) return fallback;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
const THROTTLE_MS = intArg("--throttle", 500);
const LIMIT = intArg("--limit", 0); // 0 = no cap

const BASE_URL = process.env.KLEIN_API_BASE_URL?.replace(/\/$/, "") ?? "";
const TOKEN = process.env.COWORK_API_TOKEN ?? "";

function die(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!BASE_URL) die("KLEIN_API_BASE_URL is required (e.g. https://kleinmfgllc.com)");
if (!TOKEN) die("COWORK_API_TOKEN is required");

// ── Helpers ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchActiveLeads(): Promise<LeadStub[]> {
  const url = new URL("/api/leads", BASE_URL);
  url.searchParams.set("status_not_in", "won,lost");
  if (LIMIT > 0) url.searchParams.set("limit", String(LIMIT));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    die(`GET /api/leads ${res.status}: ${text || res.statusText}`);
  }
  const json = (await res.json()) as { leads: LeadStub[]; count: number };
  return json.leads ?? [];
}

async function classifyOne(leadId: string): Promise<ClassifyResult> {
  const url = new URL(`/api/leads/${leadId}/classify`, BASE_URL);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as ClassifyResult;
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`▸ Klein classifier backfill`);
  console.log(`  base URL  : ${BASE_URL}`);
  console.log(`  apply     : ${APPLY ? "YES (writes to DB)" : "no (dry-list only)"}`);
  console.log(`  throttle  : ${THROTTLE_MS}ms`);
  console.log(`  limit     : ${LIMIT > 0 ? LIMIT : "(no cap)"}`);
  console.log(`  skip done : ${SKIP_CLASSIFIED ? "yes" : "no"}`);
  console.log("");

  console.log("Fetching active leads (status NOT IN ('won','lost'))…");
  const all = await fetchActiveLeads();
  console.log(`  → ${all.length} active leads returned`);

  const targets = SKIP_CLASSIFIED
    ? all.filter((l) => !l.state_updated_at)
    : all;
  console.log(
    `  → ${targets.length} to classify${
      SKIP_CLASSIFIED ? ` (${all.length - targets.length} already classified, skipped)` : ""
    }\n`,
  );

  if (!APPLY) {
    console.log("Dry-list only (pass --apply to write). First 10:");
    for (const l of targets.slice(0, 10)) {
      console.log(
        `  ${l.id}  status=${l.status}  state=${l.conversation_state ?? "(none)"}`,
      );
    }
    return;
  }

  let ok = 0;
  let needsNew = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (let i = 0; i < targets.length; i++) {
    const lead = targets[i];
    const prefix = `[${i + 1}/${targets.length}] ${lead.id}`;
    try {
      const result = await classifyOne(lead.id);
      const tag = result.matched_prompt ? "matched" : "NEEDS_NEW_PROMPT";
      console.log(
        `${prefix}  ${result.conversation_state}  conf=${result.state_confidence}  ${tag}`,
      );
      if (result.matched_prompt) ok++;
      else needsNew++;
    } catch (e: unknown) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`${prefix}  ✗ ${msg}`);
    }
    if (i < targets.length - 1 && THROTTLE_MS > 0) {
      await sleep(THROTTLE_MS);
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("");
  console.log(`Done in ${elapsedSec}s.`);
  console.log(`  matched          : ${ok}`);
  console.log(`  NEEDS_NEW_PROMPT : ${needsNew}`);
  console.log(`  failed           : ${failed}`);
}

main().catch((e) => {
  console.error("✗ Unhandled:", e);
  process.exit(1);
});
