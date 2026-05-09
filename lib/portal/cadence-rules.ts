// Shared payload validation for the cadence-rules CRUD endpoints.

export interface RulePayload {
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
    if (body.action_on_send !== "none" && body.action_on_send !== "mark_lost") {
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
