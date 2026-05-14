"use client";

import { useMemo, useRef, useState } from "react";
import { Check, AlertTriangle, ExternalLink, ClipboardList, X } from "lucide-react";

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
  // Parsed name + title + company that Sean enters per card. Pre-filled
  // from the URL slug as a starting point; Sean overrides.
  name: string;
  title: string;
  company: string;
  // Dedupe lookup result.
  existing: {
    found: boolean;
    status?: string;
    invitedAt?: string | null;
    name?: string;
  } | null;
  state: "idle" | "logging" | "logged" | "error";
  loggedAt?: string;
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

export default function OutreachClient({
  prompts,
  titleSuggestions,
  companySuggestions,
}: {
  prompts: PromptOption[];
  titleSuggestions: string[];
  companySuggestions: string[];
}) {
  const [blob, setBlob] = useState("");
  const [cards, setCards] = useState<CardState[]>([]);
  // Ref to the paste textarea so we can refocus it after a successful log
  // — Sean works one URL at a time (he has to type title + company) and
  // wants to paste the next URL without an extra click to clear / focus.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [defaultPromptId, setDefaultPromptId] = useState<string>(
    prompts.find((p) => p.category === "first_contact")?.id ?? prompts[0]?.id ?? "",
  );
  const [parseError, setParseError] = useState<string>("");
  // Local additions to the suggestion lists during this session — anything
  // Sean types in title/company that isn't already in the database, so
  // sibling cards can pick from them too without a page refresh.
  const [titleAdds, setTitleAdds] = useState<string[]>([]);
  const [companyAdds, setCompanyAdds] = useState<string[]>([]);

  const promptById = useMemo(() => {
    const m = new Map<string, PromptOption>();
    for (const p of prompts) m.set(p.id, p);
    return m;
  }, [prompts]);

  const allTitles = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...titleSuggestions, ...titleAdds]) {
      const key = t.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [titleSuggestions, titleAdds]);

  const allCompanies = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...companySuggestions, ...companyAdds]) {
      const key = c.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }, [companySuggestions, companyAdds]);

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
      title: "",
      company: "",
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
        c.state === "logged" || c.state === "logging"
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

  // ── Log a single card ──
  async function logCard(idx: number) {
    const card = cards[idx];
    if (!card || card.state === "logging" || card.state === "logged") return;
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
    // note_text in the API request is what gets stored as the activity
    // summary — using the personalized prompt body documents which prompt
    // Sean used. (We no longer copy this to clipboard; this is a logging
    // tool, not a sending tool.)
    const noteText = personalize(prompt.body, firstName, card.company.trim());

    setCardField(idx, "state", "logging");
    setCardField(idx, "errorMsg", undefined);

    // Capture any newly-typed title / company so they show up in sibling
    // cards' datalists immediately (and on the next page load, once the
    // server-side query picks them up from contacts/companies).
    const trimmedTitle = card.title.trim();
    const trimmedCompany = card.company.trim();
    if (
      trimmedTitle &&
      !allTitles.some((t) => t.toLowerCase() === trimmedTitle.toLowerCase())
    ) {
      setTitleAdds((prev) =>
        prev.some((t) => t.toLowerCase() === trimmedTitle.toLowerCase())
          ? prev
          : [...prev, trimmedTitle],
      );
    }
    if (
      trimmedCompany &&
      !allCompanies.some((c) => c.toLowerCase() === trimmedCompany.toLowerCase())
    ) {
      setCompanyAdds((prev) =>
        prev.some((c) => c.toLowerCase() === trimmedCompany.toLowerCase())
          ? prev
          : [...prev, trimmedCompany],
      );
    }

    try {
      const res = await fetch("/api/leads/log-invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkedin_url: card.url,
          name: card.name.trim(),
          company: trimmedCompany || null,
          title: trimmedTitle || null,
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
          state: "logged",
          loggedAt: new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
          leadId: data.lead_id,
          errorMsg: undefined,
        };
        // Ready the paste box for the next URL. The just-logged card stays
        // visible (with its green Logged · time stamp) until Sean parses
        // a new URL, at which point setCards replaces them.
        setBlob("");
        textareaRef.current?.focus();
        return next;
      });
    } catch (e) {
      setCards((prev) => {
        const next = prev.slice();
        next[idx] = {
          ...next[idx],
          state: "error",
          errorMsg: e instanceof Error ? e.message : "Logging failed",
        };
        return next;
      });
    }
  }

  const loggableCount = cards.filter(
    (c) => c.state === "idle" || c.state === "error",
  ).length;
  const loggedCount = cards.filter((c) => c.state === "logged").length;
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
        <h1 className="text-2xl font-bold text-navy">Log connection requests</h1>
        <p className="mt-1 text-sm text-steel">
          Paste URLs of people you just invited on LinkedIn — they become{" "}
          <span className="font-semibold text-navy">invited</span> leads with
          the prompt attached and a{" "}
          <span className="font-semibold text-navy">connection_request</span>{" "}
          activity in the timeline. No connection requests are sent from this
          page; LinkedIn happens in your other tab.
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
          ref={textareaRef}
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
              {loggedCount > 0 && (
                <>
                  {" "}·{" "}
                  <strong className="text-green-700">{loggedCount} logged</strong>
                </>
              )}
              {invitedCount > 0 && (
                <>
                  {" "}·{" "}
                  <strong className="text-amber-700">
                    {invitedCount} already in portal
                  </strong>
                </>
              )}
            </span>
          )}
        </div>
      </section>

      {/* Shared datalists — one each for titles and companies, referenced by
          all cards. Native HTML autocomplete: shows existing values when the
          field is focused; allows typing anything new. */}
      <datalist id="outreach-title-list">
        {allTitles.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="outreach-company-list">
        {allCompanies.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

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
              promptGroups={promptGroups}
              onChangeField={(k, v) => setCardField(i, k, v)}
              onLog={() => logCard(i)}
              onRemove={() => removeCard(i)}
            />
          ))}
        </div>
      )}

      {loggableCount > 0 && cards.length > 1 && (
        <div className="mt-4 text-xs text-steel">
          Tip: title and company drop down with values you&apos;ve used before.
          Type a new one and it joins the list for next time.
        </div>
      )}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function Card({
  card,
  promptGroups,
  onChangeField,
  onLog,
  onRemove,
}: {
  card: CardState;
  promptGroups: Array<[string, PromptOption[]]>;
  onChangeField: <K extends keyof CardState>(key: K, value: CardState[K]) => void;
  onLog: () => void;
  onRemove: () => void;
}) {
  const logged = card.state === "logged";
  const logging = card.state === "logging";
  const error = card.state === "error";
  const alreadyInvited =
    card.existing?.found && card.existing?.status === "invited";

  const fieldClass =
    "block w-full rounded-md border border-navy/15 bg-white px-2 py-1 text-sm text-charcoal outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/20 disabled:cursor-not-allowed disabled:bg-offwhite disabled:text-steel";

  return (
    <article
      className={`flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm transition ${
        logged
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
        <div className="min-w-0 flex-1 space-y-1">
          <input
            type="text"
            value={card.name}
            onChange={(e) => onChangeField("name", e.target.value)}
            disabled={logged || logging}
            placeholder="First Last"
            className={`${fieldClass} text-sm font-bold text-navy`}
          />
          <input
            type="text"
            value={card.title}
            onChange={(e) => onChangeField("title", e.target.value)}
            disabled={logged || logging}
            placeholder="Title (e.g. Director of Maintenance)"
            list="outreach-title-list"
            className={fieldClass}
          />
          <input
            type="text"
            value={card.company}
            onChange={(e) => onChangeField("company", e.target.value)}
            disabled={logged || logging}
            placeholder="Company"
            list="outreach-company-list"
            className={fieldClass}
          />
        </div>
        {!logged && !logging && (
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
          Already in portal — invited
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

      {logged ? (
        <div className="flex items-center gap-2 rounded-md bg-green-50 px-2.5 py-2 text-xs font-semibold text-green-700">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-600 text-[10px] font-bold text-white">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          Logged · {card.loggedAt}
        </div>
      ) : (
        <div className="border-t border-navy/10 pt-3">
          <select
            value={card.promptId ?? ""}
            onChange={(e) => onChangeField("promptId", e.target.value || null)}
            disabled={logging}
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
            onClick={onLog}
            disabled={logging || !card.promptId}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-navy px-3 py-2 text-sm font-bold text-white transition hover:bg-navy/90 disabled:cursor-not-allowed disabled:bg-steel/40"
          >
            {logging ? (
              "Logging…"
            ) : (
              <>
                <ClipboardList className="h-3.5 w-3.5" />
                {alreadyInvited ? "Log anyway" : "Log invitation"}
              </>
            )}
          </button>

          {error && card.errorMsg && (
            <div className="mt-2 rounded-md border border-red/30 bg-red/5 px-2.5 py-2 text-xs text-red">
              <strong>Failed.</strong> {card.errorMsg}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
