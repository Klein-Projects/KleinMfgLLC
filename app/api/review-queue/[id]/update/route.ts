import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/review-queue/:id/update — Phase 4 follow-on
//
// Lets Sean edit the payload of a pending review_queue row before
// approving. Most common case: the deep-historical scraper found a
// thread it could match to no existing lead and dropped a
// "Unknown lead · ? → contacted" stage_change. Sean opens LinkedIn,
// recognizes the person, fills in first_name / last_name / title /
// company, hits Save. If the row is a stage_change with no matched
// lead and Sean filled in a name, we promote the kind to new_lead
// with proposed_status = to_status so Approve actually creates the
// lead instead of returning 422 "no matching lead".
//
// Body (all optional, patch-style):
//   first_name, last_name, name, title, company,
//   summary, wake_up_reason, wake_up_at,
//   promote_to_new_lead (boolean, default auto-detected)
//
// Returns the updated row.
//
// Auth: cookie session.

function asStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

const VALID_LEAD_STATUSES = new Set([
  "new",
  "invited",
  "contacted",
  "engaged",
  "sample_sent",
  "quoted",
  "won",
  "lost",
  "nurture",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { data: row, error: fetchErr } = await supabase
    .from("review_queue")
    .select("id, kind, payload, lead_id, linkedin_thread_id, status")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      { error: "Review queue row not found" },
      { status: 404 },
    );
  }
  if (row.status !== "pending") {
    return NextResponse.json(
      { error: `Row is already ${row.status}; can only edit pending rows.` },
      { status: 409 },
    );
  }

  const current = (row.payload ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  const firstName = asStr(body.first_name);
  const lastName = asStr(body.last_name);
  const nameFromBody = asStr(body.name);
  // Build a canonical "name" if either piece is provided. Falls back
  // to the existing payload.name if neither piece was sent.
  if (firstName || lastName || nameFromBody) {
    const composed = nameFromBody ?? `${firstName ?? ""} ${lastName ?? ""}`.trim();
    if (composed) patch.name = composed;
    if (firstName) patch.first_name = firstName;
    if (lastName) patch.last_name = lastName;
  }

  const title = asStr(body.title);
  if (title !== null) patch.title = title;

  const company = asStr(body.company);
  if (company !== null) patch.company = company;

  const summary = asStr(body.summary);
  if (summary !== null) patch.summary = summary;

  const wakeReason = asStr(body.wake_up_reason);
  if (wakeReason !== null) patch.wake_up_reason = wakeReason;

  const wakeAt = asStr(body.wake_up_at);
  if (wakeAt !== null) patch.wake_up_at = wakeAt;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update — send at least one editable field." },
      { status: 400 },
    );
  }

  const mergedPayload: Record<string, unknown> = { ...current, ...patch };

  // Auto-promote: stage_change rows that didn't match an existing
  // lead are useless on approve (returns 422). If Sean filled in a
  // name, flip the kind to new_lead so approve creates the lead.
  // Caller can override with promote_to_new_lead: false.
  let newKind: string = row.kind;
  const hasName = !!asStr(mergedPayload.name);
  const wantsPromote =
    typeof body.promote_to_new_lead === "boolean"
      ? body.promote_to_new_lead
      : row.kind === "stage_change" && !row.lead_id && hasName;

  if (wantsPromote && row.kind === "stage_change") {
    newKind = "new_lead";
    const toStatus = asStr(current.to_status);
    if (toStatus && VALID_LEAD_STATUSES.has(toStatus)) {
      mergedPayload.proposed_status = toStatus;
    } else {
      mergedPayload.proposed_status = "contacted";
    }
  }

  const updateFields: Record<string, unknown> = { payload: mergedPayload };
  if (newKind !== row.kind) updateFields.kind = newKind;

  const { data: updated, error: updErr } = await supabase
    .from("review_queue")
    .update(updateFields)
    .eq("id", id)
    .select("id, kind, payload, status")
    .single();
  if (updErr || !updated) {
    return NextResponse.json(
      { error: updErr?.message ?? "Failed to update row" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    id: updated.id,
    kind: updated.kind,
    payload: updated.payload,
    promoted_to_new_lead: newKind === "new_lead" && row.kind === "stage_change",
  });
}
