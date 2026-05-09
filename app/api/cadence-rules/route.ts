import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/cadence-rules
//   List every cadence rule with its joined prompt title + body so the
//   Settings UI can render the table and the edit-modal preview without
//   a second round trip.
//
// POST /api/cadence-rules
//   Create a new rule. Body: { name, trigger_event, days_after_trigger,
//                              prompt_id, action_on_send?, active?,
//                              display_order? }
//   When display_order is omitted, lands at the end of its trigger group.

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("cadence_rules")
    .select(
      "id, name, trigger_event, days_after_trigger, prompt_id, action_on_send, active, display_order, created_at, updated_at, prompt:prompt_templates(id, title, category, body)",
    )
    .order("trigger_event", { ascending: true })
    .order("display_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const validated = validateRulePayload(body, { requireAll: true });
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const payload = validated.payload;

  // If no display_order provided, append to the end of the trigger group.
  let displayOrder = payload.display_order;
  if (displayOrder === undefined) {
    const { data: maxRow } = await supabase
      .from("cadence_rules")
      .select("display_order")
      .eq("trigger_event", payload.trigger_event)
      .order("display_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    displayOrder = (maxRow?.display_order ?? 0) + 10;
  }

  const { data, error } = await supabase
    .from("cadence_rules")
    .insert({
      name: payload.name,
      trigger_event: payload.trigger_event,
      days_after_trigger: payload.days_after_trigger,
      prompt_id: payload.prompt_id,
      action_on_send: payload.action_on_send ?? "none",
      active: payload.active ?? true,
      display_order: displayOrder,
    })
    .select(
      "id, name, trigger_event, days_after_trigger, prompt_id, action_on_send, active, display_order, created_at, updated_at",
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rule: data }, { status: 201 });
}

// ── Shared payload validation ──

interface RulePayload {
  name: string;
  trigger_event: "connection_accepted" | "sample_delivered";
  days_after_trigger: number;
  prompt_id: string;
  action_on_send?: "none" | "mark_lost";
  active?: boolean;
  display_order?: number;
}

export function validateRulePayload(
  body: any,
  opts: { requireAll: boolean },
): { payload: RulePayload } | { error: string } {
  const out: Partial<RulePayload> = {};

  const need = (key: keyof RulePayload) =>
    opts.requireAll || body[key] !== undefined;

  if (need("name")) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return { error: "Name is required" };
    }
    out.name = body.name.trim();
  }

  if (need("trigger_event")) {
    if (
      body.trigger_event !== "connection_accepted" &&
      body.trigger_event !== "sample_delivered"
    ) {
      return {
        error:
          'trigger_event must be "connection_accepted" or "sample_delivered"',
      };
    }
    out.trigger_event = body.trigger_event;
  }

  if (need("days_after_trigger")) {
    const n = Number(body.days_after_trigger);
    if (!Number.isInteger(n) || n < 0) {
      return { error: "days_after_trigger must be a non-negative integer" };
    }
    out.days_after_trigger = n;
  }

  if (need("prompt_id")) {
    if (typeof body.prompt_id !== "string" || !body.prompt_id) {
      return { error: "prompt_id is required" };
    }
    out.prompt_id = body.prompt_id;
  }

  if (body.action_on_send !== undefined) {
    if (
      body.action_on_send !== "none" &&
      body.action_on_send !== "mark_lost"
    ) {
      return { error: 'action_on_send must be "none" or "mark_lost"' };
    }
    out.action_on_send = body.action_on_send;
  }

  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return { error: "active must be a boolean" };
    }
    out.active = body.active;
  }

  if (body.display_order !== undefined) {
    const n = Number(body.display_order);
    if (!Number.isInteger(n)) {
      return { error: "display_order must be an integer" };
    }
    out.display_order = n;
  }

  return { payload: out as RulePayload };
}
