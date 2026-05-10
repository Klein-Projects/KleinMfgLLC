"use client";

import { useMemo, useState } from "react";
import { Check, AlertTriangle, ExternalLink, Send, X } from "lucide-react";

interface PromptOption {
  id: string;
  title: string;
  category: string;
  body: string;
}

interface CardState {
  url: string;            // normalized URL
  rawUrl: string;         // original pasted form (used to render path)
  promptId: string | null;
  // Parsed name + headline + company that Sean enters per card. Pre-filled
  // from the URL slug as a starting point; Sean overrides.
  name: string;
  headline: string;
  company: string;
  title: string;
  // Dedupe lookup result.
  existing: {
    found: boolean;
    status?: string;
    invitedAt?: string | null;
    name?: string;
  } | null;
  state: "idle" | "sending" | "sent" | "error";
  sentAt?: string;
  errorMsg?: string;
  leadId?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  first_contact: "First Contact",
  follow_up: "Follow-Up",
  no_reply: "No Reply",
  sample_followup: "Sample Follow-Up",
  won: "Closed/Won",
  nurture: "Nurture",
};

function normalizeLinkedinUrl(raw: string): string {
  let s = raw.trim();
  if (s.endsWith("/")) s = s.slice(0, -1);
  try {
    const u = new URL(s);
    u.hostname = u.hostname.toLowerCase();
    let out = u.toString();
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return s;
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

// Convert "joseph-pisciotta" → "Joseph Pisciotta" as a starter for the
// per-card name field. Sean usually has to fix it (case, accents) but
// it's faster than typing from scratch.
function nameFromSlug(url: string): string {
  try {
    const path = new URL(url).pathname;
    const m = /\/in\/([^/]+)/.exec(path);
    if (!m) return "";
    const slug = decodeURIComponent(m[1]);
    return slug
      .split("-")
      .filter((s) => !/^\d+$/.test(s) && !/^[a-f0-9]{6,}$/i.test(s))
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

function personalize(body: string, firstName: string, company: string): string {
  return body
    .replace(/\[Name\]/g, firstName || "there")
    .replace(/\[Company\]/g, company || "your team");
}

function parseUrlBlob(blob: string): string[] {
  // Accept newlines, commas, semicolons, whitespace.
  const tokens = blob
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.toLowerCase().includes("linkedin.com"));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const norm = normalizeLinkedinUrl(t);
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

export default function OutreachClient({ prompts }: { prompts: PromptOption[] }) {
  const [blob, setBlob] = useState("");
  const [cards, setCards] = useState<CardState[]>([]);
  const [defaultPromptId, setDefaultPromptId] = useState<string>(
    prompts.find((p) => p.category === "first_contact")?.id ?? prompts[0]?.id ?? "",
  );
  const [parseError, setParseError] = useState<string>("");

  const promptById = useMemo(() => {
    const m = new Map<string, PromptOption>();
    for (const p of prompts) m.set(p.id, p);
    return m;
  }, [prompts]);

  // ── Parse URLs into cards ──
  async function handleParse() {
    setParseError("");
    const urls = parseUrlBlob(blob);
    if (urls.length === 0) {
      setParseError("No LinkedIn URLs found. Paste at least one URL.");
      setCards([]);
      return;
    }

    const initial: CardState[] = urls.map((url) => ({
      url,
      rawUrl: url,
      promptId: defaultPromptId || null,
      name: nameFromSlug(url),
      headline: "",
      company: "",
      title: "",
      existing: null,
      state: "idle",
    }));
    setCards(initial);

    // Fire dedupe lookups in parallel.
    const checks = await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await fetch(
            `/api/leads/by-linkedin-url?url=${encodeURIComponent(url)}`,
          );
          if (!res.ok) return null;
          const data = (await res.json()) as {
            found: boolean;
            lead?: { id: string; status: string; invited_at: string | null; name: string };
          };
          return data;
        } catch {
          return null;
        }
      }),
    );

    setCards((prev) =>
      prev.map((c, i) => {
        const r = checks[i];
        if (!r) return c;
        if (r.found && r.lead) {
          return {
            ...c,
            existing: {
              found: true,
              status: r.lead.status,
              invitedAt: r.lead.invited_at,
              name: r.lead.name,
            },
            // Backfill the name field from the existing lead if we have one.
            name: c.name || r.lead.name,
          };
        }
        return { ...c, existing: { found: false } };
      }),
    );
  }

  function assignToAll() {
    if (!defaultPromptId) return;
    setCards((prev) =>
      prev.map((c) =>
        c.state === "sent" || c.state === "sending"
          ? c
          : { ...c, promptId: defaultPromptId },
      ),
    );
  }

  function setCardField<K extends keyof CardState>(
    idx: number,
    key: K,
    value: CardState[K],
  ) {
    setCards((prev) => {
      const next = prev.slice();
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  }

  function removeCard(idx: number) {
    setCards((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Send a single card ──
  async function sendCard(idx: number) {
    const card = cards[idx];
    if (!card || card.state === "sending" || card.state === "sent") return;
    if (!card.promptId) {
      setCardField(idx, "errorMsg", "Pick a prompt first.");
      setCardField(idx, "state", "error");
      return;
    }
    if (!card.name.trim() || card.name.trim().split(/\s+/).length < 2) {
      setCardField(idx, "errorMsg", "Name needs first and last (e.g. 'Jane Smith').");
      setCardField(idx, "state", "error");
      return;
    }

    const prompt = promptById.get(card.promptId);
    if (!prompt) {
      setCardField(idx, "errorMsg", "Selected prompt not found.");
      setCardField(idx, "state", "error");
      return;
    }
    const firstName = card.name.trim().split(/\s+/)[0];
    const noteText = personalize(prompt.body, firstName, card.company.trim());

    setCardField(idx, "state", "sending");
    setCardField(idx, "errorMsg", undefined);

    // 1. Copy to clipboard.
    try {
      await navigator.clipboard.writeText(noteText);
    } catch {
      // Clipboard can fail in some browsers/contexts. Continue anyway —
      // Sean can still paste from the prompt library if needed.
    }

    // 2. Open LinkedIn in a new tab.
    window.open(card.url, "_blank", "noopener,noreferrer");

    // 3. POST log-invitation.
    try {
      const res = await fetch("/api/leads/log-invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedin_url: card.url,
          name: card.name.trim(),
          company: card.company.trim() || null,
          title: card.title.trim() || null,
          prompt_id: card.promptId,
          note_text: noteText,
          source: "outreach_page",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Server returned ${res.status}`);
      }
      setCards((prev) => {
        const next = prev.slice();
        next[idx] = {
          ...next[idx],
          state: "sent",
          sentAt: new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
          leadId: data.lead_id,
          errorMsg: undefined,
        };
        return next;
      });
    } catch (e) {
      setCards((prev) => {
        const next = prev.slice();
        next[idx] = {
          ...next[idx],
          state: "error",
          errorMsg: e instanceof Error ? e.message : "Send failed",
        };
        return next;
      });
    }
  }

  const sendableCount = cards.filter(
    (c) => c.state === "idle" || c.state === "error",
  ).length;
  const sentCount = cards.filter((c) => c.state === "sent").length;
  const invitedCount = cards.filter(
    (c) => c.existing?.found && c.existing?.status === "invited",
  ).length;

  // Group prompts by category for the <select>.
  const promptGroups = useMemo(() => {
    const groups = new Map<string, PromptOption[]>();
    for (const p of prompts) {
      let bucket = groups.get(p.category);
      if (!bucket) groups.set(p.category, (bucket = []));
      bucket.push(p);
    }
    return Array.from(groups.entries());
  }, [prompts]);

  return (
    <div className="px-6 py-8 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Outreach</h1>
        <p className="mt-1 text-sm text-steel">
          Paste LinkedIn URLs, pick the prompt you&apos;re using, send connection
          requests. Each send creates the lead with status{" "}
          <span className="font-semibold text-navy">invited</span> and logs a{" "}
          <span className="font-semibold text-navy">connection_request</span>{" "}
          activity in real time.
        </p>
      </div>

      {/* ── Paste panel ── */}
      <section className="mb-6 rounded-lg border border-navy/10 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-navy">
          Paste LinkedIn profile URLs
        </h2>
        <p className="mt-1 mb-3 text-xs text-steel">
          One URL per line, comma-separated, or any whitespace. Duplicates are
          collapsed.
        </p>

        <textarea
          value={blob}
          onChange={(e) => setBlob(e.target.value)}
          placeholder={
            "https://www.linkedin.com/in/joseph-pisciotta/\nhttps://www.linkedin.com/in/cody-morris-aviation/"
          }
          rows={4}
          className="w-full rounded-md border border-navy/20 px-3 py-2 font-mono text-sm text-charcoal outline-none focus:border-navy focus:ring-2 focus:ring-navy/20"
        />

        {parseError && (
          <p className="mt-2 text-xs font-semibold text-red">{parseError}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-steel">
            Default prompt
          </span>
          <select
            value={defaultPromptId}
            onChange={(e) => setDefaultPromptId(e.target.value)}
            className="rounded-md border border-navy/20 bg-white px-3 py-1.5 text-sm text-charcoal outline-none focus:border-navy focus:ring-2 focus:ring-navy/20"
          >
            {promptGroups.map(([category, list]) => (
              <optgroup
                key={category}
                label={CATEGORY_LABELS[category] ?? category}
              >
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            onClick={assignToAll}
            disabled={cards.length === 0}
            className="rounded-md border border-navy/20 bg-white px-3 py-1.5 text-sm font-semibold text-navy transition hover:border-navy disabled:cursor-not-allowed disabled:opacity-50"
          >
            Assign to all
          </button>
          <button
            type="button"
            onClick={handleParse}
            className="rounded-md bg-navy px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-navy/90"
          >
            Parse URLs
          </button>

          {cards.length > 0 && (
            <span className="ml-auto text-xs text-steel">
              <strong className="text-charcoal">{cards.length} URL{cards.length === 1 ? "" : "s"}</strong>
              {sentCount > 0 && (
                <>
                  {" "}·{" "}
                  <strong className="text-green-700">{sentCount} sent</strong>
                </>
              )}
              {invitedCount > 0 && (
                <>
                  {" "}·{" "}
                  <strong className="text-amber-700">
                    {invitedCount} already invited
                  </strong>
                </>
              )}
            </span>
          )}
        </div>
      </section>

      {/* ── Cards grid ── */}
      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-navy/20 bg-white p-10 text-center text-sm text-steel">
          Paste URLs above and click <strong className="text-navy">Parse URLs</strong> to
          generate a card per profile.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((c, i) => (
            <Card
              key={c.url + i}
              card={c}
              prompts={prompts}
              promptGroups={promptGroups}
              onChangeField={(k, v) => setCardField(i, k, v)}
              onSend={() => sendCard(i)}
              onRemove={() => removeCard(i)}
            />
          ))}
        </div>
      )}

      {sendableCount > 0 && cards.length > 1 && (
        <div className="mt-4 text-xs text-steel">
          Tip: send one at a time so LinkedIn doesn&apos;t flag the activity as
          bot-like.
        </div>
      )}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function Card({
  card,
  prompts,
  promptGroups,
  onChangeField,
  onSend,
  onRemove,
}: {
  card: CardState;
  prompts: PromptOption[];
  promptGroups: Array<[string, PromptOption[]]>;
  onChangeField: <K extends keyof CardState>(key: K, value: CardState[K]) => void;
  onSend: () => void;
  onRemove: () => void;
}) {
  const sent = card.state === "sent";
  const sending = card.state === "sending";
  const error = card.state === "error";
  const alreadyInvited =
    card.existing?.found && card.existing?.status === "invited";

  return (
    <article
      className={`flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm transition ${
        sent
          ? "border-navy/10 bg-offwhite opacity-90"
          : error
            ? "border-red/40"
            : "border-navy/10"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-offwhite text-sm font-bold text-navy">
          {(card.name.trim().split(/\s+/)[0]?.[0] ?? "?").toUpperCase()}
          {(card.name.trim().split(/\s+/)[1]?.[0] ?? "").toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <input
            type="text"
            value={card.name}
            onChange={(e) => onChangeField("name", e.target.value)}
            disabled={sent || sending}
            placeholder="First Last"
            className="block w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-bold text-navy outline-none transition hover:border-navy/20 focus:border-navy focus:bg-white focus:ring-2 focus:ring-navy/20"
          />
          <input
            type="text"
            value={card.title}
            onChange={(e) => onChangeField("title", e.target.value)}
            disabled={sent || sending}
            placeholder="Title (e.g. Director of Maintenance)"
            className="mt-0.5 block w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-steel outline-none transition hover:border-navy/20 focus:border-navy focus:bg-white focus:ring-2 focus:ring-navy/20"
          />
          <input
            type="text"
            value={card.company}
            onChange={(e) => onChangeField("company", e.target.value)}
            disabled={sent || sending}
            placeholder="Company"
            className="mt-0.5 block w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-steel outline-none transition hover:border-navy/20 focus:border-navy focus:bg-white focus:ring-2 focus:ring-navy/20"
          />
        </div>
        {!sent && !sending && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-1 text-steel hover:bg-offwhite hover:text-charcoal"
            aria-label="Remove card"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <a
        href={card.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 truncate font-mono text-[11px] text-steel hover:text-navy"
      >
        <ExternalLink className="h-3 w-3 shrink-0" />
        {pathOf(card.url)}
      </a>

      {alreadyInvited && (
        <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          Already invited
          {card.existing?.invitedAt && (
            <span className="ml-auto font-normal text-amber-600">
              {new Date(card.existing.invitedAt).toLocaleDateString([], {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
        </div>
      )}

      {sent ? (
        <div className="flex items-center gap-2 rounded-md bg-green-50 px-2.5 py-2 text-xs font-semibold text-green-700">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-[10px] font-bold text-white">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          Connection request sent · {card.sentAt}
        </div>
      ) : (
        <div className="border-t border-navy/10 pt-3">
          <select
            value={card.promptId ?? ""}
            onChange={(e) => onChangeField("promptId", e.target.value || null)}
            disabled={sending}
            className="mb-2 w-full rounded-md border border-navy/20 bg-white px-2.5 py-1.5 text-sm text-charcoal outline-none focus:border-navy focus:ring-2 focus:ring-navy/20"
          >
            <option value="">— Pick a prompt —</option>
            {promptGroups.map(([category, list]) => (
              <optgroup
                key={category}
                label={CATEGORY_LABELS[category] ?? category}
              >
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <button
            type="button"
            onClick={onSend}
            disabled={sending || !card.promptId}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-red px-3 py-2 text-sm font-bold text-white transition hover:bg-red/90 disabled:cursor-not-allowed disabled:bg-steel/40"
          >
            {sending ? (
              "Sending…"
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                {alreadyInvited ? "Send anyway" : "Send connection request"}
              </>
            )}
          </button>

          {error && card.errorMsg && (
            <div className="mt-2 rounded-md border border-red/30 bg-red/5 px-2.5 py-2 text-xs text-red">
              <strong>Send failed.</strong> {card.errorMsg}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
