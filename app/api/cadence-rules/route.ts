import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateRulePayload } from "@/lib/portal/cadence-rules";

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

