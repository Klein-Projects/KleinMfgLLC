/**
 * scripts/backfill-prompt-ids.ts — Phase 1 Step 3d
 *
 * One-time backfill: walks every activity row whose prompt_id is NULL but
 * whose legacy prompt_used text is set, fuzzy-matches that text against
 * the prompt_templates.title catalog, and populates prompt_id where the
 * match confidence clears the threshold. Activities with no prompt_used
 * (the common case in Klein's current data) are left untouched.
 *
 * The new cadence engine on /portal/today uses activities.prompt_id to
 * decide whether a rule has already fired for a lead. Without this
 * backfill (or with empty prompt_used data) the engine sees no fires
 * and surfaces the smallest-days_after_trigger rule for everyone.
 *
 * Usage (PowerShell, from the repo root):
 *
 *   $env:NEXT_PUBLIC_SUPABASE_URL = (Get-Content .env.local | Select-String '^NEXT_PUBLIC_SUPABASE_URL=').ToString().Split('=',2)[1]
 *   $env:SUPABASE_SERVICE_ROLE_KEY = (Get-Content .env.local | Select-String '^SUPABASE_SERVICE_ROLE_KEY=').ToString().Split('=',2)[1]
 *   npx tsx scripts/backfill-prompt-ids.ts --dry-run    # report only
 *   npx tsx scripts/backfill-prompt-ids.ts              # apply changes
 *   npx tsx scripts/backfill-prompt-ids.ts --threshold 0.9
 *   npx tsx scripts/backfill-prompt-ids.ts --verbose
 *
 * Env required (no dotenv loader — set them in the shell first):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (writes need the service role to bypass RLS)
 */

import { createClient } from "@supabase/supabase-js";

// ── CLI ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const VERBOSE = argv.includes("--verbose");
const thresholdIdx = argv.indexOf("--threshold");
const THRESHOLD =
  thresholdIdx >= 0 ? Number(argv[thresholdIdx + 1]) : 0.85;

if (!Number.isFinite(THRESHOLD) || THRESHOLD < 0 || THRESHOLD > 1) {
  console.error(`Invalid --threshold value (got ${THRESHOLD}). Expected 0.0–1.0.`);
  process.exit(1);
}

// ── Supabase ───────────────────────────────────────────────────────────

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.",
  );
  process.exit(1);
}
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Fuzzy matching ─────────────────────────────────────────────────────

/** Lowercase + collapse whitespace + strip punctuation that varies. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[—–-]+/g, " ") // em/en dash, hyphen
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): Set<string> {
  return new Set(normalize(s).split(" ").filter(Boolean));
}

/** Jaccard token overlap (handles word reorderings + typos at word boundary). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let overlap = 0;
  Array.from(a).forEach((t) => {
    if (b.has(t)) overlap++;
  });
  const union = a.size + b.size - overlap;
  return union === 0 ? 0 : overlap / union;
}

/** Iterative Levenshtein, normalized to [0,1]. */
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = new Array(n + 1).fill(0).map((_, i) => i);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  const distance = prev[n];
  return 1 - distance / Math.max(m, n);
}

interface MatchResult {
  promptId: string | null;
  promptTitle: string | null;
  confidence: number;
  reason: "exact" | "substring" | "fuzzy" | "no_match";
}

function bestMatch(
  promptUsed: string,
  templates: { id: string; title: string }[],
): MatchResult {
  const usedNorm = normalize(promptUsed);
  if (!usedNorm) {
    return { promptId: null, promptTitle: null, confidence: 0, reason: "no_match" };
  }

  // 1. Exact normalized match.
  for (const t of templates) {
    if (normalize(t.title) === usedNorm) {
      return { promptId: t.id, promptTitle: t.title, confidence: 1, reason: "exact" };
    }
  }

  // 2. Substring (one contains the other) — strong signal when the title
  //    is at least 10 chars.
  for (const t of templates) {
    const titleNorm = normalize(t.title);
    if (titleNorm.length < 10) continue;
    if (usedNorm.includes(titleNorm) || titleNorm.includes(usedNorm)) {
      return {
        promptId: t.id,
        promptTitle: t.title,
        confidence: 0.92,
        reason: "substring",
      };
    }
  }

  // 3. Fuzzy: combine token Jaccard and char-level Levenshtein. Take max.
  const usedTokens = tokenize(promptUsed);
  let best: MatchResult = {
    promptId: null,
    promptTitle: null,
    confidence: 0,
    reason: "no_match",
  };
  for (const t of templates) {
    const titleNorm = normalize(t.title);
    const tokens = tokenize(t.title);
    const j = jaccard(usedTokens, tokens);
    const l = levenshteinSimilarity(usedNorm, titleNorm);
    const score = Math.max(j, l);
    if (score > best.confidence) {
      best = {
        promptId: t.id,
        promptTitle: t.title,
        confidence: score,
        reason: "fuzzy",
      };
    }
  }
  return best;
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\n[backfill-prompt-ids] mode=${DRY_RUN ? "DRY-RUN" : "APPLY"} threshold=${THRESHOLD}\n`,
  );

  const { data: templates, error: tplErr } = await supabase
    .from("prompt_templates")
    .select("id, title");
  if (tplErr) throw tplErr;
  if (!templates || templates.length === 0) {
    console.error("No prompt_templates rows found. Aborting.");
    process.exit(1);
  }
  console.log(`Loaded ${templates.length} prompt templates.`);

  const { data: rows, error: actErr } = await supabase
    .from("activities")
    .select("id, prompt_used, lead_id, created_at")
    .is("prompt_id", null)
    .not("prompt_used", "is", null);
  if (actErr) throw actErr;

  const candidates = (rows ?? []).filter(
    (r) => typeof r.prompt_used === "string" && r.prompt_used.trim().length > 0,
  );

  console.log(`Found ${candidates.length} candidate activities (prompt_id NULL, prompt_used populated).`);
  if (candidates.length === 0) {
    console.log(
      "\nNothing to backfill — no historical activities have prompt_used text set.",
    );
    console.log(
      "Going forward, the activity log form on /portal/leads/:id and the\n" +
        "Today page Copy-Script flow both write prompt_id directly, so future\n" +
        "rows are tagged at insert time.",
    );
    process.exit(0);
  }

  const updates: { id: string; promptId: string }[] = [];
  const buckets = {
    exact: 0,
    substring: 0,
    fuzzy_high: 0, // ≥ threshold
    fuzzy_low: 0,  // < threshold
    no_match: 0,
  };

  for (const row of candidates) {
    const m = bestMatch(row.prompt_used as string, templates);
    if (m.reason === "exact") buckets.exact++;
    else if (m.reason === "substring") buckets.substring++;
    else if (m.reason === "fuzzy" && m.confidence >= THRESHOLD)
      buckets.fuzzy_high++;
    else if (m.reason === "fuzzy") buckets.fuzzy_low++;
    else buckets.no_match++;

    const accept = m.confidence >= THRESHOLD && m.promptId !== null;
    if (VERBOSE) {
      console.log(
        `  [${accept ? "✓" : " "}] ${m.confidence.toFixed(2)} ${m.reason.padEnd(9)} "${row.prompt_used}" → ${m.promptTitle ?? "—"}`,
      );
    }
    if (accept) {
      updates.push({ id: row.id, promptId: m.promptId! });
    }
  }

  console.log("\nMatch buckets:");
  console.log(`  exact         : ${buckets.exact}`);
  console.log(`  substring     : ${buckets.substring}`);
  console.log(`  fuzzy ≥ ${THRESHOLD.toFixed(2)} : ${buckets.fuzzy_high}`);
  console.log(`  fuzzy < ${THRESHOLD.toFixed(2)} : ${buckets.fuzzy_low}`);
  console.log(`  no match      : ${buckets.no_match}`);
  console.log(`  → would update: ${updates.length} of ${candidates.length}`);

  if (DRY_RUN) {
    console.log("\nDRY-RUN — no writes. Re-run without --dry-run to apply.");
    return;
  }

  if (updates.length === 0) {
    console.log("\nNothing to write.");
    return;
  }

  console.log(`\nApplying ${updates.length} updates…`);
  let applied = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from("activities")
      .update({ prompt_id: u.promptId })
      .eq("id", u.id);
    if (error) {
      console.error(`  FAILED ${u.id}: ${error.message}`);
    } else {
      applied++;
    }
  }
  console.log(`Applied ${applied} of ${updates.length}.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
