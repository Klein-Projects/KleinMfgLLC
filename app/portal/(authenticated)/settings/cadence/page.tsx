"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Power,
  ArrowRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────

type TriggerEvent = "connection_accepted" | "sample_delivered";
type Action = "none" | "mark_lost";

interface PromptOption {
  id: string;
  category: string;
  title: string;
  body: string;
}

interface Rule {
  id: string;
  name: string;
  trigger_event: TriggerEvent;
  days_after_trigger: number;
  prompt_id: string;
  action_on_send: Action;
  active: boolean;
  display_order: number;
  prompt: { id: string; title: string; category: string; body: string } | null;
}

const TRIGGER_LABEL: Record<TriggerEvent, string> = {
  connection_accepted: "After Connection Accepted",
  sample_delivered:    "After Sample Delivered",
};

const TRIGGER_HINT: Record<TriggerEvent, string> = {
  connection_accepted:
    "Days counted from when the lead accepted Sean's LinkedIn connection request.",
  sample_delivered:
    "Days counted from the most recent delivered sample shipment for this lead.",
};

const ACTION_LABEL: Record<Action, string> = {
  none:       "None",
  mark_lost:  "Mark as Lost",
};

const PROMPT_CATEGORY_LABEL: Record<string, string> = {
  first_contact:   "First Contact",
  follow_up:       "Follow-Up",
  no_reply:        "No Reply",
  sample_followup: "Sample Follow-Up",
  won:             "Closed/Won",
  nurture:         "Nurture",
};

// ── Page ───────────────────────────────────────────────────────────────

export default function CadenceRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [prompts, setPrompts] = useState<PromptOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creatingFor, setCreatingFor] = useState<TriggerEvent | null>(null);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [rulesRes, promptsRes] = await Promise.all([
        fetch("/api/cadence-rules"),
        createClient()
          .from("prompt_templates")
          .select("id, category, title, body")
          .order("category")
          .order("title"),
      ]);
      const rulesJson = await rulesRes.json();
      if (!rulesRes.ok) throw new Error(rulesJson.error ?? "Failed to load rules");
      setRules(rulesJson.rules ?? []);
      setPrompts((promptsRes.data as PromptOption[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function toggleActive(rule: Rule) {
    setError("");
    try {
      const res = await fetch(`/api/cadence-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !rule.active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function deleteRule(rule: Rule) {
    if (
      !confirm(
        `Delete "${rule.name}"? This is permanent — leads relying on this rule will stop surfacing.`,
      )
    ) {
      return;
    }
    setError("");
    try {
      const res = await fetch(`/api/cadence-rules/${rule.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const grouped = useMemo(() => {
    const out: Record<TriggerEvent, Rule[]> = {
      connection_accepted: [],
      sample_delivered:    [],
    };
    for (const r of rules) {
      out[r.trigger_event].push(r);
    }
    return out;
  }, [rules]);

  return (
    <div className="px-6 py-8 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Cadence Rules</h1>
        <p className="mt-1 max-w-3xl text-sm text-steel">
          Each rule fires once per lead: when the lead's trigger date plus
          the days-after-trigger lands today or earlier, the lead surfaces
          on <span className="font-semibold text-navy">/portal/today</span> with
          this rule's prompt. If a lead has replied since the last outbound
          message, the queue skips it entirely. Toggle a rule off to pause
          its pattern without losing the configuration.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red bg-red/10 px-4 py-3 text-sm font-semibold text-red"
        >
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-steel">Loading…</p>
      ) : (
        <div className="space-y-8">
          {(["connection_accepted", "sample_delivered"] as const).map(
            (trigger) => (
              <RuleGroup
                key={trigger}
                trigger={trigger}
                rules={grouped[trigger]}
                onAdd={() => setCreatingFor(trigger)}
                onEdit={(rule) => setEditing(rule)}
                onToggle={toggleActive}
                onDelete={deleteRule}
              />
            ),
          )}
        </div>
      )}

      {editing && (
        <RuleModal
          mode="edit"
          rule={editing}
          prompts={prompts}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadAll();
          }}
        />
      )}

      {creatingFor && (
        <RuleModal
          mode="create"
          trigger={creatingFor}
          prompts={prompts}
          onClose={() => setCreatingFor(null)}
          onSaved={() => {
            setCreatingFor(null);
            loadAll();
          }}
        />
      )}
    </div>
  );
}

// ── Rule group (one trigger) ───────────────────────────────────────────

function RuleGroup({
  trigger,
  rules,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: {
  trigger: TriggerEvent;
  rules: Rule[];
  onAdd: () => void;
  onEdit: (rule: Rule) => void;
  onToggle: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-navy/10 bg-white">
      <header className="flex items-start justify-between gap-4 border-b border-navy/10 bg-offwhite px-5 py-4">
        <div>
          <h2 className="text-base font-bold text-navy">
            {TRIGGER_LABEL[trigger]}
          </h2>
          <p className="mt-0.5 text-xs text-steel">{TRIGGER_HINT[trigger]}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-navy/90"
        >
          <Plus className="h-3.5 w-3.5" /> Add Rule
        </button>
      </header>

      {rules.length === 0 ? (
        <p className="px-5 py-6 text-sm text-steel">
          No rules in this group yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-navy/10 text-sm">
            <thead className="bg-white text-left text-[11px] font-semibold uppercase tracking-wide text-steel">
              <tr>
                <th className="px-4 py-2.5 w-16">Order</th>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5 w-20">Days</th>
                <th className="px-4 py-2.5">Prompt</th>
                <th className="px-4 py-2.5 w-32">On Send</th>
                <th className="px-4 py-2.5 w-24">Status</th>
                <th className="px-4 py-2.5 w-44 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/5">
              {rules.map((rule) => (
                <tr key={rule.id} className="align-top">
                  <td className="px-4 py-3 text-charcoal/60">
                    {rule.display_order}
                  </td>
                  <td className="px-4 py-3 font-semibold text-navy">
                    {rule.name}
                  </td>
                  <td className="px-4 py-3 text-charcoal">
                    {rule.days_after_trigger}d
                  </td>
                  <td className="px-4 py-3 text-charcoal">
                    {rule.prompt ? (
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-navy/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy">
                          {PROMPT_CATEGORY_LABEL[rule.prompt.category] ??
                            rule.prompt.category}
                        </span>
                        <span>{rule.prompt.title}</span>
                      </div>
                    ) : (
                      <span className="text-steel">— missing —</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {rule.action_on_send === "mark_lost" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red/10 px-2 py-0.5 text-[11px] font-semibold text-red">
                        Mark Lost
                      </span>
                    ) : (
                      <span className="text-steel">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {rule.active ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                        <Check className="h-3 w-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-steel/10 px-2 py-0.5 text-[11px] font-semibold text-steel">
                        <X className="h-3 w-3" /> Off
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onEdit(rule)}
                        className="inline-flex items-center gap-1 rounded-md border border-navy/20 bg-white px-2 py-1 text-[11px] font-semibold text-navy hover:border-navy"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggle(rule)}
                        className="inline-flex items-center gap-1 rounded-md border border-navy/20 bg-white px-2 py-1 text-[11px] font-semibold text-navy hover:border-navy"
                      >
                        <Power className="h-3 w-3" />
                        {rule.active ? "Off" : "On"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(rule)}
                        className="inline-flex items-center gap-1 rounded-md border border-red/40 bg-white px-2 py-1 text-[11px] font-semibold text-red hover:border-red hover:bg-red/5"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Edit / create modal ────────────────────────────────────────────────

function RuleModal({
  mode,
  rule,
  trigger,
  prompts,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  rule?: Rule;
  trigger?: TriggerEvent;
  prompts: PromptOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialTrigger: TriggerEvent =
    rule?.trigger_event ?? trigger ?? "connection_accepted";

  const [name, setName] = useState(rule?.name ?? "");
  const [triggerEvent, setTriggerEvent] = useState<TriggerEvent>(initialTrigger);
  const [days, setDays] = useState<string>(
    rule?.days_after_trigger != null ? String(rule.days_after_trigger) : "",
  );
  const [promptId, setPromptId] = useState<string>(rule?.prompt_id ?? "");
  const [actionOnSend, setActionOnSend] = useState<Action>(
    rule?.action_on_send ?? "none",
  );
  const [active, setActive] = useState<boolean>(rule?.active ?? true);
  const [displayOrder, setDisplayOrder] = useState<string>(
    rule?.display_order != null ? String(rule.display_order) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const groupedPrompts = useMemo(() => {
    const out: Record<string, PromptOption[]> = {};
    for (const p of prompts) {
      (out[p.category] ??= []).push(p);
    }
    return out;
  }, [prompts]);

  const selectedPrompt = prompts.find((p) => p.id === promptId);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError("");
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        trigger_event: triggerEvent,
        days_after_trigger: Number(days),
        prompt_id: promptId,
        action_on_send: actionOnSend,
        active,
      };
      if (displayOrder !== "") body.display_order = Number(displayOrder);

      const res =
        mode === "create"
          ? await fetch("/api/cadence-rules", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
          : await fetch(`/api/cadence-rules/${rule!.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-charcoal outline-none focus:border-navy focus:ring-2 focus:ring-navy/20";
  const labelClass =
    "block text-xs font-semibold uppercase tracking-wide text-steel";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-navy/10 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-navy">
              {mode === "create" ? "New Cadence Rule" : `Edit "${rule!.name}"`}
            </h2>
            <p className="mt-0.5 text-xs text-steel">
              {TRIGGER_HINT[triggerEvent]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-steel hover:text-navy"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={submit} className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass}>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 7-Day Post-Delivery Check-In"
                required
                className={`${inputClass} mt-1`}
              />
            </div>

            <div>
              <label className={labelClass}>Trigger</label>
              <select
                value={triggerEvent}
                onChange={(e) => setTriggerEvent(e.target.value as TriggerEvent)}
                className={`${inputClass} mt-1`}
              >
                <option value="connection_accepted">
                  After Connection Accepted
                </option>
                <option value="sample_delivered">After Sample Delivered</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Days After Trigger</label>
              <input
                type="number"
                min="0"
                step="1"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                required
                className={`${inputClass} mt-1`}
              />
            </div>

            <div className="sm:col-span-2">
              <label className={labelClass}>Prompt</label>
              <select
                value={promptId}
                onChange={(e) => setPromptId(e.target.value)}
                required
                className={`${inputClass} mt-1`}
              >
                <option value="" disabled>
                  Select a prompt…
                </option>
                {Object.keys(groupedPrompts)
                  .sort()
                  .map((cat) => (
                    <optgroup
                      key={cat}
                      label={PROMPT_CATEGORY_LABEL[cat] ?? cat}
                    >
                      {groupedPrompts[cat].map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </optgroup>
                  ))}
              </select>
            </div>

            {selectedPrompt && (
              <div className="sm:col-span-2">
                <label className={labelClass}>Prompt Body Preview</label>
                <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-navy/10 bg-offwhite px-3.5 py-3 text-sm leading-relaxed text-charcoal">
                  {selectedPrompt.body}
                </div>
              </div>
            )}

            <div>
              <label className={labelClass}>Action on Send</label>
              <select
                value={actionOnSend}
                onChange={(e) => setActionOnSend(e.target.value as Action)}
                className={`${inputClass} mt-1`}
              >
                <option value="none">None</option>
                <option value="mark_lost">Mark as Lost</option>
              </select>
              <p className="mt-1 text-[11px] text-steel">
                {actionOnSend === "mark_lost"
                  ? "Lead status flips to Lost when this rule's button is clicked. Use for the final no-reply touch."
                  : "No status change beyond logging the activity."}
              </p>
            </div>

            <div>
              <label className={labelClass}>Display Order</label>
              <input
                type="number"
                step="1"
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
                placeholder="auto"
                className={`${inputClass} mt-1`}
              />
              <p className="mt-1 text-[11px] text-steel">
                Lower numbers list first. Leave blank to append.
              </p>
            </div>

            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="h-4 w-4 rounded border-navy/30 text-navy focus:ring-navy/40"
                />
                <span className="font-semibold text-charcoal">Active</span>
                <ArrowRight className="h-3 w-3 text-steel" />
                <span className="text-steel">
                  surfaces matching leads on /portal/today
                </span>
              </label>
            </div>
          </div>

          {formError && (
            <div className="rounded-md border border-red bg-red/10 px-3 py-2 text-sm font-semibold text-red">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-navy/10 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-md border border-navy/20 bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy/90 disabled:opacity-60"
            >
              {submitting ? "Saving…" : mode === "create" ? "Create Rule" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
