import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateRulePayload } from "../route";

// PATCH /api/cadence-rules/:id
//   Partial update. Used for inline active toggle and the edit modal.
//
// DELETE /api/cadence-rules/:id
//   Hard delete. RESTRICT on the prompt_id FK already prevents prompt
//   deletion while a rule references it; rule deletion has no FK
//   dependents.

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const validated = validateRulePayload(body, { requireAll: false });
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    ...validated.payload,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("cadence_rules")
    .update(updates)
    .eq("id", params.id)
    .select(
      "id, name, trigger_event, days_after_trigger, prompt_id, action_on_send, active, display_order, created_at, updated_at",
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rule: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("cadence_rules")
    .delete()
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
