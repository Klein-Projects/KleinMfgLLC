import SyncClient from "./SyncClient";

export const dynamic = "force-dynamic";

// /portal/settings/sync — manual triggers for the Cowork scraper tasks.
//
// The page itself is a server component so we can read the per-task env
// var presence and tell the client which buttons should be enabled
// (without leaking the actual webhook URL to the browser).

const TASK_ENV_MAP: Record<string, string> = {
  "sent-invitations": "COWORK_TRIGGER_SENT_INVITATIONS_URL",
  "dm-inbox": "COWORK_TRIGGER_DM_INBOX_URL",
};

export default function SettingsSyncPage() {
  const tasks = Object.entries(TASK_ENV_MAP).map(([task, env]) => ({
    task,
    envVar: env,
    configured: !!process.env[env],
  }));

  return <SyncClient tasks={tasks} />;
}
