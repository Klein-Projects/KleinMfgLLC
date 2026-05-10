import SyncClient from "./SyncClient";

export const dynamic = "force-dynamic";

// /portal/settings/sync - manual triggers for the Cowork scraper tasks.
//
// Implementation switched from "POST a Cowork webhook URL" (never
// shipped, Cowork does not expose public webhooks) to a polling
// pattern: the button writes a sync_triggers row, and a Cowork
// scheduled task (klein-sync-poller) picks it up within ~5 minutes
// and runs the matching scrape inline.

export default function SettingsSyncPage() {
  const tasks = [{ task: "sent-invitations" }, { task: "dm-inbox" }];
  return <SyncClient tasks={tasks} />;
}
