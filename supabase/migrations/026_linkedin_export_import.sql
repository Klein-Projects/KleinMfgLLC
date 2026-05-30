-- ============================================================
-- Klein Manufacturing LLC — Phase 2.5 Step 3: LinkedIn export import
--
-- Loads the official LinkedIn data export (messages, connections,
-- invitations) into the portal. Replaces the data the retired
-- scrapers used to produce. This is a one-shot data load, not a
-- schema change — staged into temp tables, processed via JOINs
-- against leads/contacts/companies, then the staging is dropped.
--
-- What this migration does, in order:
--   1. Create 4 staging tables (_import_*).
--   2. INSERT 721 messages, 271 threads, 225 connections,
--      164 invitations into staging.
--   3. Match each thread's "other party" LinkedIn URL against
--      existing leads.linkedin_url (normalized — case-insensitive
--      host, trailing-slash insensitive).
--   4. For threads with NO matching lead and a known URL: create
--      a company (find-or-create by name), a contact (first/last/
--      title from Connections.csv), and a lead. source='linkedin_export'.
--   5. Insert one activities row per staged message — type=
--      'linkedin_message', direction inbound/outbound, body =
--      verbatim message text, source='linkedin_export',
--      linkedin_message_urn = deterministic dedup key
--      ('export:<conv_id>:<ts>:<sha1[:8]>'). NOT EXISTS guard
--      against the partial-unique-index from migration 023.
--   6. Backfill leads.linkedin_thread_id where null, invited_at
--      from OUTGOING Invitations.csv, connection_accepted_at
--      from Connections.csv.
--   7. Drop the 4 staging tables.
--
-- Out of scope (intentionally NOT touched):
--   * leads previously classified — Phase 2 classifier output
--     (conversation_state, suggested_prompt_id, state_*) stays
--     as-is. It is now stale relative to the new activity history
--     and should be re-run by Claude Code / the portal classifier
--     after this migration applies.
--   * shipments, orders, prompt_templates, review_queue
--   * Threads with no other-party URL (~75) — these are messages
--     from accounts that no longer exist on LinkedIn. We skip
--     creating leads for them but still ingest their messages
--     against any existing lead matched by name (best-effort).
--
-- Idempotent: re-running this migration is safe — the activities
-- NOT EXISTS guard prevents duplicate URNs, and the find-or-create
-- logic for companies/contacts/leads uses NOT EXISTS guards too.
-- Re-runs that import NO new data are a no-op.
-- ============================================================

BEGIN;
SET LOCAL statement_timeout = '10min';

-- ============================================================
-- 1. Staging tables
-- ============================================================
DROP TABLE IF EXISTS _import_messages;
DROP TABLE IF EXISTS _import_threads;
DROP TABLE IF EXISTS _import_connections;
DROP TABLE IF EXISTS _import_invitations;

CREATE TABLE _import_messages (
  urn text PRIMARY KEY,
  conversation_id text NOT NULL,
  date_iso timestamptz,
  direction text NOT NULL,
  other_url text,
  other_name text,
  body text,
  subject text,
  folder text
);
CREATE TABLE _import_threads (
  conversation_id text PRIMARY KEY,
  other_url text,
  other_name text,
  first_date timestamptz,
  last_date timestamptz,
  msg_count int
);
CREATE TABLE _import_connections (
  url text PRIMARY KEY,
  first_name text,
  last_name text,
  email text,
  company text,
  position text,
  connected_on timestamptz
);
CREATE TABLE _import_invitations (
  inviter_url text,
  invitee_url text,
  direction text,
  sent_at timestamptz,
  message text,
  from_name text,
  to_name text
);

CREATE INDEX ON _import_messages (conversation_id);
CREATE INDEX ON _import_messages (other_url);
CREATE INDEX ON _import_threads (other_url);
CREATE INDEX ON _import_connections (url);
CREATE INDEX ON _import_invitations (invitee_url);



-- ============================================================

-- 2. Stage data inserts

-- ============================================================

INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-YTIxMDliNDUtMDMxYi00M2Q0LWJkYWItZDIxMDA1NzU0YTY4XzEwMA==:20260526T05050:57217073','2-YTIxMDliNDUtMDMxYi00M2Q0LWJkYWItZDIxMDA1NzU0YTY4XzEwMA==','2026-05-26T05:05:04+00','inbound',NULL,'Lisa Williams','Your background matches some of our paid board and advisory positions that we have been retained to do a search for and present candidates to. We would love to have a discussion with you! Please schedule a call at your earliest convenience. See calendar below.

https://calendly.com/boardsi/board-seat-inquiry-l11?month=2025-03',NULL,'INBOX'),
('export:2-NjM5ZWM1NjEtZTJhZi00MmEyLWI2MzEtOThiODExZjI0MDU1XzEwMA==:20260524T00060:0285d5f2','2-NjM5ZWM1NjEtZTJhZi00MmEyLWI2MzEtOThiODExZjI0MDU1XzEwMA==','2026-05-24T00:06:04+00','outbound','https://www.linkedin.com/in/darryl-best-1ab34b184','Darryl Best','Hi Darryl, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-YmNlYjg2ODktNWU0MC00ZjQxLWE5NDUtMGQ5NWI5MGMwOTc1XzEwMA==:20260523T08500:6363ed86','2-YmNlYjg2ODktNWU0MC00ZjQxLWE5NDUtMGQ5NWI5MGMwOTc1XzEwMA==','2026-05-23T08:50:01+00','inbound','https://www.linkedin.com/in/luis-tellez-3913505b','Luis Tellez','Thanks Sean not at this moment',NULL,'INBOX'),
('export:2-YmNlYjg2ODktNWU0MC00ZjQxLWE5NDUtMGQ5NWI5MGMwOTc1XzEwMA==:20260521T01131:006d4ed4','2-YmNlYjg2ODktNWU0MC00ZjQxLWE5NDUtMGQ5NWI5MGMwOTc1XzEwMA==','2026-05-21T01:13:10+00','outbound','https://www.linkedin.com/in/luis-tellez-3913505b','Luis Tellez','Hi Luis, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you and your team to check out.',NULL,'INBOX'),
('export:2-YmNlYjg2ODktNWU0MC00ZjQxLWE5NDUtMGQ5NWI5MGMwOTc1XzEwMA==:20260330T12183:e44808aa','2-YmNlYjg2ODktNWU0MC00ZjQxLWE5NDUtMGQ5NWI5MGMwOTc1XzEwMA==','2026-03-30T12:18:32+00','outbound','https://www.linkedin.com/in/luis-tellez-3913505b','Luis Tellez','Hi Luis, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==:20260521T02174:45338d62','2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==','2026-05-21T02:17:40+00','outbound','https://www.linkedin.com/in/skyleroxford','Skyler  Oxford','Hey Sky!  Just wanted to check in and see if you''ve had a chance to test the scrapers yet.  Please let me know when you can, and feel free to reach out with any questions.  You can reach me on here, or you can email me: sales@kleinmfgllc.com, or you can call/text me: 916-671-4772.  Thanks.',NULL,'INBOX'),
('export:2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==:20260508T04161:671fdd69','2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==','2026-05-08T04:16:18+00','outbound','https://www.linkedin.com/in/skyleroxford','Skyler  Oxford','Hey Sky, sounds good, keep me posted! Looking forward to hearing what you guys think once you get a chance to use them.',NULL,'INBOX'),
('export:2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==:20260506T16351:fc6fa9df','2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==','2026-05-06T16:35:19+00','inbound','https://www.linkedin.com/in/skyleroxford','Skyler  Oxford','Package has been received! Will get a video when we get the right situation for it!',NULL,'INBOX'),
('export:2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==:20260429T21462:952332a4','2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==','2026-04-29T21:46:27+00','outbound','https://www.linkedin.com/in/skyleroxford','Skyler  Oxford','That sounds great, thank you Sky!',NULL,'INBOX'),
('export:2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==:20260429T16023:b06bc743','2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==','2026-04-29T16:02:35+00','inbound','https://www.linkedin.com/in/skyleroxford','Skyler  Oxford','We are excited to see what it''s all about. I''ll make sure to get a video of the product and see what it''s all about!',NULL,'INBOX'),
('export:2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==:20260429T13333:ef11ae16','2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==','2026-04-29T13:33:32+00','outbound','https://www.linkedin.com/in/skyleroxford','Skyler  Oxford','Good morning Sky! Just wanted to let you know I sent out two samples of each (6" and 11") scraper today via UPS ground.  Tracking number is 1Z0592W00341922604, estimated arrival is Wednesday May 6th.

Looking forward to hearing your feedback once you''ve had a chance to try them out.  Thank you for the opportunity.',NULL,'INBOX'),
('export:2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==:20260428T13441:d3d22b42','2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==','2026-04-28T13:44:12+00','outbound','https://www.linkedin.com/in/skyleroxford','Skyler  Oxford','Perfect, thanks. I''ll get a set of samples sent out to you this afternoon. Looking forward to hearing what you and your team think.',NULL,'INBOX'),
('export:2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==:20260427T23511:4236b906','2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==','2026-04-27T23:51:17+00','inbound','https://www.linkedin.com/in/skyleroxford','Skyler  Oxford','excited to give it a try!',NULL,'INBOX'),
('export:2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==:20260427T23505:9b1a969d','2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==','2026-04-27T23:50:58+00','inbound','https://www.linkedin.com/in/skyleroxford','Skyler  Oxford','3205 Eastfield Station Drive Unit 309 Charlotte NC 28269',NULL,'INBOX'),
('export:2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==:20260427T16193:619f5874','2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==','2026-04-27T16:19:37+00','outbound','https://www.linkedin.com/in/skyleroxford','Skyler  Oxford','That''s great to hear. Happy to send a set out for you and your team to check out, just let me know the best shipping address and I''ll get them headed your way.',NULL,'INBOX'),
('export:2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==:20260427T15293:df1bb362','2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==','2026-04-27T15:29:38+00','inbound','https://www.linkedin.com/in/skyleroxford','Skyler  Oxford','I''m not against it what so ever. Was just showing it to my team and they all seemed interested in what it''s about!',NULL,'INBOX'),
('export:2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==:20260427T03362:3672fc75','2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==','2026-04-27T03:36:25+00','outbound','https://www.linkedin.com/in/skyleroxford','Skyler  Oxford','Hi Sky, I saw you liked Tina''s post on the scrapers, I appreciate that. Let me know if you''d ever like to check out some samples, happy to send a set your way.',NULL,'INBOX'),
('export:2-MGY2NzExYmQtNThhOS00ZjNlLThkMWMtYzEyYjE1YzhhZTcyXzEwMA==:20260521T01264:49360404','2-MGY2NzExYmQtNThhOS00ZjNlLThkMWMtYzEyYjE1YzhhZTcyXzEwMA==','2026-05-21T01:26:45+00','outbound','https://www.linkedin.com/in/michele-pelton-216b853b','Michele Pelton','Hi Michele, I know LinkedIn messages can get buried so I wanted to try one more time. I''d mentioned sending over a couple of our phenolic scrapers for your team to try out, still happy to do that if there''s any interest.

If the timing''s off or it''s just not a fit, totally understand. Either way, I appreciate you connecting.',NULL,'INBOX'),
('export:2-MGY2NzExYmQtNThhOS00ZjNlLThkMWMtYzEyYjE1YzhhZTcyXzEwMA==:20260330T23454:d5b618a6','2-MGY2NzExYmQtNThhOS00ZjNlLThkMWMtYzEyYjE1YzhhZTcyXzEwMA==','2026-03-30T23:45:45+00','outbound','https://www.linkedin.com/in/michele-pelton-216b853b','Michele Pelton','Hi Michele, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-MGY2NzExYmQtNThhOS00ZjNlLThkMWMtYzEyYjE1YzhhZTcyXzEwMA==:20260325T21513:9e0bf691','2-MGY2NzExYmQtNThhOS00ZjNlLThkMWMtYzEyYjE1YzhhZTcyXzEwMA==','2026-03-25T21:51:35+00','outbound','https://www.linkedin.com/in/michele-pelton-216b853b','Michele Pelton','Hi Michele, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-OGFlZTBmNTYtMTFlMS00OWQ0LWI3MTAtODBmZTRlMWQ0MWRmXzEwMA==:20260521T01261:c25e42e1','2-OGFlZTBmNTYtMTFlMS00OWQ0LWI3MTAtODBmZTRlMWQ0MWRmXzEwMA==','2026-05-21T01:26:14+00','outbound','https://www.linkedin.com/in/kyle-long-aviation','Kyle Long','Hi Kyle, I know LinkedIn messages can get buried so I wanted to try one more time. I''d mentioned sending over a couple of our phenolic scrapers for your team to try out, still happy to do that if there''s any interest.

If the timing''s off or it''s just not a fit, totally understand. Either way, I appreciate you connecting.',NULL,'INBOX'),
('export:2-OGFlZTBmNTYtMTFlMS00OWQ0LWI3MTAtODBmZTRlMWQ0MWRmXzEwMA==:20260324T23450:5368aa3b','2-OGFlZTBmNTYtMTFlMS00OWQ0LWI3MTAtODBmZTRlMWQ0MWRmXzEwMA==','2026-03-24T23:45:04+00','outbound','https://www.linkedin.com/in/kyle-long-aviation','Kyle Long','Hi Kyle, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-OGFlZTBmNTYtMTFlMS00OWQ0LWI3MTAtODBmZTRlMWQ0MWRmXzEwMA==:20260320T01510:9f961cf6','2-OGFlZTBmNTYtMTFlMS00OWQ0LWI3MTAtODBmZTRlMWQ0MWRmXzEwMA==','2026-03-20T01:51:04+00','outbound','https://www.linkedin.com/in/kyle-long-aviation','Kyle Long','Hi Kyle, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-ZDhjNDMyZDQtZTkyMC00ZGE2LThlZGMtZTRhYzcwNDA0ZDkyXzEwMA==:20260521T01252:5b1d7ebd','2-ZDhjNDMyZDQtZTkyMC00ZGE2LThlZGMtZTRhYzcwNDA0ZDkyXzEwMA==','2026-05-21T01:25:23+00','outbound','https://www.linkedin.com/in/josh-starr-570182283','Josh Starr','Hi Josh, I know LinkedIn messages can get buried so I wanted to try one more time. I''d mentioned sending over a couple of our phenolic scrapers for your team to try out, still happy to do that if there''s any interest.

If the timing''s off or it''s just not a fit, totally understand. Either way, I appreciate you connecting.',NULL,'INBOX'),
('export:2-ZDhjNDMyZDQtZTkyMC00ZGE2LThlZGMtZTRhYzcwNDA0ZDkyXzEwMA==:20260515T00032:4f190dc9','2-ZDhjNDMyZDQtZTkyMC00ZGE2LThlZGMtZTRhYzcwNDA0ZDkyXzEwMA==','2026-05-15T00:03:26+00','outbound','https://www.linkedin.com/in/josh-starr-570182283','Josh Starr','Hi Josh, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you and your team to check out.',NULL,'INBOX'),
('export:2-ZDhjNDMyZDQtZTkyMC00ZGE2LThlZGMtZTRhYzcwNDA0ZDkyXzEwMA==:20260328T00223:ca9deae7','2-ZDhjNDMyZDQtZTkyMC00ZGE2LThlZGMtZTRhYzcwNDA0ZDkyXzEwMA==','2026-03-28T00:22:34+00','outbound','https://www.linkedin.com/in/josh-starr-570182283','Josh Starr','Hi Josh, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-YjMzY2YyMGUtY2NjMS00MGMxLWJkMzAtYzdmZDA3YWY0ZmQ2XzEwMA==:20260521T01242:6ff261fe','2-YjMzY2YyMGUtY2NjMS00MGMxLWJkMzAtYzdmZDA3YWY0ZmQ2XzEwMA==','2026-05-21T01:24:21+00','outbound','https://www.linkedin.com/in/joseph-pisciotta-555436b1','Joseph Pisciotta','Hi Joseph,

I know LinkedIn messages can get buried so I wanted to try one more time. I''d mentioned sending over a couple of our phenolic scrapers for your team to try out — still happy to do that if there''s any interest.

If the timing''s off or it''s just not a fit, totally understand. Either way, I appreciate you connecting.',NULL,'INBOX'),
('export:2-YjMzY2YyMGUtY2NjMS00MGMxLWJkMzAtYzdmZDA3YWY0ZmQ2XzEwMA==:20260521T01112:69c384fc','2-YjMzY2YyMGUtY2NjMS00MGMxLWJkMzAtYzdmZDA3YWY0ZmQ2XzEwMA==','2026-05-21T01:11:23+00','outbound','https://www.linkedin.com/in/joseph-pisciotta-555436b1','Joseph Pisciotta','Hi Joseph, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you and your team to check out.',NULL,'INBOX'),
('export:2-YjMzY2YyMGUtY2NjMS00MGMxLWJkMzAtYzdmZDA3YWY0ZmQ2XzEwMA==:20260329T13222:9f2aba49','2-YjMzY2YyMGUtY2NjMS00MGMxLWJkMzAtYzdmZDA3YWY0ZmQ2XzEwMA==','2026-03-29T13:22:22+00','outbound','https://www.linkedin.com/in/joseph-pisciotta-555436b1','Joseph Pisciotta','Hi Joseph, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-MDRhZmRmYmUtNTg0Yi00MzIxLWI5ZjktNmI1YWYwYWEwYjgxXzEwMA==:20260521T01235:8c97e9d6','2-MDRhZmRmYmUtNTg0Yi00MzIxLWI5ZjktNmI1YWYwYWEwYjgxXzEwMA==','2026-05-21T01:23:55+00','outbound','https://www.linkedin.com/in/jeremiah-kissick','Jeremiah Kissick','Hi Jeremiah,

I know LinkedIn messages can get buried so I wanted to try one more time. I''d mentioned sending over a couple of our phenolic scrapers for your team to try out — still happy to do that if there''s any interest.

If the timing''s off or it''s just not a fit, totally understand. Either way, I appreciate you connecting.',NULL,'INBOX'),
('export:2-MDRhZmRmYmUtNTg0Yi00MzIxLWI5ZjktNmI1YWYwYWEwYjgxXzEwMA==:20260324T23523:eda68ec7','2-MDRhZmRmYmUtNTg0Yi00MzIxLWI5ZjktNmI1YWYwYWEwYjgxXzEwMA==','2026-03-24T23:52:32+00','outbound','https://www.linkedin.com/in/jeremiah-kissick','Jeremiah Kissick','Hi Jeremiah, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-MDRhZmRmYmUtNTg0Yi00MzIxLWI5ZjktNmI1YWYwYWEwYjgxXzEwMA==:20260320T18352:ea40863c','2-MDRhZmRmYmUtNTg0Yi00MzIxLWI5ZjktNmI1YWYwYWEwYjgxXzEwMA==','2026-03-20T18:35:23+00','outbound','https://www.linkedin.com/in/jeremiah-kissick','Jeremiah Kissick','Hi Jeremiah, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-ZjQyOWZkYzUtNjM2Ni00Zjg4LThiNTUtZjc2MDFiMTRmNjcyXzEwMA==:20260521T01232:a3f18116','2-ZjQyOWZkYzUtNjM2Ni00Zjg4LThiNTUtZjc2MDFiMTRmNjcyXzEwMA==','2026-05-21T01:23:21+00','outbound','https://www.linkedin.com/in/jeff-jackson-9b91373','Jeff Jackson','Hi Jeff,

I know LinkedIn messages can get buried so I wanted to try one more time. I''d mentioned sending over a couple of our phenolic scrapers for your team to try out — still happy to do that if there''s any interest.

If the timing''s off or it''s just not a fit, totally understand. Either way, I appreciate you connecting.',NULL,'INBOX'),
('export:2-ZjQyOWZkYzUtNjM2Ni00Zjg4LThiNTUtZjc2MDFiMTRmNjcyXzEwMA==:20260324T23510:12b4415c','2-ZjQyOWZkYzUtNjM2Ni00Zjg4LThiNTUtZjc2MDFiMTRmNjcyXzEwMA==','2026-03-24T23:51:03+00','outbound','https://www.linkedin.com/in/jeff-jackson-9b91373','Jeff Jackson','Hi Jeff, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-ZjQyOWZkYzUtNjM2Ni00Zjg4LThiNTUtZjc2MDFiMTRmNjcyXzEwMA==:20260320T12064:19120c6c','2-ZjQyOWZkYzUtNjM2Ni00Zjg4LThiNTUtZjc2MDFiMTRmNjcyXzEwMA==','2026-03-20T12:06:41+00','outbound','https://www.linkedin.com/in/jeff-jackson-9b91373','Jeff Jackson','Hi Jeff, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-NzYzMDQyNTktYTNlOC00MTM5LTgxNGQtMWUyMWFjZTdiZmVmXzEwMA==:20260521T01213:0284a5c4','2-NzYzMDQyNTktYTNlOC00MTM5LTgxNGQtMWUyMWFjZTdiZmVmXzEwMA==','2026-05-21T01:21:32+00','outbound','https://www.linkedin.com/in/jeffrey-kimmey-jr-b4b73678','Jeffrey Kimmey Jr.','Hi Jeffrey, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you and your team to check out.',NULL,'INBOX'),
('export:2-NzYzMDQyNTktYTNlOC00MTM5LTgxNGQtMWUyMWFjZTdiZmVmXzEwMA==:20260515T17420:e66eddcb','2-NzYzMDQyNTktYTNlOC00MTM5LTgxNGQtMWUyMWFjZTdiZmVmXzEwMA==','2026-05-15T17:42:02+00','outbound','https://www.linkedin.com/in/jeffrey-kimmey-jr-b4b73678','Jeffrey Kimmey Jr.','Hi Jeffrey I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-MjA2Y2Y1OTItY2RmNi00YzE1LWJiZDktYmRjMTI0NmU4ZDc3XzEwMA==:20260521T01193:5c5982a4','2-MjA2Y2Y1OTItY2RmNi00YzE1LWJiZDktYmRjMTI0NmU4ZDc3XzEwMA==','2026-05-21T01:19:37+00','outbound','https://www.linkedin.com/in/samuel-alfrey','Sammy Alfrey','Hi Sammy, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you and your team to check out.',NULL,'INBOX'),
('export:2-MjA2Y2Y1OTItY2RmNi00YzE1LWJiZDktYmRjMTI0NmU4ZDc3XzEwMA==:20260511T17280:d784903a','2-MjA2Y2Y1OTItY2RmNi00YzE1LWJiZDktYmRjMTI0NmU4ZDc3XzEwMA==','2026-05-11T17:28:09+00','outbound','https://www.linkedin.com/in/samuel-alfrey','Sammy Alfrey','Hi Sammy, I own Klein Manufacturing and we make phenolic scrapers used in aircraft maintenance. I''ve recently been connecting with a few other Real Clean franchise owners and sending out some samples for evaluation, so I wanted to introduce myself and connect with you as well.',NULL,'INBOX'),
('export:2-YmU2MTc0ZTQtZGNiMS00NWJlLTgwMTAtNTIzZjVlOWI0ZTZjXzEwMA==:20260521T01190:bfe7b276','2-YmU2MTc0ZTQtZGNiMS00NWJlLTgwMTAtNTIzZjVlOWI0ZTZjXzEwMA==','2026-05-21T01:19:00+00','outbound','https://www.linkedin.com/in/jack-moore-a7708367','Jack Moore','Hi Jack,

I know LinkedIn messages can get buried so I wanted to try one more time. I''d mentioned sending over a couple of our phenolic scrapers for your team to try out — still happy to do that if there''s any interest.

If the timing''s off or it''s just not a fit, totally understand. Either way, I appreciate you connecting.',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-YmU2MTc0ZTQtZGNiMS00NWJlLTgwMTAtNTIzZjVlOWI0ZTZjXzEwMA==:20260330T23465:925296f3','2-YmU2MTc0ZTQtZGNiMS00NWJlLTgwMTAtNTIzZjVlOWI0ZTZjXzEwMA==','2026-03-30T23:46:53+00','outbound','https://www.linkedin.com/in/jack-moore-a7708367','Jack Moore','Hi Jack, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-YmU2MTc0ZTQtZGNiMS00NWJlLTgwMTAtNTIzZjVlOWI0ZTZjXzEwMA==:20260324T20590:6eef3736','2-YmU2MTc0ZTQtZGNiMS00NWJlLTgwMTAtNTIzZjVlOWI0ZTZjXzEwMA==','2026-03-24T20:59:09+00','outbound','https://www.linkedin.com/in/jack-moore-a7708367','Jack Moore','Hi Jack, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-YWY5MjE4NTQtMDI3NC00YzZjLWI3YTktNzI3MTgxYzY0YTk1XzEwMA==:20260521T01184:534db5bd','2-YWY5MjE4NTQtMDI3NC00YzZjLWI3YTktNzI3MTgxYzY0YTk1XzEwMA==','2026-05-21T01:18:41+00','outbound','https://www.linkedin.com/in/david-phillips-02b59a22','David Phillips','Hi David,

I know LinkedIn messages can get buried so I wanted to try one more time. I''d mentioned sending over a couple of our phenolic scrapers for your team to try out — still happy to do that if there''s any interest.

If the timing''s off or it''s just not a fit, totally understand. Either way, I appreciate you connecting.',NULL,'INBOX'),
('export:2-YWY5MjE4NTQtMDI3NC00YzZjLWI3YTktNzI3MTgxYzY0YTk1XzEwMA==:20260324T23444:6fe8db79','2-YWY5MjE4NTQtMDI3NC00YzZjLWI3YTktNzI3MTgxYzY0YTk1XzEwMA==','2026-03-24T23:44:43+00','outbound','https://www.linkedin.com/in/david-phillips-02b59a22','David Phillips','Hi David, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-YWY5MjE4NTQtMDI3NC00YzZjLWI3YTktNzI3MTgxYzY0YTk1XzEwMA==:20260320T00042:88d78b57','2-YWY5MjE4NTQtMDI3NC00YzZjLWI3YTktNzI3MTgxYzY0YTk1XzEwMA==','2026-03-20T00:04:22+00','outbound','https://www.linkedin.com/in/david-phillips-02b59a22','David Phillips','Hi David, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-NTZjMGI4YjYtNDI3Ni00ZWJhLTgxZWQtNmQwM2VkOTgwMGFjXzEwMA==:20260521T01182:6dcb0cd2','2-NTZjMGI4YjYtNDI3Ni00ZWJhLTgxZWQtNmQwM2VkOTgwMGFjXzEwMA==','2026-05-21T01:18:21+00','outbound','https://www.linkedin.com/in/danny-santiago-53b2b093','Danny Santiago','Hi Danny,

I know LinkedIn messages can get buried so I wanted to try one more time. I''d mentioned sending over a couple of our phenolic scrapers for your team to try out — still happy to do that if there''s any interest.

If the timing''s off or it''s just not a fit, totally understand. Either way, I appreciate you connecting.',NULL,'INBOX'),
('export:2-NTZjMGI4YjYtNDI3Ni00ZWJhLTgxZWQtNmQwM2VkOTgwMGFjXzEwMA==:20260403T13113:5ce3029a','2-NTZjMGI4YjYtNDI3Ni00ZWJhLTgxZWQtNmQwM2VkOTgwMGFjXzEwMA==','2026-04-03T13:11:37+00','inbound','https://www.linkedin.com/in/danny-santiago-53b2b093','Danny Santiago','Thank you!!!',NULL,'INBOX'),
('export:2-NTZjMGI4YjYtNDI3Ni00ZWJhLTgxZWQtNmQwM2VkOTgwMGFjXzEwMA==:20260402T14405:549ea849','2-NTZjMGI4YjYtNDI3Ni00ZWJhLTgxZWQtNmQwM2VkOTgwMGFjXzEwMA==','2026-04-02T14:40:59+00','outbound','https://www.linkedin.com/in/danny-santiago-53b2b093','Danny Santiago','Congrats on starting your new role at Banyan Air Service!',NULL,'INBOX'),
('export:2-NTZjMGI4YjYtNDI3Ni00ZWJhLTgxZWQtNmQwM2VkOTgwMGFjXzEwMA==:20260324T23500:61143264','2-NTZjMGI4YjYtNDI3Ni00ZWJhLTgxZWQtNmQwM2VkOTgwMGFjXzEwMA==','2026-03-24T23:50:02+00','outbound','https://www.linkedin.com/in/danny-santiago-53b2b093','Danny Santiago','Hi Danny, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-NTZjMGI4YjYtNDI3Ni00ZWJhLTgxZWQtNmQwM2VkOTgwMGFjXzEwMA==:20260320T07404:cee9c51d','2-NTZjMGI4YjYtNDI3Ni00ZWJhLTgxZWQtNmQwM2VkOTgwMGFjXzEwMA==','2026-03-20T07:40:41+00','outbound','https://www.linkedin.com/in/danny-santiago-53b2b093','Danny Santiago','Hi Danny, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-ZDdiYTU1N2ItOTFiNC00ZGRmLWEyZjEtMDQyYzM5NWQ4NzNjXzEwMA==:20260521T01174:8b4fbc03','2-ZDdiYTU1N2ItOTFiNC00ZGRmLWEyZjEtMDQyYzM5NWQ4NzNjXzEwMA==','2026-05-21T01:17:47+00','outbound','https://www.linkedin.com/in/cody-morris-34984740','Cody Morris','Hi Cody,

I know LinkedIn messages can get buried so I wanted to try one more time. I''d mentioned sending over a couple of our phenolic scrapers for your team to try out — still happy to do that if there''s any interest.

If the timing''s off or it''s just not a fit, totally understand. Either way, I appreciate you connecting.',NULL,'INBOX'),
('export:2-ZDdiYTU1N2ItOTFiNC00ZGRmLWEyZjEtMDQyYzM5NWQ4NzNjXzEwMA==:20260509T21274:29f3d456','2-ZDdiYTU1N2ItOTFiNC00ZGRmLWEyZjEtMDQyYzM5NWQ4NzNjXzEwMA==','2026-05-09T21:27:47+00','outbound','https://www.linkedin.com/in/cody-morris-34984740','Cody Morris','Hi Cody, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-ZDdiYTU1N2ItOTFiNC00ZGRmLWEyZjEtMDQyYzM5NWQ4NzNjXzEwMA==:20260321T13052:72b3e601','2-ZDdiYTU1N2ItOTFiNC00ZGRmLWEyZjEtMDQyYzM5NWQ4NzNjXzEwMA==','2026-03-21T13:05:26+00','outbound','https://www.linkedin.com/in/cody-morris-34984740','Cody Morris','Hi Cody, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-M2IzZDE0ZTAtZGU2MS00MGJmLWE4MGUtZTMyZTQwODRiMzRiXzEwMA==:20260521T01173:04e0398e','2-M2IzZDE0ZTAtZGU2MS00MGJmLWE4MGUtZTMyZTQwODRiMzRiXzEwMA==','2026-05-21T01:17:31+00','outbound','https://www.linkedin.com/in/brittney-weaser-bb945318','Brittney Weaser','Hi Brittney,

I know LinkedIn messages can get buried so I wanted to try one more time. I''d mentioned sending over a couple of our phenolic scrapers for your team to try out — still happy to do that if there''s any interest.

If the timing''s off or it''s just not a fit, totally understand. Either way, I appreciate you connecting.',NULL,'INBOX'),
('export:2-M2IzZDE0ZTAtZGU2MS00MGJmLWE4MGUtZTMyZTQwODRiMzRiXzEwMA==:20260324T23525:1e2836a7','2-M2IzZDE0ZTAtZGU2MS00MGJmLWE4MGUtZTMyZTQwODRiMzRiXzEwMA==','2026-03-24T23:52:51+00','outbound','https://www.linkedin.com/in/brittney-weaser-bb945318','Brittney Weaser','Hi Brittney, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-M2IzZDE0ZTAtZGU2MS00MGJmLWE4MGUtZTMyZTQwODRiMzRiXzEwMA==:20260320T18334:b4ad6a61','2-M2IzZDE0ZTAtZGU2MS00MGJmLWE4MGUtZTMyZTQwODRiMzRiXzEwMA==','2026-03-20T18:33:40+00','outbound','https://www.linkedin.com/in/brittney-weaser-bb945318','Brittney Weaser','Hi Brittney, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-NmRhYTJkZjMtODA5Mi00MzhiLWE0NmEtMzliNWI3ZjRjZTI4XzEwMA==:20260521T01170:5fc95b49','2-NmRhYTJkZjMtODA5Mi00MzhiLWE0NmEtMzliNWI3ZjRjZTI4XzEwMA==','2026-05-21T01:17:05+00','outbound','https://www.linkedin.com/in/andrew-arcuri-60aa6721b','Andrew Arcuri','Hi Andrew,

I know LinkedIn messages can get buried so I wanted to try one more time. I''d mentioned sending over a couple of our phenolic scrapers for your team to try out — still happy to do that if there''s any interest.

If the timing''s off or it''s just not a fit, totally understand. Either way, I appreciate you connecting.',NULL,'INBOX'),
('export:2-NmRhYTJkZjMtODA5Mi00MzhiLWE0NmEtMzliNWI3ZjRjZTI4XzEwMA==:20260324T23502:1749f929','2-NmRhYTJkZjMtODA5Mi00MzhiLWE0NmEtMzliNWI3ZjRjZTI4XzEwMA==','2026-03-24T23:50:22+00','outbound','https://www.linkedin.com/in/andrew-arcuri-60aa6721b','Andrew Arcuri','Hi Andrew, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-NmRhYTJkZjMtODA5Mi00MzhiLWE0NmEtMzliNWI3ZjRjZTI4XzEwMA==:20260320T10584:0c5cc049','2-NmRhYTJkZjMtODA5Mi00MzhiLWE0NmEtMzliNWI3ZjRjZTI4XzEwMA==','2026-03-20T10:58:48+00','outbound','https://www.linkedin.com/in/andrew-arcuri-60aa6721b','Andrew Arcuri','Hi Andrew, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-ODdhOWE3YWItNDUwMi00MTExLWFhNzgtNzhkOGQyZTIyMjY3XzEwMA==:20260521T01155:39940a66','2-ODdhOWE3YWItNDUwMi00MTExLWFhNzgtNzhkOGQyZTIyMjY3XzEwMA==','2026-05-21T01:15:57+00','outbound','https://www.linkedin.com/in/scott-apple-55850153','Scott Apple','Hi Scott, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you and your team to check out.',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-ODdhOWE3YWItNDUwMi00MTExLWFhNzgtNzhkOGQyZTIyMjY3XzEwMA==:20260328T02543:4b78f70f','2-ODdhOWE3YWItNDUwMi00MTExLWFhNzgtNzhkOGQyZTIyMjY3XzEwMA==','2026-03-28T02:54:39+00','outbound','https://www.linkedin.com/in/scott-apple-55850153','Scott Apple','Hi Scott, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-OGQ3ZTU3ODQtN2Y3My00YzY2LTkxYzctMGJiYzNlYzVhNTY2XzEwMA==:20260521T01124:775a6afa','2-OGQ3ZTU3ODQtN2Y3My00YzY2LTkxYzctMGJiYzNlYzVhNTY2XzEwMA==','2026-05-21T01:12:46+00','outbound','https://www.linkedin.com/in/justin-pynckels-mba-4a085b81','Justin Pynckels, MBA','Hi Justin, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you and your team to check out.',NULL,'INBOX'),
('export:2-OGQ3ZTU3ODQtN2Y3My00YzY2LTkxYzctMGJiYzNlYzVhNTY2XzEwMA==:20260330T15400:1e816246','2-OGQ3ZTU3ODQtN2Y3My00YzY2LTkxYzctMGJiYzNlYzVhNTY2XzEwMA==','2026-03-30T15:40:09+00','outbound','https://www.linkedin.com/in/justin-pynckels-mba-4a085b81','Justin Pynckels, MBA','Hi Justin, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-NTJiM2U3ZGEtMTBkMi00NDczLThlMjEtMDUyOTAyN2Q2ODNiXzEwMA==:20260521T01120:775a6afa','2-NTJiM2U3ZGEtMTBkMi00NDczLThlMjEtMDUyOTAyN2Q2ODNiXzEwMA==','2026-05-21T01:12:05+00','outbound','https://www.linkedin.com/in/justin-beason-cam-249711177','Justin Beason, CAM','Hi Justin, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you and your team to check out.',NULL,'INBOX'),
('export:2-NTJiM2U3ZGEtMTBkMi00NDczLThlMjEtMDUyOTAyN2Q2ODNiXzEwMA==:20260328T23422:8af01272','2-NTJiM2U3ZGEtMTBkMi00NDczLThlMjEtMDUyOTAyN2Q2ODNiXzEwMA==','2026-03-28T23:42:28+00','outbound','https://www.linkedin.com/in/justin-beason-cam-249711177','Justin Beason, CAM','Hi Justin I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-ZjgxOTNlNDktOGFhNC00MzZjLWE3M2ItMGYwMDI1ZGJhNTE5XzEwMA==:20260520T17392:fbf8adb9','2-ZjgxOTNlNDktOGFhNC00MzZjLWE3M2ItMGYwMDI1ZGJhNTE5XzEwMA==','2026-05-20T17:39:24+00','outbound','https://www.linkedin.com/in/lindsay-parrott-2a923b37a','Lindsay Parrott','Hi Lindsay, I own Klein Manufacturing and we make phenolic scrapers used in aircraft maintenance. I''ve recently been connecting with a few other Real Clean franchise owners and sending out some samples for evaluation, so I wanted to introduce myself and connect with you as well.',NULL,'INBOX'),
('export:2-YWYwM2Q2YmMtM2UzNC00YThmLWI4NjItYmYzZjk0MTE1NTIzXzEwMA==:20260518T13025:9e6d9593','2-YWYwM2Q2YmMtM2UzNC00YThmLWI4NjItYmYzZjk0MTE1NTIzXzEwMA==','2026-05-18T13:02:59+00','outbound','https://www.linkedin.com/in/kimberly-sanchez-aviation','Kimberly Kozlov','Hi Kimberly, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-MjhkMTk5YzUtMTRmMi00MDc5LWI3NGEtNWM1NWQzMjJlZjg1XzEwMA==:20260516T13120:3a3b2acb','2-MjhkMTk5YzUtMTRmMi00MDc5LWI3NGEtNWM1NWQzMjJlZjg1XzEwMA==','2026-05-16T13:12:01+00','inbound','https://www.linkedin.com/in/don-meyns-b05435375','Don Meyns','Hi Sean, great to connect with you.  I started the business in 1996 and have been selling into the military for about 20 years, and to the civilian market thru Irwin intl. (Aircraft Spruce).  We are now expanding our offerings on our own website to the civilian commercial market. You used a word I see only about once every 5 years and most people do not know what it is - Phenolic.  We use non-phenolic binders to hold our fibers together in our pads.
How about yourself; how long have you been in this industry?',NULL,'INBOX'),
('export:2-MjhkMTk5YzUtMTRmMi00MDc5LWI3NGEtNWM1NWQzMjJlZjg1XzEwMA==:20260516T00325:8a5c4dbe','2-MjhkMTk5YzUtMTRmMi00MDc5LWI3NGEtNWM1NWQzMjJlZjg1XzEwMA==','2026-05-16T00:32:57+00','outbound','https://www.linkedin.com/in/don-meyns-b05435375','Don Meyns','Hi Don, thanks for the connection. I checked out Awesome Products Corp and it looks like you guys are pretty involved in the aircraft exterior cleaning and maintenance space. How long have you been working in that side of the industry?',NULL,'INBOX'),
('export:2-MzI3YTJjN2MtYjdiMS00OTk0LWJhOGUtZTI2OGI1YWJiN2U1XzEwMA==:20260516T00415:7a928e62','2-MzI3YTJjN2MtYjdiMS00OTk0LWJhOGUtZTI2OGI1YWJiN2U1XzEwMA==','2026-05-16T00:41:56+00','inbound','https://www.linkedin.com/in/brett-bailey-','Brett Bailey','I am currently taking a pause from working as I finish my last semester of college. I am currently pursuing an Aviation Management degree from Auburn University. After graduation, I plan to return to working in the aircraft maintenance/management industry. If you know of any management or maintenance opportunities arising this coming up fall, please keep me in mind!',NULL,'INBOX'),
('export:2-MzI3YTJjN2MtYjdiMS00OTk0LWJhOGUtZTI2OGI1YWJiN2U1XzEwMA==:20260516T00351:0ca2d280','2-MzI3YTJjN2MtYjdiMS00OTk0LWJhOGUtZTI2OGI1YWJiN2U1XzEwMA==','2026-05-16T00:35:19+00','outbound','https://www.linkedin.com/in/brett-bailey-','Brett Bailey','Very cool. Are you still working in the aircraft maintenance industry now?',NULL,'INBOX'),
('export:2-MzI3YTJjN2MtYjdiMS00OTk0LWJhOGUtZTI2OGI1YWJiN2U1XzEwMA==:20260516T00301:0af7700b','2-MzI3YTJjN2MtYjdiMS00OTk0LWJhOGUtZTI2OGI1YWJiN2U1XzEwMA==','2026-05-16T00:30:10+00','inbound','https://www.linkedin.com/in/brett-bailey-','Brett Bailey','Sean, thank you for reaching out! I am not currently at LIFT Academy. At LIFT Academy we performed scheduled, unscheduled, and preventative maintenance on Diamond DA40''s as well as Diamond DA42''s. I was not a student with LIFT Academy. I was employed as an aircraft maintenance technician.',NULL,'INBOX'),
('export:2-MzI3YTJjN2MtYjdiMS00OTk0LWJhOGUtZTI2OGI1YWJiN2U1XzEwMA==:20260516T00265:219b7e6f','2-MzI3YTJjN2MtYjdiMS00OTk0LWJhOGUtZTI2OGI1YWJiN2U1XzEwMA==','2026-05-16T00:26:50+00','outbound','https://www.linkedin.com/in/brett-bailey-','Brett Bailey','Hi Brett, thanks for the connection. I saw you''re with Leadership In Flight Training Academy. What kind of maintenance work are you guys doing there? Are the students getting a lot of hands on maintenance training?',NULL,'INBOX'),
('export:2-YTgyZTVjZDQtNTRmOC00YjgyLWE2MjItZTM0NjFhZDBmZGVhXzEwMA==:20260515T12031:776d1236','2-YTgyZTVjZDQtNTRmOC00YjgyLWE2MjItZTM0NjFhZDBmZGVhXzEwMA==','2026-05-15T12:03:11+00','inbound','https://www.linkedin.com/in/marty-grier-cam-pmp-7b1a8413','Marty Grier CAM/PMP','No, thank you',NULL,'INBOX'),
('export:2-YTgyZTVjZDQtNTRmOC00YjgyLWE2MjItZTM0NjFhZDBmZGVhXzEwMA==:20260515T01423:006d0978','2-YTgyZTVjZDQtNTRmOC00YjgyLWE2MjItZTM0NjFhZDBmZGVhXzEwMA==','2026-05-15T01:42:35+00','outbound','https://www.linkedin.com/in/marty-grier-cam-pmp-7b1a8413','Marty Grier CAM/PMP','Hi Marty, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you and your team to check out.',NULL,'INBOX'),
('export:2-YTgyZTVjZDQtNTRmOC00YjgyLWE2MjItZTM0NjFhZDBmZGVhXzEwMA==:20260328T01514:24ece7f7','2-YTgyZTVjZDQtNTRmOC00YjgyLWE2MjItZTM0NjFhZDBmZGVhXzEwMA==','2026-03-28T01:51:46+00','outbound','https://www.linkedin.com/in/marty-grier-cam-pmp-7b1a8413','Marty Grier CAM/PMP','Hi Marty, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-YjliNDc0MmUtNWRkOS00MjIxLTkwNmEtMzE3YjRkMjZjNGQ5XzEwMA==:20260511T04025:ebf37a9e','2-YjliNDc0MmUtNWRkOS00MjIxLTkwNmEtMzE3YjRkMjZjNGQ5XzEwMA==','2026-05-11T04:02:51+00','outbound','https://www.linkedin.com/in/garen-harout-mazedjian-4454a871','Garen Harout Mazedjian','Hi Garen, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-YmVlZjZjOTAtMTdkNy00ODEwLThlNzYtN2U3MDQxYzRkYzcwXzEwMA==:20260510T13295:20b79b67','2-YmVlZjZjOTAtMTdkNy00ODEwLThlNzYtN2U3MDQxYzRkYzcwXzEwMA==','2026-05-10T13:29:51+00','outbound','https://www.linkedin.com/in/anne-marie-zwerg','Anne Marie Zwerg, PhD, MIM','Hi Anne, I own Klein Manufacturing and we make phenolic scrapers used in aircraft maintenance. I''ve recently been connecting with a few other Real Clean franchise owners and sending out some samples for evaluation, so I wanted to introduce myself and connect with you as well.',NULL,'INBOX'),
('export:2-MGY1NWNhYjctYjc5NS00OWRkLWJiODEtYTIyNzlhYjQ4NzQ5XzEwMA==:20260510T11482:10550e2e','2-MGY1NWNhYjctYjc5NS00OWRkLWJiODEtYTIyNzlhYjQ4NzQ5XzEwMA==','2026-05-10T11:48:24+00','inbound','https://www.linkedin.com/in/chelsea-groves-7551a3a1','Chelsea Groves','Absolutely. Happy to connect!',NULL,'INBOX'),
('export:2-MGY1NWNhYjctYjc5NS00OWRkLWJiODEtYTIyNzlhYjQ4NzQ5XzEwMA==:20260510T03143:ccb5897f','2-MGY1NWNhYjctYjc5NS00OWRkLWJiODEtYTIyNzlhYjQ4NzQ5XzEwMA==','2026-05-10T03:14:30+00','outbound','https://www.linkedin.com/in/chelsea-groves-7551a3a1','Chelsea Groves','Hi Chelsea, I own Klein Manufacturing and we make phenolic scrapers used in aircraft maintenance. I''ve recently been connecting with a few other Real Clean franchise owners and sending out some samples for evaluation, so I wanted to introduce myself and connect with you as well.',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-NjMyMTFjYzYtM2IyOS00YTZlLTg4NzctYTNmYTZhZjhlMWVkXzEwMA==:20260508T20180:98cf9703','2-NjMyMTFjYzYtM2IyOS00YTZlLTg4NzctYTNmYTZhZjhlMWVkXzEwMA==','2026-05-08T20:18:00+00','outbound','https://www.linkedin.com/in/cristian-mansilla-6b6a5890','Cristian Mansilla','Hi Cristian, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-ZDRjODc1NzUtZTU3Yy00NWY4LWJiOTUtOTA1ZWQyY2UwNWRiXzEwMA==:20260508T08584:3ebc45b0','2-ZDRjODc1NzUtZTU3Yy00NWY4LWJiOTUtOTA1ZWQyY2UwNWRiXzEwMA==','2026-05-08T08:58:49+00','inbound','https://www.linkedin.com/in/yonathan-garcia-110b9334b','Yonathan Garcia','Hi Sean,

I came across your profile and was impressed by your work as a President at Klein Manufacturing, LLC.

I wanted to reach out to see if you might be interested in exploring an opportunity that aligns with your background.

If you''re open to exploring new opportunities, I''d love to share more information.

Looking forward to hearing from you!

Yonathan Garcia
Recruiter | Sourcing Specialist | Turning Potential into Performance','Open to Exploring Opportunities?','INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260508T04090:5280cc7b','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-05-08T04:09:08+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Hi Eric, sorry for the delay, I''ve been slammed the last few days.

I see what you''re talking about now on the middle pic. I can definitely see where something like that would be useful, especially with the edge profile.

Right now we''ve mainly focused on the scraper models I originally sent over since those are what our larger customers are using the most, but I''d definitely be interested to learn more about the application and what your team is using those smaller ones for.',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260504T23274:e81fe245','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-05-04T23:27:47+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Look at middle pic
It needs an edge more like your other models?',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260504T23265:c0352e8d','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-05-04T23:26:58+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','I love the dowel handles you did',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260504T23264:e8d4b3f5','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-05-04T23:26:41+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Maybe put your spin on them?',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260504T23262:a784f73b','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-05-04T23:26:23+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Hi Sean

Can you make some of the ones I sent? 

I''d be interested In more of them',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260504T20321:a2cf92b2','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-05-04T20:32:19+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Hi Eric, just wanted to check in. I know things get busy, but I wanted to circle back with you. If you need more scrapers for the team, I''d be happy to get you set up.',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260423T13321:b254d75a','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-23T13:32:15+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Yes, got them now.  Those are interesting, I can see how those would be useful.  What size and thickness are those?  And do they have a pointed end on one side?',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260423T13305:c210507b','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-23T13:30:51+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Are they coming through?',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260423T13303:da39a3ee','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-23T13:30:37+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260423T13302:da39a3ee','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-23T13:30:22+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260423T13301:da39a3ee','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-23T13:30:18+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260423T13301:29d8e5f4','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-23T13:30:14+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','I didn''t see them come through on my end. If it''s easier, feel free to email them to me at sales@kleinmfgllc.com, or you can text them to me at 916-671-4772.',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260423T13300:b9c99406','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-23T13:30:03+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','I''m re sending now',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260423T13284:a5562f86','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-23T13:28:47+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','🤔',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260423T13284:863b684c','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-23T13:28:43+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Interestingly, 
I sent photos

But they aren''t here',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260423T13273:26a78266','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-23T13:27:30+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Hi Eric, just wanted to check in.

I know you mentioned sending over a few photos, I''d still be interested to see what you had in mind when you get a chance.

If you need more scrapers for the team in the meantime, I''m happy to help.',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260415T16525:4d1d0a8f','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-15T16:52:50+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Hey Eric!  That''s great to hear, I appreciate the feedback and am glad to hear the scrapers are working well for you.  I''d definitely be interested to see what you have in mind, always open to new ideas.  Looking forward to checking those out.

For the sample scrapers I sent, pricing is $15 for the 6" and $16.50 for the 11".  If you end up needing more for the team I''m happy to get you taken care of.  Thanks Eric!',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260415T16371:0ad9225f','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-15T16:37:10+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','I''ll send the photos on Friday when I''m back in the hangar',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260415T16370:c79cccc8','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-15T16:37:02+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Sean the scrapers you sent are great

I''m going to send you some photos of a couple other scrapers that I think would really be a good addition to your lineup',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260401T17032:9472b47e','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-01T17:03:29+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Sounds good Eric, I appreciate it!  I look forward to hearing what you think once you''ve had a chance to take a look.  Thank you!',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260401T17020:05cbc92b','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-01T17:02:08+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','As soon as I see them I will get back to you right away',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260401T17015:d61009bc','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-01T17:01:59+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','I''m just getting back to town this afternoon from operators conference in Savannah',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260401T17014:07a5229e','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-01T17:01:44+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Hi, Sean',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260401T17011:d62c9582','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-04-01T17:01:19+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Hi Eric, just wanted to check in and see what you and your team think of the scrapers so far.

Curious how they compare to what you''ve been using. If they''re a good fit, I''d be happy to get you pricing and set you up with an order.',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T23183:c7987384','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T23:18:32+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Sounds great, thanks so much!',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T23181:4cded3fe','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T23:18:12+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','That''s fantastic!!! 
I will let you know when they arrive',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T23164:be95d130','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T23:16:49+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Hi Eric!  Just wanted to let you know I sent out one sample of each (6" and 11") scrapers this afternoon via UPS ground.  Tracking number is 1Z0592W00341592051.  Looks like they should arrive next Friday 3/27.  Looking forward to hearing what you think!  

If anything comes up, feel free to reach out here, or you can call or text me at (916) 671-4772 or email me at sales@kleinmfgllc.com

Thanks Eric, have a great weekend!',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T17072:243ee8c1','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T17:07:24+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','No problem',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T15173:9a353c28','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T15:17:39+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','That''s awesome Eric, I appreciate you sharing it with your team!  

I''ll get those samples out to you today.  Looking forward to hearing what you think.  

I really appreciate the connection as well!  Thanks Eric!',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T15140:945cf71b','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T15:14:02+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','That''s great!!!
It''s a pleasure to connect.

I''ll share the information with my team. 

JetAviation is a huge company and I collaborate with Gulfstream as well',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T15125:721c8361','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T15:12:51+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','That sounds great, I''m looking forward to it!  

I''m located in Orangevale, California.  About 20 miles East of Sacramento.',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T15102:2069e93f','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T15:10:28+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','That''s awesome Sean! 
I will give you some good feedback

Where are you located?',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T15094:9324a5ed','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T15:09:45+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Thanks Eric, I appreciate that!  I''ll get one of each size shipped out to you this afternoon so you can check them out.  I''ll send over the tracking number once they''re on the way.

Looking forward to hearing what you think.  Thanks again!',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T14405:026e4d58','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T14:40:51+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Please ship to:
Atlantic Aviation
Attn: Eric Moberg / N2425J
400 Herndon Ave.
Orlando, FL 32803

Thank you kindly, 

If they are cool, I''ll be purchasing',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T14401:99791ab9','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T14:40:17+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Thanks, Sean',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T14365:67a5a205','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T14:36:58+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','That''s great to hear, sounds like you already know the value of phenolic scrapers!

We keep it pretty simple, we make them in two sizes, 6" and 11".  We don''t have a catalog, but you can check out our scrapers on our website: kleinmfgllc.com

I''d be happy to send a couple out for you to take a look and get your feedback.',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T14081:0d956cf8','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T14:08:14+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Do you have a catalog?',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T13175:d9bd9c49','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T13:17:59+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','I love them!',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T13174:4e5275eb','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T13:17:43+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','I used final scrapers constantly. 

I have two really nice ones that are made from phenolic, Gulfstream gave them to me

I am always open to them',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T13124:f0ed791c','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T13:12:48+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Good morning Eric, thanks for connecting! 

Do your guys use scrapers much for sealant or adhesive removal on sensitive surfaces? If so, what are they using now?

We make phenolic scrapers that are safe on aluminum and composite and hold up longer than typical plastic ones, especially for sealant and adhesive removal.

I''d be happy to send a couple over for your team to try.',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T12142:731e8c5d','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T12:14:28+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Yes, I am',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T12142:07a5229e','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T12:14:24+00','inbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Hi, Sean',NULL,'INBOX'),
('export:2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==:20260320T12135:c9918566','2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','2026-03-20T12:13:57+00','outbound','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','Hi Eric, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-NTU0Y2U0M2EtOGMxYS00YjY0LTg3NWItMDZiYjMyNjI4ZjMzXzEwMA==:20260505T04155:95980768','2-NTU0Y2U0M2EtOGMxYS00YjY0LTg3NWItMDZiYjMyNjI4ZjMzXzEwMA==','2026-05-05T04:15:52+00','inbound','https://www.linkedin.com/in/joseph-schwartz-09a0a7178','Joseph Schwartz','Hi Sean,

I hope this message finds you well! I came across your profile and was impressed by your work at Klein Manufacturing, especially your focus on high-quality phenolic scrapers for the aviation industry. It''s clear that you''re making a significant impact in that field!

As a business owner with a background in retail operations and financial services, I''m always keen to connect with fellow entrepreneurs and learn about innovative practices in different industries. Your approach to manufacturing and commitment to quality really resonate with me.

I''d love to stay connected and perhaps share insights on our respective fields!

Best regards,
Joseph Schwartz',NULL,'INBOX'),
('export:2-MzdjNGE4MjItZjdjYy00N2JlLWI3ZjAtZmQwMjAwNzY0OWNjXzEwMA==:20260504T22450:aa3845d6','2-MzdjNGE4MjItZjdjYy00N2JlLWI3ZjAtZmQwMjAwNzY0OWNjXzEwMA==','2026-05-04T22:45:02+00','outbound','https://www.linkedin.com/in/dale-cash-22b064222','Dale Cash','Hi Dale, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-Zjc5MjE1ZGEtYzg5NS00MTU3LTlkYzItM2E4ZTI3ZjU2YjZlXzEwMA==:20260504T20262:97b0bfda','2-Zjc5MjE1ZGEtYzg5NS00MTU3LTlkYzItM2E4ZTI3ZjU2YjZlXzEwMA==','2026-05-04T20:26:25+00','outbound','https://www.linkedin.com/in/christopher-wilkes-cam-b33819131','Christopher Wilkes, CAM','Got it, that makes sense. Sounds like it varies quite a bit depending on the work being done.

Would you be open to me sending a couple samples over to one of your locations to get in front of the technicians? Always helpful to get them in hand and see how they stack up against what you''re currently using.',NULL,'INBOX'),
('export:2-Zjc5MjE1ZGEtYzg5NS00MTU3LTlkYzItM2E4ZTI3ZjU2YjZlXzEwMA==:20260504T18092:85c69c17','2-Zjc5MjE1ZGEtYzg5NS00MTU3LTlkYzItM2E4ZTI3ZjU2YjZlXzEwMA==','2026-05-04T18:09:29+00','inbound','https://www.linkedin.com/in/christopher-wilkes-cam-b33819131','Christopher Wilkes, CAM','We use both plastic and phenolic.  Depends on each WSA location, there are many.  Thank you.',NULL,'INBOX'),
('export:2-Zjc5MjE1ZGEtYzg5NS00MTU3LTlkYzItM2E4ZTI3ZjU2YjZlXzEwMA==:20260429T04520:84085b95','2-Zjc5MjE1ZGEtYzg5NS00MTU3LTlkYzItM2E4ZTI3ZjU2YjZlXzEwMA==','2026-04-29T04:52:02+00','outbound','https://www.linkedin.com/in/christopher-wilkes-cam-b33819131','Christopher Wilkes, CAM','Hi Christopher, thanks for the connection!

I manufacture phenolic scrapers used for sealant and adhesive removal, is that something your maintenance crews use much during routine work?',NULL,'INBOX'),
('export:2-OGZkYTY3NjItYzA5NC00YzY1LTg0NGMtY2U5ZWRkMjkxM2FmXzEwMA==:20260504T20234:bbebf468','2-OGZkYTY3NjItYzA5NC00YzY1LTg0NGMtY2U5ZWRkMjkxM2FmXzEwMA==','2026-05-04T20:23:40+00','outbound','https://www.linkedin.com/in/andrew-schumpp-85a96bb','Andrew Schumpp','Hi Andrew, appreciate the response.

You can take a look at the scrapers here: kleinmfgllc.com. They''re solid phenolic and typically used for removing sealant and adhesives without damaging aluminum or composite surfaces. They hold up well and don''t chip like plastic.

If it looks like something your team could use, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-OGZkYTY3NjItYzA5NC00YzY1LTg0NGMtY2U5ZWRkMjkxM2FmXzEwMA==:20260504T17253:90e3cd87','2-OGZkYTY3NjItYzA5NC00YzY1LTg0NGMtY2U5ZWRkMjkxM2FmXzEwMA==','2026-05-04T17:25:36+00','inbound','https://www.linkedin.com/in/andrew-schumpp-85a96bb','Andrew Schumpp','Good day,

I might be interested, could you please send some information? 

Thanks',NULL,'INBOX'),
('export:2-OGZkYTY3NjItYzA5NC00YzY1LTg0NGMtY2U5ZWRkMjkxM2FmXzEwMA==:20260423T03042:0c5cc049','2-OGZkYTY3NjItYzA5NC00YzY1LTg0NGMtY2U5ZWRkMjkxM2FmXzEwMA==','2026-04-23T03:04:22+00','outbound','https://www.linkedin.com/in/andrew-schumpp-85a96bb','Andrew Schumpp','Hi Andrew, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-Y2QwNWJjOGEtNzdiNi00NzQzLWJhNWItYWY2MjRiN2M3ODhmXzEwMA==:20260504T15110:6c453260','2-Y2QwNWJjOGEtNzdiNi00NzQzLWJhNWItYWY2MjRiN2M3ODhmXzEwMA==','2026-05-04T15:11:03+00','outbound','https://www.linkedin.com/in/kurtwiegers','Kurt Wiegers','Got it, that makes sense. JD is helping connect me with the corporate team to get them in for review now.

Once that''s approved I''d be happy to get some in your hands.',NULL,'INBOX'),
('export:2-Y2QwNWJjOGEtNzdiNi00NzQzLWJhNWItYWY2MjRiN2M3ODhmXzEwMA==:20260504T15021:b2f1a50b','2-Y2QwNWJjOGEtNzdiNi00NzQzLWJhNWItYWY2MjRiN2M3ODhmXzEwMA==','2026-05-04T15:02:13+00','inbound','https://www.linkedin.com/in/kurtwiegers','Kurt Wiegers','No thank you. I''ve heard good things, though. Once they are approved by corporate, I''d be interested.',NULL,'INBOX'),
('export:2-Y2QwNWJjOGEtNzdiNi00NzQzLWJhNWItYWY2MjRiN2M3ODhmXzEwMA==:20260504T14532:eb59894e','2-Y2QwNWJjOGEtNzdiNi00NzQzLWJhNWItYWY2MjRiN2M3ODhmXzEwMA==','2026-05-04T14:53:28+00','outbound','https://www.linkedin.com/in/kurtwiegers','Kurt Wiegers','Hey Kurt, thanks for connecting. I''ve had some other RealClean locations trying out our phenolic scrapers recently.

Would you be interested in checking out a couple samples for your team?',NULL,'INBOX'),
('export:2-NmI0MTU1N2EtZGUxMC00MjhmLTk1OWMtZWI2ZmU0MGY4ZjgzXzEwMA==:20260504T14371:25031ecc','2-NmI0MTU1N2EtZGUxMC00MjhmLTk1OWMtZWI2ZmU0MGY4ZjgzXzEwMA==','2026-05-04T14:37:12+00','outbound','https://www.linkedin.com/in/ray-shahifar-7b06212a5','Ray  Shahifar','Hi Ray, thanks for the connection. I saw you''re running the operation at Procraft, what kind of work does your team handle most? Do your guys use scrapers much for sealant or adhesive removal?',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260502T22463:99791ab9','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-05-02T22:46:38+00','inbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Thanks, Sean',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260502T22452:dc85b5be','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-05-02T22:45:29+00','outbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Hi Jim, I saw the news and was thinking about you, really sorry to hear that. Hope everything works out for you on the next step.

Appreciate you passing along the feedback as well, glad to hear the structures guys liked them.

Would definitely love to stay in touch. Feel free to reach out anytime once you land somewhere new.',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260502T22431:3cefdd28','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-05-02T22:43:18+00','inbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Sean. Sorry to break it to you but spirit just bit the dust. 
Appreciate the sample and when I get on my feet and if I end up working heavy maintenance I''ll reach out to you for a supply. The structures guys said they were great tools.',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260423T13225:f1e4bfc8','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-04-23T13:22:59+00','outbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Hi Jim, just wanted to follow up and see if you had a chance to connect with the team on the scrapers. Curious to hear their thoughts.',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260416T23000:930e0c26','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-04-16T23:00:00+00','outbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Hi Jim, I appreciate you taking a look and checking with the team.

That smell is just from the phenolic material itself, there''s no coating or additives on them, just solid phenolic. It usually fades pretty quickly with use.

Looking forward to hearing what you guys think once they''ve had a chance to try them out. Thank you.',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260416T22431:086e1978','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-04-16T22:43:14+00','inbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','I took them downstairs when I got them. And they kinda smelled funny. Lol. 
Let me go down and check as I haven''t heard anything back yet. Thank for sending them. Let me get back with you.',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260416T22221:497509fe','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-04-16T22:22:13+00','outbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Hi Jim!  Just wanted to check in and see how the scrapers worked out for your team.  Would love to hear your feedback.',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260330T23400:277e909d','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-03-30T23:40:03+00','outbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','You''re welcome Jim!',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260330T23374:99791ab9','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-03-30T23:37:46+00','inbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Thanks, Sean',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260330T23370:bf329591','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-03-30T23:37:07+00','outbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Hi Jim, hope you had a great weekend! 

Just wanted to let you know I sent out one sample of each (6" and 11") scrapers this afternoon via UPS ground. Tracking number is 1Z0592W00342766960. Looks like they should arrive this Friday 4/3. Looking forward to hearing what you and your team think!

If anything comes up, feel free to reach out here, or you can call or text me at (916) 671-4772 or email me at sales@kleinmfgllc.com

Thanks Jim!',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260328T00340:b703ad38','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-03-28T00:34:02+00','inbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Youre welcome. Thank you too.',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260327T23542:3957c9b9','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-03-27T23:54:20+00','outbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Hi Jim, I appreciate that. I''ll get a couple samples sent out to you on Monday and will send over the tracking once they''re on the way.

Looking forward to hearing what you and your team think. Thanks so much, have a great weekend!',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260327T23440:831b92f5','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-03-27T23:44:01+00','inbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Sure Sean. I''ll let you know. 

Jim Lufrano
32999 W Service Dr, Detroit, MI 48242',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260327T23221:e30f093d','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-03-27T23:22:19+00','outbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','That makes sense, those are pretty standard.

We make phenolic scrapers that are a step up from the typical plastic ones -they hold an edge longer, don''t round over as quickly, and have a bit more rigidity while still being safe on aluminum and composite surfaces.

If you''re open to it, I''d be happy to send a couple over for your team to check out.',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260327T23183:298d5e33','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-03-27T23:18:32+00','inbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Little orange plastic ones.',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260327T23182:be6167b8','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-03-27T23:18:20+00','inbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Of course.',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260327T23160:c14a4106','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-03-27T23:16:01+00','outbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Hi Jim, got it, I appreciate that.

Do your teams use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260327T23100:78348f28','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-03-27T23:10:03+00','inbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','I deal with aircraft maintenance. I don''t know who runs the tooling.',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260327T23081:3e7c05ac','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-03-27T23:08:19+00','outbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Hi Jim, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==:20260322T19120:cb8f83da','2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','2026-03-22T19:12:01+00','outbound','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','Hi Jim, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-YTYwMjkwNjMtZTk1ZS00NGQ4LWIzNTYtMDZlZmI2YjRkYjMzXzEwMA==:20260502T00060:08a90544','2-YTYwMjkwNjMtZTk1ZS00NGQ4LWIzNTYtMDZlZmI2YjRkYjMzXzEwMA==','2026-05-02T00:06:05+00','outbound','https://www.linkedin.com/in/jerel-buckley-66539512','Jerel Buckley','Hi Jerel, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-MDQ5ZjM2NWUtN2JmNC00ZWY1LWEzNTgtMGZjNDAwODI3OWVlXzEwMA==:20260501T07451:b3ef9db4','2-MDQ5ZjM2NWUtN2JmNC00ZWY1LWEzNTgtMGZjNDAwODI3OWVlXzEwMA==','2026-05-01T07:45:18+00','outbound','https://www.linkedin.com/in/barney-whaley-82868b9b','Barney Whaley','Hi Barney, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260430T19102:dca9ec4c','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-30T19:10:23+00','outbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Hey JD, no problem at all - I know how it goes.  And seriously, thank you again for spreading the word about our scrapers.  I''ve had a ton of RealClean owners reach out for samples already, and your impact has been huge!

I saw your email as well, I appreciate you making the connection!  Just want to make sure I get corporate whatever they need for the review.  Could you loop me in with Jamie or share their contact info?

On ordering, no formal form needed - most guys just send over a quick PO or even an email with quantities and a ship-to and I''ll take care of the rest.',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260430T18292:68c2d786','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-30T18:29:20+00','inbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','apologies, been in the grinder.. will make an order soon for PO, is there a template you have on your website?  

Also, jsut sent email to your sales inbox - connecting w realclean corporate for an assessment to get on their equipment list',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260421T03434:02cb8cda','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-21T03:43:40+00','outbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Likewise, glad we connected! Whenever you''re ready, feel free to send a PO over and I''ll get your order processed and shipped out quickly.',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260421T02472:70a3f745','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-21T02:47:25+00','inbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Yes sir! Glad we connected!',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260421T01175:99fecb21','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-21T01:17:52+00','outbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Hey James, just wanted to say I really appreciate you spreading the word about our scrapers, I already had a couple other RealClean owners reach out today and mention your name. That means a lot, thank you.

Let me know if you need anything on your end as well, happy to get you set up with whatever you need.',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260414T21042:dc83ec95','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-14T21:04:23+00','outbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Great, glad this works. Appreciate you sharing it!',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260414T21022:9e41915a','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-14T21:02:21+00','inbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','home page has description I need, this should work!',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260414T21001:00884a81','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-14T21:00:15+00','outbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','I don''t have a formal one pager put together, but everything is on our website here:

https://kleinmfgllc.com

If it would be helpful, I can put together a simple one-pager for you to share with your team.',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260414T20340:557120f9','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-14T20:34:03+00','inbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','No problem, do you have a product summary one pager?',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260414T19425:a7558c66','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-14T19:42:58+00','outbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','That sounds great, I really appreciate it James!

Looking forward to getting you taken care of on this order, and I appreciate you sharing it with the network as well! Thank you!',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260414T19301:1f08cf99','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-14T19:30:10+00','inbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','solid i''ll send in an order here shortly and I''ll promote this product w the RealClean owners network, theres about 45-50 franchise locations/owners in the netwrok',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260414T17542:631cae88','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-14T17:54:20+00','outbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','That''s great to hear, really glad they worked well for you guys! I appreciate that!

We sell direct, so you can order straight through me. Pricing is $15 for the 6" and $16.50 for the 11".
If you want to move forward, you can send a PO over to me at sales@kleinmfgllc.com and I''ll get everything processed and shipped out quickly.

If it''s helpful, I''m also happy to put together a quick quote for you.',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260414T17452:a95eba00','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-14T17:45:25+00','inbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Hey there, they worked great. Need to get some shots and I''ll write/post a review here in the near future and give y''all a shoutout. Are we able to buy directly from your site or do you have a recommended retailer?',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260414T16341:601fd975','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-14T16:34:15+00','outbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Hi James! Just wanted to check in and see how the scrapers are working out for you.',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260401T03420:f00ca36b','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-01T03:42:00+00','outbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Sounds great, thank you!',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260401T02035:c3c41858','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-04-01T02:03:51+00','inbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Excited to try them out, will followup.. thanks again!',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260330T23291:18628d9c','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-03-30T23:29:10+00','outbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','You''re welcome, I appreciate you reaching out!  Looking forward to hearing what you and your team think once you get some time with them!',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260330T23260:7eb82c5c','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-03-30T23:26:09+00','inbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Man, that is awesome, thank you so much… looking forward to test drive them!!',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260330T23250:7d05fc47','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-03-30T23:25:05+00','outbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Hi James! Just wanted to let you know I sent out one sample of each (6" and 11") scrapers this afternoon via UPS ground. Tracking number is 1Z0592W00341292152. Looks like they should arrive next Monday 4/6. Looking forward to hearing what you think!

If anything comes up, feel free to reach out here, or you can call or text me at (916) 671-4772 or email me at sales@kleinmfgllc.com

Thanks James!',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260330T19114:fd0eabf1','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-03-30T19:11:43+00','outbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Hi James.  Thanks for sending over the address. I''ll get some samples put together and shipped out this afternoon.  I''ll follow up with the UPS tracking number once the shipment is on the way.  Thank you!',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260330T17105:1e1e32c0','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-03-30T17:10:52+00','inbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','oh wow, that would be great!  RealClean Aircraft 31 Boland CT Unit 818, greenville, SC 29615     I''ll be sure to followup with a review!  thank you so much',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260330T15544:f87c4eff','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-03-30T15:54:46+00','outbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Hey James, thanks for connecting! That''s awesome, really appreciate you reaching out!

I''d be happy to send some scrapers out for you to test. If you can share the best shipping address and who they should go to, I''ll get a couple out right away.

Excited to hear your thoughts and how they perform for your team.',NULL,'INBOX'),
('export:2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==:20260330T15513:c6179133','2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','2026-03-30T15:51:37+00','inbound','https://www.linkedin.com/in/jddulebohn','James Dulebohn','Hey there, you came across my feed and just so happens I''ve been looking for new scraper tools/solutions. Researched your products and now going to get some to test out. Look forward to connecting and following your work. Cheers. -JD',NULL,'INBOX'),
('export:2-ZTBjM2VkYTQtMmE0Zi00NjhiLTllNGUtYWVjMTEzNmNmMmQ1XzEwMA==:20260430T03055:335afdd1','2-ZTBjM2VkYTQtMmE0Zi00NjhiLTllNGUtYWVjMTEzNmNmMmQ1XzEwMA==','2026-04-30T03:05:53+00','outbound','https://www.linkedin.com/in/benjamin-hulshoff-713702269','Benjamin Hulshoff','Hi Benjamin, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-YTZhN2YxNjgtMDliNi00ODY3LWIzYWQtY2NiMGIwYjhjZjZjXzEwMA==:20260429T18140:0d9b538e','2-YTZhN2YxNjgtMDliNi00ODY3LWIzYWQtY2NiMGIwYjhjZjZjXzEwMA==','2026-04-29T18:14:08+00','inbound','https://www.linkedin.com/in/preston-griffin-ok','Preston Griffin','Awesome thank you',NULL,'INBOX'),
('export:2-YTZhN2YxNjgtMDliNi00ODY3LWIzYWQtY2NiMGIwYjhjZjZjXzEwMA==:20260429T18140:78654ffd','2-YTZhN2YxNjgtMDliNi00ODY3LWIzYWQtY2NiMGIwYjhjZjZjXzEwMA==','2026-04-29T18:14:06+00','inbound','https://www.linkedin.com/in/preston-griffin-ok','Preston Griffin','👍',NULL,'INBOX'),
('export:2-YTZhN2YxNjgtMDliNi00ODY3LWIzYWQtY2NiMGIwYjhjZjZjXzEwMA==:20260427T16342:4ddcbaee','2-YTZhN2YxNjgtMDliNi00ODY3LWIzYWQtY2NiMGIwYjhjZjZjXzEwMA==','2026-04-27T16:34:25+00','outbound','https://www.linkedin.com/in/preston-griffin-ok','Preston Griffin','Hey Preston, that makes sense, I''ve heard that a lot. A lot of guys end up making their own because most of what''s out there isn''t great. Mine are solid phenolic, they hold an edge well and don''t chip up like a lot of the plastic ones out there.

That''s awesome about the 145 station, that''s a big move! When you get that up and running I''d be happy to get a few in your guys'' hands.',NULL,'INBOX'),
('export:2-YTZhN2YxNjgtMDliNi00ODY3LWIzYWQtY2NiMGIwYjhjZjZjXzEwMA==:20260427T15590:e4894752','2-YTZhN2YxNjgtMDliNi00ODY3LWIzYWQtY2NiMGIwYjhjZjZjXzEwMA==','2026-04-27T15:59:04+00','inbound','https://www.linkedin.com/in/preston-griffin-ok','Preston Griffin','Hey, Sean, we don''t use many scrapers at GP JetWorks. I am in the works, starting a 145 repair station. I''ve been an aircraft mechanic for years and used thousands of scrapers. In my experience, homemade tools tend to be the best. So you''re in a good market.',NULL,'INBOX'),
('export:2-YTZhN2YxNjgtMDliNi00ODY3LWIzYWQtY2NiMGIwYjhjZjZjXzEwMA==:20260424T13070:1a6a4e51','2-YTZhN2YxNjgtMDliNi00ODY3LWIzYWQtY2NiMGIwYjhjZjZjXzEwMA==','2026-04-24T13:07:00+00','outbound','https://www.linkedin.com/in/preston-griffin-ok','Preston Griffin','Hey Preston, appreciate the connection.

I saw you own GP JetWorks, that''s awesome. What kind of work are you guys mostly focused on right now?

Quick question, do your guys use any kind of scrapers for sealant or adhesive removal?',NULL,'INBOX'),
('export:2-YjE5YTA4MzYtMDllYi00NGVkLWJmMWUtY2M0NDhjZWFhMjViXzEwMA==:20260428T12082:dbe23b63','2-YjE5YTA4MzYtMDllYi00NGVkLWJmMWUtY2M0NDhjZWFhMjViXzEwMA==','2026-04-28T12:08:28+00','outbound','https://www.linkedin.com/in/ray-filbeck-8742565a','Ray Filbeck','Hi Ray I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-OTBkYTYwMjQtYTA1MC00YmU0LTg3ZDctYmJiNzdhMDIzYWQ4XzEwMA==:20260427T20425:5da4d9f1','2-OTBkYTYwMjQtYTA1MC00YmU0LTg3ZDctYmJiNzdhMDIzYWQ4XzEwMA==','2026-04-27T20:42:55+00','outbound','https://www.linkedin.com/in/peter-sterling-a430b591','Peter Sterling','Hi Peter, glad to hear you''re already using them. What do your technicians use them for most often?

I''d be happy to send over a few samples for you to try out if you''re interested.',NULL,'INBOX'),
('export:2-OTBkYTYwMjQtYTA1MC00YmU0LTg3ZDctYmJiNzdhMDIzYWQ4XzEwMA==:20260427T20241:b361840b','2-OTBkYTYwMjQtYTA1MC00YmU0LTg3ZDctYmJiNzdhMDIzYWQ4XzEwMA==','2026-04-27T20:24:11+00','inbound','https://www.linkedin.com/in/peter-sterling-a430b591','Peter Sterling','Yes we use a lot of them',NULL,'INBOX'),
('export:2-OTBkYTYwMjQtYTA1MC00YmU0LTg3ZDctYmJiNzdhMDIzYWQ4XzEwMA==:20260427T20233:6bf712af','2-OTBkYTYwMjQtYTA1MC00YmU0LTg3ZDctYmJiNzdhMDIzYWQ4XzEwMA==','2026-04-27T20:23:38+00','outbound','https://www.linkedin.com/in/peter-sterling-a430b591','Peter Sterling','Hi Peter I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-N2M5YWFjNmYtZDY0Ni00NGYwLTg5NzgtN2NhYTRmZGZlNTMzXzEwMA==:20260427T16130:deafd247','2-N2M5YWFjNmYtZDY0Ni00NGYwLTg5NzgtN2NhYTRmZGZlNTMzXzEwMA==','2026-04-27T16:13:03+00','outbound','https://www.linkedin.com/in/david-sepulveda-335a7850','David Sepulveda','Hi David, I saw you liked Tina''s post on the scrapers, I appreciate that. Let me know if you''d ever like to check out some samples, happy to send a set your way.',NULL,'INBOX'),
('export:2-MDU4NjJhNDYtNzQ4Ni00NTJhLWJlNzQtNmJiMmVjZWQzOWY5XzEwMA==:20260427T03042:0595b710','2-MDU4NjJhNDYtNzQ4Ni00NTJhLWJlNzQtNmJiMmVjZWQzOWY5XzEwMA==','2026-04-27T03:04:23+00','outbound','https://www.linkedin.com/in/andrew-kiehl-5b07136','Andrew Kiehl','Hi Andrew, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-ZTYwMjY3NTgtNjU3ZC00MTc4LWJmNjgtMjI2MzI1ZDFkODU4XzEwMA==:20260427T02131:9fafafc3','2-ZTYwMjY3NTgtNjU3ZC00MTc4LWJmNjgtMjI2MzI1ZDFkODU4XzEwMA==','2026-04-27T02:13:19+00','outbound','https://www.linkedin.com/in/jones-mitch','Mitch Jones','Hi Mitch, I saw you liked Tina''s post on the scrapers, I appreciate that. Your samples are on the way, looks like they''re still on schedule to be delivered this Wednesday 4/29. Looking forward to hearing what you think once you''ve had a chance to try them out.',NULL,'INBOX'),
('export:2-NDk3ZWY2YWUtNDFjNC00ZmIyLWI0MDQtYjE0Yzc4MGQ5Y2M2XzEwMA==:20260427T01493:1deda7f2','2-NDk3ZWY2YWUtNDFjNC00ZmIyLWI0MDQtYjE0Yzc4MGQ5Y2M2XzEwMA==','2026-04-27T01:49:36+00','outbound','https://www.linkedin.com/in/darrienpeoples','Darrien Peoples','Hi Darrien I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-ZTY3Nzk4MzktMTI5MC00NjU1LTkwZDAtOWM4NDYxOWI1ZGYzXzEwMA==:20260427T00480:abf0522e','2-ZTY3Nzk4MzktMTI5MC00NjU1LTkwZDAtOWM4NDYxOWI1ZGYzXzEwMA==','2026-04-27T00:48:02+00','inbound','https://www.linkedin.com/in/bronson-harris-10a29269','Bronson Harris','Will do. Thank you sir.',NULL,'INBOX'),
('export:2-ZTY3Nzk4MzktMTI5MC00NjU1LTkwZDAtOWM4NDYxOWI1ZGYzXzEwMA==:20260427T00474:311397b6','2-ZTY3Nzk4MzktMTI5MC00NjU1LTkwZDAtOWM4NDYxOWI1ZGYzXzEwMA==','2026-04-27T00:47:46+00','outbound','https://www.linkedin.com/in/bronson-harris-10a29269','Bronson Harris','Hi Bronson, I saw you liked Tina''s post on the scrapers, I appreciate that. Let me know if you''d ever like to check out some samples, happy to send a set your way.',NULL,'INBOX'),
('export:2-YmU0YzdjZmEtYzJlZC00OWRhLTlkYTYtNWFjYjFhYzFlY2ZmXzEwMA==:20260427T00075:a9a10f5c','2-YmU0YzdjZmEtYzJlZC00OWRhLTlkYTYtNWFjYjFhYzFlY2ZmXzEwMA==','2026-04-27T00:07:51+00','outbound','https://www.linkedin.com/in/robriccardo','Robert Riccardo','You''re welcome Robert.',NULL,'INBOX'),
('export:2-YmU0YzdjZmEtYzJlZC00OWRhLTlkYTYtNWFjYjFhYzFlY2ZmXzEwMA==:20260427T00065:78654ffd','2-YmU0YzdjZmEtYzJlZC00OWRhLTlkYTYtNWFjYjFhYzFlY2ZmXzEwMA==','2026-04-27T00:06:50+00','inbound','https://www.linkedin.com/in/robriccardo','Robert Riccardo','👍',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-YmU0YzdjZmEtYzJlZC00OWRhLTlkYTYtNWFjYjFhYzFlY2ZmXzEwMA==:20260427T00064:97cba485','2-YmU0YzdjZmEtYzJlZC00OWRhLTlkYTYtNWFjYjFhYzFlY2ZmXzEwMA==','2026-04-27T00:06:47+00','inbound','https://www.linkedin.com/in/robriccardo','Robert Riccardo','Thanks',NULL,'INBOX'),
('export:2-YmU0YzdjZmEtYzJlZC00OWRhLTlkYTYtNWFjYjFhYzFlY2ZmXzEwMA==:20260427T00063:0b012a66','2-YmU0YzdjZmEtYzJlZC00OWRhLTlkYTYtNWFjYjFhYzFlY2ZmXzEwMA==','2026-04-27T00:06:34+00','outbound','https://www.linkedin.com/in/robriccardo','Robert Riccardo','Hi Robert, saw you liked Tina''s post on the phenolic scrapers, appreciate that. I''ll have your samples going out tomorrow, looking forward to hearing what you think once you''ve had a chance to try them out.',NULL,'INBOX'),
('export:2-ZjY1ZDZjMDMtZTEzZC00YmU5LWI3NTctOTJhYzEwMDM5NzFjXzEwMA==:20260426T23555:a40822cd','2-ZjY1ZDZjMDMtZTEzZC00YmU5LWI3NTctOTJhYzEwMDM5NzFjXzEwMA==','2026-04-26T23:55:59+00','outbound','https://www.linkedin.com/in/joe-nemat-2673b0112','Joe Nemat','Hi Joe, thanks for connecting, I appreciate it.

I saw you''re with the Airplane Systems Training Center, looks like a great role. Are you working directly with maintenance teams as part of training?

Quick question, do your teams or students use scrapers for sealant or adhesive removal? I make a phenolic scraper for that and wanted to see if it''s something you use.',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260423T13244:362293b5','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-04-23T13:24:42+00','outbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','Hi Jonah, just wanted to check in and see if you had a chance to review pricing with your team.

Happy to help with anything or get an order going whenever you''re ready.',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260415T23050:696bcb38','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-04-15T23:05:08+00','outbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','Hi Jonah, that''s great to hear, really appreciate you sharing that feedback. There''s no coating on them, just solid phenolic, but they will dull over time depending on what they''re being used on.

Pricing is $15 each for the 6" and $16.50 each for the 11".

If you''d like to move forward, feel free to send a PO over to me at: sales@kleinmfgllc.com and I''ll be happy to get them going for you. Thank you!',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260415T22251:b1c5e5dd','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-04-15T22:25:12+00','inbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','Sean,
The team liked them a great deal.  The initial usage was phenomenal, after they dulled and had to be sharpened, I guess the coating you put on them came off, so they required sharpening more often.  They were overall well received though, and I would like to get a quote on what buying a few would cost us.

Thanks',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260415T16563:f2167813','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-04-15T16:56:31+00','outbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','Hi Jonah! Just wanted to check in and see how the scrapers worked out for your team during the maintenance event. Would love to hear your feedback.',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260401T21171:801e2f50','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-04-01T21:17:18+00','outbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','That sounds great, thank you Jonah.  Looking forward to hearing what your team thinks.',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260401T20335:003a84df','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-04-01T20:33:52+00','inbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','We have a large maintenance event beginning tomorrow, and the team will be using them during this event.  I will let you know after what they thought of them.',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260401T17070:d8873949','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-04-01T17:07:05+00','outbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','Hi Jonah, just wanted to check in and see what you and your team think of the scrapers so far.

Curious how they compare to what you''ve been using. If they''re a good fit, I''d be happy to get you pricing and set you up with an order.',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260323T21013:3f68e98f','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-03-23T21:01:32+00','outbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','That sounds great, thank you Jonah.',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260323T15495:5120faac','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-03-23T15:49:51+00','inbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','I appreciate it and will certainly let you know how the guys like them.',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260320T23242:95da8c50','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-03-20T23:24:24+00','outbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','Hi Jonah!  Just wanted to let you know I sent out one sample of each (6" and 11") scrapers this afternoon via UPS ground.  Tracking number is 1Z0592W00342970864.  Looks like they should arrive next Wednesday 3/25.  Looking forward to hearing what you think! 

If anything comes up, feel free to reach out here, or you can call or text me at (916) 671-4772 or email me at sales@kleinmfgllc.com

Thanks Jonah, have a great weekend!',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260320T20364:897bbe05','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-03-20T20:36:41+00','outbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','Thanks Jonah!

I''ll get one of each size shipped out this afternoon so your team can check them out. I''ll send over the tracking once they''re on the way.

Looking forward to hearing what your team thinks.',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260320T20130:84f48a0e','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-03-20T20:13:06+00','inbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','Bode Aviation
2502 Clark Carr Loop SE
Albuquerque, NM  87106
Attn:  Victoria Lujan

Thank you',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260320T17540:87869baa','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-03-20T17:54:09+00','outbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','That''s great to hear! I can get a set of samples put together and shipped out this afternoon so your team can check them out.

What''s the best address to send them to, and should I put it to your attention or someone on your team?',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260320T17442:ec26b985','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-03-20T17:44:25+00','inbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','We would love to try a better scraper.

Thank you',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260320T15332:d5dcb1d4','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-03-20T15:33:26+00','outbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','Good morning Jonah, thanks for connecting! 

Do your guys use scrapers much for sealant or adhesive removal on sensitive surfaces? If so, what are they using now?

We handcraft phenolic scrapers that are safe on aluminum and composites and hold up longer than typical plastic ones, especially for sealant and adhesive removal.

I''d be happy to send a couple over for your team to try.',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260320T14515:4982664b','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-03-20T14:51:56+00','inbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','Good morning Sean.  Yes, I am involved in the sourcing of consumables.',NULL,'INBOX'),
('export:2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==:20260320T14505:e1d7f97a','2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','2026-03-20T14:50:56+00','outbound','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','Hi Jonah, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-NzQ2MzZkOTQtZmFlMi00YTAwLWJiM2EtNmUyOWUwZDVlYWQ1XzEwMA==:20260422T11425:bf503249','2-NzQ2MzZkOTQtZmFlMi00YTAwLWJiM2EtNmUyOWUwZDVlYWQ1XzEwMA==','2026-04-22T11:42:53+00','outbound','https://www.linkedin.com/in/chris-kiefer-4ba5721a7','Chris Kiefer','Hi Chris, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-NzM4MDQyMDEtZTFlYS00ZTFmLTg0MmUtNTI5ZTY4MDVkMjVlXzEwMA==:20260421T12414:f5a37e17','2-NzM4MDQyMDEtZTFlYS00ZTFmLTg0MmUtNTI5ZTY4MDVkMjVlXzEwMA==','2026-04-21T12:41:40+00','outbound','https://www.linkedin.com/in/uriah-savary-831b393b9','Uriah Savary','Hi Uriah, that makes sense, appreciate you getting back to me. If that ever becomes something you''re exploring, I''d be happy to send a few samples over for your team to try.',NULL,'INBOX'),
('export:2-NzM4MDQyMDEtZTFlYS00ZTFmLTg0MmUtNTI5ZTY4MDVkMjVlXzEwMA==:20260421T07555:a58455a9','2-NzM4MDQyMDEtZTFlYS00ZTFmLTg0MmUtNTI5ZTY4MDVkMjVlXzEwMA==','2026-04-21T07:55:53+00','inbound','https://www.linkedin.com/in/uriah-savary-831b393b9','Uriah Savary','Hi Sean thanks for providing that information. We aren''t currently looking to work with consumables at the moment but I''m sure that is something we could add in the future. Will definitely keep your contact handy if that becomes a priority.',NULL,'INBOX'),
('export:2-NzM4MDQyMDEtZTFlYS00ZTFmLTg0MmUtNTI5ZTY4MDVkMjVlXzEwMA==:20260420T15363:49465c71','2-NzM4MDQyMDEtZTFlYS00ZTFmLTg0MmUtNTI5ZTY4MDVkMjVlXzEwMA==','2026-04-20T15:36:30+00','outbound','https://www.linkedin.com/in/uriah-savary-831b393b9','Uriah Savary','Hi Uriah, appreciate you reaching out and connecting.

Quick question for you, do your maintenance teams use scrapers at all for sealant or adhesive removal?

I make a phenolic scraper that''s been working really well for line maintenance teams, always interested to hear how other operations are handling that kind of work.',NULL,'INBOX'),
('export:2-YTk2Zjc5N2QtMTEzNi00ZmQ4LWExMjctMWU2YWZkNmFlNDMxXzEwMA==:20260416T15465:e3f0afdb','2-YTk2Zjc5N2QtMTEzNi00ZmQ4LWExMjctMWU2YWZkNmFlNDMxXzEwMA==','2026-04-16T15:46:54+00','outbound','https://www.linkedin.com/in/sean-donovan-7789858b','Sean Donovan','Hi Sean, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-ZjgyYTQ4ZDYtMDJiNS00NjBlLWJjZTQtOTE5N2YwYWYyOTgzXzEwMA==:20260415T12254:776d1236','2-ZjgyYTQ4ZDYtMDJiNS00NjBlLWJjZTQtOTE5N2YwYWYyOTgzXzEwMA==','2026-04-15T12:25:40+00','inbound','https://www.linkedin.com/in/derek-mathews-0b558079','Derek Mathews','No, thank you',NULL,'INBOX'),
('export:2-ZjgyYTQ4ZDYtMDJiNS00NjBlLWJjZTQtOTE5N2YwYWYyOTgzXzEwMA==:20260326T04073:7d556f85','2-ZjgyYTQ4ZDYtMDJiNS00NjBlLWJjZTQtOTE5N2YwYWYyOTgzXzEwMA==','2026-03-26T04:07:30+00','outbound','https://www.linkedin.com/in/derek-mathews-0b558079','Derek Mathews','Hi Derek, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-ZjgyYTQ4ZDYtMDJiNS00NjBlLWJjZTQtOTE5N2YwYWYyOTgzXzEwMA==:20260321T12120:bb0a7493','2-ZjgyYTQ4ZDYtMDJiNS00NjBlLWJjZTQtOTE5N2YwYWYyOTgzXzEwMA==','2026-03-21T12:12:07+00','outbound','https://www.linkedin.com/in/derek-mathews-0b558079','Derek Mathews','Hi Derek, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-ZDU5NmEyMTAtZDY3NS00OTZmLTk3ZmItMjdhNTMwMDgwMjIzXzEwMA==:20260414T22113:ed1f2126','2-ZDU5NmEyMTAtZDY3NS00OTZmLTk3ZmItMjdhNTMwMDgwMjIzXzEwMA==','2026-04-14T22:11:32+00','outbound','https://www.linkedin.com/in/samuel-ayala-257a20213','Samuel Ayala','Hi Samuel, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-NDIxMDk3NjYtMjM3Yy00ZTQ2LTk2NWItNWY3MmI1YTZlYzBhXzEwMA==:20260414T15570:f47fe1e8','2-NDIxMDk3NjYtMjM3Yy00ZTQ2LTk2NWItNWY3MmI1YTZlYzBhXzEwMA==','2026-04-14T15:57:00+00','outbound','https://www.linkedin.com/in/patrick-brody-mckenna-b034b920a','Patrick "Brody" Mckenna','Hi Brody, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260414T01013:c5f04beb','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-04-14T01:01:30+00','outbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','That sounds great, thank you Michael! Good luck getting settled in at the new company!',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260414T00585:90e84493','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-04-14T00:58:58+00','inbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','Absolutely and and thank you! I''ll get settled into the new place and see where things are at and reach out! Thank you!',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260414T00362:4c2d2191','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-04-14T00:36:23+00','outbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','That''s great to hear, really appreciate you sharing that and passing it along internally.

And congrats on the new role, hope the transition is going well!

If it makes sense down the road at your new company, I''d be happy to get some samples over there as well. And if there''s someone on your previous team you think I should connect with directly, I''m all ears. Thanks Michael!',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260414T00210:ed73b609','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-04-14T00:21:06+00','inbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','It worked well! Thanks for checking in! 

I have recently transitioned to another company so I''ve left your contact info and how I liked the product in my pass-down notes for the VP and next DOM. I recommend stocking some in the shop. 

Definitely keeping these in mind if I need scrapers where I''m headed.',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260414T00114:9d5c4428','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-04-14T00:11:49+00','outbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','Hi Michael! Just wanted to check in and see how the scrapers worked out for the door seal replacement last week.',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260401T17201:3a022be3','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-04-01T17:20:17+00','outbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','Hey Michael!  That''s perfect, that''ll be a great test for them!  I''m curious to hear how they hold up for your team compared to what you''ve been using.',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260401T17095:068b9e51','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-04-01T17:09:51+00','inbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','Hey Sean! Initial impressions they look great! I have a door seal replacement scheduled next week and plan on giving them a good run through on that!',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260401T17082:bde57c4a','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-04-01T17:08:21+00','outbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','Hi Michael, just wanted to check in and see what you and your team think of the scrapers so far.

Curious how they compare to what you''ve been using. If they''re a good fit, I''d be happy to get you pricing and set you up with an order.',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260326T00213:5bb83aa6','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-03-26T00:21:34+00','outbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','You''re welcome Michael! Looking forward to hearing your feedback!',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260325T23012:bf15a523','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-03-25T23:01:27+00','inbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','Much appreciated! Looking forward to trying them out! Thanks for reaching out and sending the demo!',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260325T21335:fa8c65b6','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-03-25T21:33:50+00','outbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','Hi Michael! Just wanted to let you know I sent out one sample of each (6" and 11") scrapers this afternoon via UPS ground. Tracking number is 1Z0592W00342298949. Looks like they should arrive this Friday 3/27. Looking forward to hearing what you think!

If anything comes up, feel free to reach out here, or you can call or text me at (916) 671-4772 or email me at sales@kleinmfgllc.com

Thanks Michael!',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260325T20465:9bd536fc','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-03-25T20:46:52+00','outbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','Thanks Michael.

I''ll get a couple demos packaged up and shipped out today to your attention. I''ll send over the tracking number once they''re on the way.

Looking forward to hearing what your team thinks!',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260325T20055:8b888f7e','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-03-25T20:05:55+00','inbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','Thanks, Sean! These look pretty handy! 

You can ship/address the demos to me and I''ll get them to some guys at both facilities. 

Michael Lineaweaver 
9521 Mothers Joy St 
Las Vegas, NV 
89178

I appreciate it!',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260325T13505:89dca005','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-03-25T13:50:56+00','outbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','Good morning Michael, thanks for the response.

I''d be happy to send some demos out, just let me know where you''d like them shipped and who they should be addressed to.

I don''t have a brochure, but feel free to check out our website here: kleinmfgllc.com.',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260325T05164:3c74c2d1','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-03-25T05:16:43+00','inbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','Hey Sean, it did in fact get buried! I''d be interested in some demos, do you have any brochures or a website link?',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260324T23452:ab32bfda','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-03-24T23:45:22+00','outbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','Hi Michael, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==:20260320T02315:9a3e5ef8','2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','2026-03-20T02:31:56+00','outbound','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','Hi Michael, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20260405T01032:c3af2df5','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2026-04-05T01:03:26+00','inbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','Absolutely',NULL,'INBOX'),
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20260401T16342:66b3cfde','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2026-04-01T16:34:29+00','outbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','Hi Luis, we just received an order from your company, which is great to see. I wanted to say thank you, I really appreciate you giving us the opportunity!

Looking forward to working together moving forward, I appreciate it!',NULL,'INBOX'),
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20260326T00210:da84efd7','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2026-03-26T00:21:04+00','outbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','You''re welcome Luis! Looking forward to hearing your feedback!',NULL,'INBOX'),
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20260325T23554:4d70de37','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2026-03-25T23:55:47+00','inbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','Thank you man',NULL,'INBOX'),
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20260325T21041:4b1f849d','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2026-03-25T21:04:19+00','outbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','Hi Luis!  Just wanted to let you know I sent out one sample of each (6" and 11") scrapers this afternoon via UPS ground.  Tracking number is 1Z0592W00340411337.  Looks like they should arrive next Wednesday 4/1.  Looking forward to hearing what you think!

If anything comes up, feel free to reach out here, or you can call or text me at (916) 671-4772 or email me at sales@kleinmfgllc.com

Thanks Luis!',NULL,'INBOX'),
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20260325T02081:8cebc569','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2026-03-25T02:08:19+00','outbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','Hi Luis, I appreciate you sending that over, thank you.

I''ll get a couple samples of both our 6" and 11" scrapers packaged up and shipped out tomorrow to that address. Once they''re on the way, I''ll send you the UPS tracking info.

Looking forward to hearing what you and your team think after you''ve had a chance to check them out. Thanks again Luis, I appreciate the opportunity.',NULL,'INBOX'),
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20260325T01132:f53d3cd3','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2026-03-25T01:13:21+00','inbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','Thanks please send it to 

460 airport rd RockHill  sc',NULL,'INBOX'),
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20260323T21011:6c2e4829','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2026-03-23T21:01:16+00','outbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','Hi Luis, absolutely, I''d be happy to send a couple of samples over for your team to test.

Just send me the best shipping address and contact name, and I''ll get them shipped out.

Thanks Luis, I appreciate it.',NULL,'INBOX'),
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20260323T20512:1a4fc8ee','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2026-03-23T20:51:28+00','inbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','Can si send me a colme of test product',NULL,'INBOX'),
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20260319T22210:580f1d73','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2026-03-19T22:21:07+00','outbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','Hi Luis.  We connected a while back and you had asked about the phenolic scrapers we make for aircraft maintenance.

Just wanted to circle back to see if it''s something your team might still find useful, I''d be happy to send a couple samples over for you to try out.

No pressure at all, just let me know.',NULL,'INBOX'),
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20250624T17121:488df6e0','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2025-06-24T17:12:15+00','outbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','Hi Luis! I appreciate your interest.

Our phenolic scrapers are commonly used in aircraft maintenance for removing sealants, adhesives, and corrosion without damaging metal surfaces. They''re made from durable, chemical-resistant phenolic and are safe to use on aluminum and composite surfaces.

We manufacture them here in California and offer two sizes — 6" and 11" lengths. I supply several aviation MRO teams across the U.S., and we keep inventory on hand for quick turnaround.

I''d be happy to send a couple of samples your way if you''d like to try them out.',NULL,'INBOX'),
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20250624T16575:fb7345b8','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2025-06-24T16:57:56+00','inbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','Tell me more',NULL,'INBOX'),
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20250624T16574:7031add1','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2025-06-24T16:57:46+00','inbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','Sounds interesting',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==:20250624T16570:da4cbcb2','2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','2025-06-24T16:57:07+00','outbound','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','Hi Luis, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-MjBjYTZmMWQtMDFmNS00NzlhLWJjY2YtNGNhNmM0Nzk3ZWVmXzEwMA==:20260401T06364:c115e44f','2-MjBjYTZmMWQtMDFmNS00NzlhLWJjY2YtNGNhNmM0Nzk3ZWVmXzEwMA==','2026-04-01T06:36:45+00','outbound','https://www.linkedin.com/in/christopher-botelho-271b13132','Christopher Botelho','Hi Christopher, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==:20260401T03414:d0e5bb1d','2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==','2026-04-01T03:41:40+00','outbound','https://www.linkedin.com/in/bryan-diaz-35171887','Bryan Diaz','Hi Bryan, no problem at all

Quick question for you: do your crews use scrapers at all for sealant or adhesive removal during maintenance?

If so, I''d be happy to send a couple over for your guys to try out and get your feedback.',NULL,'INBOX'),
('export:2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==:20260331T12372:c6027f5b','2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==','2026-03-31T12:37:27+00','inbound','https://www.linkedin.com/in/bryan-diaz-35171887','Bryan Diaz','would have to look into it and advise',NULL,'INBOX'),
('export:2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==:20260331T12370:976d6f3c','2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==','2026-03-31T12:37:05+00','inbound','https://www.linkedin.com/in/bryan-diaz-35171887','Bryan Diaz','I''m not sure',NULL,'INBOX'),
('export:2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==:20260319T22253:e974ec4e','2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==','2026-03-19T22:25:33+00','outbound','https://www.linkedin.com/in/bryan-diaz-35171887','Bryan Diaz','Hi Bryan, just wanted to circle back like we talked about a while back.

Hope things have settled in with the new role.

Curious if you''ve gotten more visibility into who handles MRO tools and consumables over there?',NULL,'INBOX'),
('export:2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==:20250715T00570:78654ffd','2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==','2025-07-15T00:57:09+00','inbound','https://www.linkedin.com/in/bryan-diaz-35171887','Bryan Diaz','👍',NULL,'INBOX'),
('export:2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==:20250715T00532:bda85ff1','2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==','2025-07-15T00:53:29+00','outbound','https://www.linkedin.com/in/bryan-diaz-35171887','Bryan Diaz','Thanks, Bryan — appreciate it! I''ll check back in a little later on. Wishing you continued success as you get settled in.',NULL,'INBOX'),
('export:2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==:20250715T00522:c3af2df5','2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==','2025-07-15T00:52:23+00','inbound','https://www.linkedin.com/in/bryan-diaz-35171887','Bryan Diaz','Absolutely',NULL,'INBOX'),
('export:2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==:20250715T00505:a471a066','2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==','2025-07-15T00:50:56+00','outbound','https://www.linkedin.com/in/bryan-diaz-35171887','Bryan Diaz','Got it — thanks for letting me know, Bryan, and congratulations on the new role!
I know there''s a lot to get up to speed on in a new position. Would it be alright if I checked back in with you down the line, once things are a bit more settled?',NULL,'INBOX'),
('export:2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==:20250715T00452:dfe4e3d0','2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==','2025-07-15T00:45:23+00','inbound','https://www.linkedin.com/in/bryan-diaz-35171887','Bryan Diaz','I actually just started here and haven''t yet established those internal connections, so unfortunately I don''t have a point of contact to share at this time.',NULL,'INBOX'),
('export:2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==:20250715T00412:06aa253d','2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==','2025-07-15T00:41:29+00','outbound','https://www.linkedin.com/in/bryan-diaz-35171887','Bryan Diaz','Hi Bryan.  Thanks for the quick reply — I really appreciate it. I totally understand that you''re not involved in sourcing tools. If by chance you know which department or team at American handles that type of purchasing, I''d be grateful for any direction.

Either way, wishing you continued success and thanks again for taking the time to respond!',NULL,'INBOX'),
('export:2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==:20250715T00362:25958e0b','2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==','2025-07-15T00:36:20+00','inbound','https://www.linkedin.com/in/bryan-diaz-35171887','Bryan Diaz','Thank you for reaching out and introducing yourself and Klein Manufacturing. I appreciate you sharing information about your phenolic scrapers. At this time, I''m not involved in sourcing tools or consumables for MRO.

Wishing you the best in your continued efforts.',NULL,'INBOX'),
('export:2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==:20250715T00361:fc9c20ea','2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==','2025-07-15T00:36:19+00','outbound','https://www.linkedin.com/in/bryan-diaz-35171887','Bryan Diaz','Hi Bryan, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-ZTA1NWY3OTMtZGQxYS00M2ZjLWIyODAtMDEzMDFjYjEwMjA1XzEwMA==:20260331T01100:dd116a12','2-ZTA1NWY3OTMtZGQxYS00M2ZjLWIyODAtMDEzMDFjYjEwMjA1XzEwMA==','2026-03-31T01:10:08+00','outbound','https://www.linkedin.com/in/joseph-dimatteo','Joseph DiMatteo','Hi Joseph I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?',NULL,'INBOX'),
('export:2-MTMwYjUxYjEtZTM4NS00MThmLWEyZDMtNjIyYWE5NDI0YjEwXzEwMA==:20260330T23460:443e395b','2-MTMwYjUxYjEtZTM4NS00MThmLWEyZDMtNjIyYWE5NDI0YjEwXzEwMA==','2026-03-30T23:46:09+00','outbound','https://www.linkedin.com/in/mike-gallas-2a922b5','Mike Gallas','Hi Mike, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-MTMwYjUxYjEtZTM4NS00MThmLWEyZDMtNjIyYWE5NDI0YjEwXzEwMA==:20260325T18331:3735d5d6','2-MTMwYjUxYjEtZTM4NS00MThmLWEyZDMtNjIyYWE5NDI0YjEwXzEwMA==','2026-03-25T18:33:13+00','outbound','https://www.linkedin.com/in/mike-gallas-2a922b5','Mike Gallas','Hi Mike, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-NDk0YzkwMWYtNmZlZC00MDI3LWI5NTUtODEzYmViYTgwNDdkXzEwMA==:20260328T14521:627c8304','2-NDk0YzkwMWYtNmZlZC00MDI3LWI5NTUtODEzYmViYTgwNDdkXzEwMA==','2026-03-28T14:52:14+00','outbound','https://www.linkedin.com/in/aircraft-service-providers-llc-85667b32a','Aircraft  Service Providers LLC','Hello, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, safe on aluminum and composite surfaces and built for real-world use.

Do your teams ever have a need for scrapers for adhesive or sealant removal?',NULL,'INBOX'),
('export:2-NTY4Mjk1N2ItYWQ0MS00ZmQzLTgyZTUtNzhlZDkzYmIxZTYzXzEwMA==:20260327T23132:0af3fe0d','2-NTY4Mjk1N2ItYWQ0MS00ZmQzLTgyZTUtNzhlZDkzYmIxZTYzXzEwMA==','2026-03-27T23:13:21+00','outbound','https://www.linkedin.com/in/orel-elbaz-564491213','Orel Elbaz','Hi Orel, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-NTY4Mjk1N2ItYWQ0MS00ZmQzLTgyZTUtNzhlZDkzYmIxZTYzXzEwMA==:20260323T21044:6f4734d7','2-NTY4Mjk1N2ItYWQ0MS00ZmQzLTgyZTUtNzhlZDkzYmIxZTYzXzEwMA==','2026-03-23T21:04:42+00','outbound','https://www.linkedin.com/in/orel-elbaz-564491213','Orel Elbaz','Hi Orel, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-NTNiOThiODktYjg0NS00OTlhLWJlNjgtMTg1MTgxMGIxODQwXzEwMA==:20260325T14084:88a04b66','2-NTNiOThiODktYjg0NS00OTlhLWJlNjgtMTg1MTgxMGIxODQwXzEwMA==','2026-03-25T14:08:43+00','inbound','https://www.linkedin.com/in/scott-bjergo-96746695','Scott Bjergo','Sounds good',NULL,'INBOX'),
('export:2-NTNiOThiODktYjg0NS00OTlhLWJlNjgtMTg1MTgxMGIxODQwXzEwMA==:20260325T02123:3b6e0327','2-NTNiOThiODktYjg0NS00OTlhLWJlNjgtMTg1MTgxMGIxODQwXzEwMA==','2026-03-25T02:12:39+00','outbound','https://www.linkedin.com/in/scott-bjergo-96746695','Scott Bjergo','Hi Scott, no worries at all, I appreciate you getting back to me.

Good luck with the transition, hope the new role is a great move for you.

I won''t be able to make it to MRO this year, but I''d definitely like to stay in touch. Once you''re settled in, I''d be glad to reconnect and see if it makes sense to get some samples in front of your team.

Hope everything goes smoothly with the new job.',NULL,'INBOX'),
('export:2-NTNiOThiODktYjg0NS00OTlhLWJlNjgtMTg1MTgxMGIxODQwXzEwMA==:20260325T01135:29f1c215','2-NTNiOThiODktYjg0NS00OTlhLWJlNjgtMTg1MTgxMGIxODQwXzEwMA==','2026-03-25T01:13:51+00','inbound','https://www.linkedin.com/in/scott-bjergo-96746695','Scott Bjergo','Sorry in the middle of a job change. So might be looking later just not in the near future. Will you be at MRO?',NULL,'INBOX'),
('export:2-NTNiOThiODktYjg0NS00OTlhLWJlNjgtMTg1MTgxMGIxODQwXzEwMA==:20260324T23534:95b85cc3','2-NTNiOThiODktYjg0NS00OTlhLWJlNjgtMTg1MTgxMGIxODQwXzEwMA==','2026-03-24T23:53:45+00','outbound','https://www.linkedin.com/in/scott-bjergo-96746695','Scott Bjergo','Hi Scott, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-NTNiOThiODktYjg0NS00OTlhLWJlNjgtMTg1MTgxMGIxODQwXzEwMA==:20260321T03291:4bc480ad','2-NTNiOThiODktYjg0NS00OTlhLWJlNjgtMTg1MTgxMGIxODQwXzEwMA==','2026-03-21T03:29:14+00','outbound','https://www.linkedin.com/in/scott-bjergo-96746695','Scott Bjergo','Hi Scott, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-YjllMzk5MzktZTJkMy00ZGI1LTliYzctNTcyMjczYzhjZTI2XzEwMA==:20260325T00551:ce3e60c1','2-YjllMzk5MzktZTJkMy00ZGI1LTliYzctNTcyMjczYzhjZTI2XzEwMA==','2026-03-25T00:55:11+00','outbound','https://www.linkedin.com/in/todd-cofer-22a4a5304','Todd Cofer','Hi Todd, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-OTQ4NTQxZWEtYjFjNy00YTMyLTg4ODYtM2I1N2E4ZDdjMDJlXzEwMA==:20260324T23532:443e395b','2-OTQ4NTQxZWEtYjFjNy00YTMyLTg4ODYtM2I1N2E4ZDdjMDJlXzEwMA==','2026-03-24T23:53:28+00','outbound','https://www.linkedin.com/in/mike-horan-46704a337','Mike Horan','Hi Mike, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-OTQ4NTQxZWEtYjFjNy00YTMyLTg4ODYtM2I1N2E4ZDdjMDJlXzEwMA==:20260321T00420:3735d5d6','2-OTQ4NTQxZWEtYjFjNy00YTMyLTg4ODYtM2I1N2E4ZDdjMDJlXzEwMA==','2026-03-21T00:42:05+00','outbound','https://www.linkedin.com/in/mike-horan-46704a337','Mike Horan','Hi Mike, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-MjcyY2UxMzgtMTg5NS00MWYxLWIzNzMtNDNkMjg4MTJlOGZjXzEwMA==:20260324T23531:259c47ab','2-MjcyY2UxMzgtMTg5NS00MWYxLWIzNzMtNDNkMjg4MTJlOGZjXzEwMA==','2026-03-24T23:53:10+00','outbound','https://www.linkedin.com/in/shawn-petersen-6a241b129','Shawn Petersen','Hi Shawn, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-MjcyY2UxMzgtMTg5NS00MWYxLWIzNzMtNDNkMjg4MTJlOGZjXzEwMA==:20260320T13155:95b20003','2-MjcyY2UxMzgtMTg5NS00MWYxLWIzNzMtNDNkMjg4MTJlOGZjXzEwMA==','2026-03-20T13:15:50+00','outbound','https://www.linkedin.com/in/shawn-petersen-6a241b129','Shawn Petersen','Hi Shawn, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-Mjg5N2RlZWMtOTNmZC00NmUyLWJkN2YtMGE4M2M5NTQ1ZjQ0XzEwMA==:20260324T23520:132aed66','2-Mjg5N2RlZWMtOTNmZC00NmUyLWJkN2YtMGE4M2M5NTQ1ZjQ0XzEwMA==','2026-03-24T23:52:02+00','outbound','https://www.linkedin.com/in/vortex-aircraft-services-3a97b5244','Vortex Aircraft Services','Hello! Thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-Mjg5N2RlZWMtOTNmZC00NmUyLWJkN2YtMGE4M2M5NTQ1ZjQ0XzEwMA==:20260320T19213:87f607b2','2-Mjg5N2RlZWMtOTNmZC00NmUyLWJkN2YtMGE4M2M5NTQ1ZjQ0XzEwMA==','2026-03-20T19:21:33+00','outbound','https://www.linkedin.com/in/vortex-aircraft-services-3a97b5244','Vortex Aircraft Services','Hello, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, safe on aluminum and composite surfaces and built for real-world use. Who would be the best person to connect with regarding MRO tools or consumables?',NULL,'INBOX'),
('export:2-MDA0ODQ1YWEtN2Y1OS00N2JkLTgyNDQtMGE4YWI2NjVkZGQ4XzEwMA==:20260324T23512:ec47c876','2-MDA0ODQ1YWEtN2Y1OS00N2JkLTgyNDQtMGE4YWI2NjVkZGQ4XzEwMA==','2026-03-24T23:51:29+00','outbound','https://www.linkedin.com/in/robert-jacobs-77152539','Robert Jacobs','Hi Robert, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-MDA0ODQ1YWEtN2Y1OS00N2JkLTgyNDQtMGE4YWI2NjVkZGQ4XzEwMA==:20260320T22234:5ac88adf','2-MDA0ODQ1YWEtN2Y1OS00N2JkLTgyNDQtMGE4YWI2NjVkZGQ4XzEwMA==','2026-03-20T22:23:42+00','outbound','https://www.linkedin.com/in/robert-jacobs-77152539','Robert Jacobs','Hi Robert, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-Y2E5OGFhNmYtMmZjZS00ZWVhLTkyYzQtMGU0Mjk0NmJhYmZlXzEwMA==:20260324T23504:659863eb','2-Y2E5OGFhNmYtMmZjZS00ZWVhLTkyYzQtMGU0Mjk0NmJhYmZlXzEwMA==','2026-03-24T23:50:42+00','outbound','https://www.linkedin.com/in/stephanus-ackermann-36831a225','Stephanus Ackermann','Hi Stephanus, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-Y2E5OGFhNmYtMmZjZS00ZWVhLTkyYzQtMGU0Mjk0NmJhYmZlXzEwMA==:20260320T11042:721af58d','2-Y2E5OGFhNmYtMmZjZS00ZWVhLTkyYzQtMGU0Mjk0NmJhYmZlXzEwMA==','2026-03-20T11:04:24+00','outbound','https://www.linkedin.com/in/stephanus-ackermann-36831a225','Stephanus Ackermann','Hi Stephanus, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-ODE1YmNmNjktM2E0YS00NjhhLWIyMDktOWZmM2UwZjVmOTczXzEwMA==:20260324T23454:ab32bfda','2-ODE1YmNmNjktM2E0YS00NjhhLWIyMDktOWZmM2UwZjVmOTczXzEwMA==','2026-03-24T23:45:46+00','outbound','https://www.linkedin.com/in/michael-w-johnson-56bb93381','Michael W. Johnson','Hi Michael, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-ODE1YmNmNjktM2E0YS00NjhhLWIyMDktOWZmM2UwZjVmOTczXzEwMA==:20260320T05194:9a3e5ef8','2-ODE1YmNmNjktM2E0YS00NjhhLWIyMDktOWZmM2UwZjVmOTczXzEwMA==','2026-03-20T05:19:47+00','outbound','https://www.linkedin.com/in/michael-w-johnson-56bb93381','Michael W. Johnson','Hi Michael, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-ZDMwNTdkODUtN2M5NC00NzdhLWI3MTEtZjQ2NWFhODkzZmNlXzEwMA==:20260324T23441:6da6d19a','2-ZDMwNTdkODUtN2M5NC00NzdhLWI3MTEtZjQ2NWFhODkzZmNlXzEwMA==','2026-03-24T23:44:19+00','outbound','https://www.linkedin.com/in/paul-diaz-a03a30187','Paul Diaz','Hi Paul, thanks for connecting! Just wanted to follow up in case my last message got buried. If you''re the right person for tools and consumables, I''d be happy to send a couple samples over for you to check out.',NULL,'INBOX'),
('export:2-ZDMwNTdkODUtN2M5NC00NzdhLWI3MTEtZjQ2NWFhODkzZmNlXzEwMA==:20260319T22250:4c1e7fbc','2-ZDMwNTdkODUtN2M5NC00NzdhLWI3MTEtZjQ2NWFhODkzZmNlXzEwMA==','2026-03-19T22:25:07+00','outbound','https://www.linkedin.com/in/paul-diaz-a03a30187','Paul Diaz','Hi Paul, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-YWYzZGJiM2ItMTllMi00MmE2LTk0YjYtNWQ3ZTYyZGQ4NWFiXzEwMA==:20260323T12243:ab55e015','2-YWYzZGJiM2ItMTllMi00MmE2LTk0YjYtNWQ3ZTYyZGQ4NWFiXzEwMA==','2026-03-23T12:24:37+00','outbound','https://www.linkedin.com/in/christina-richason-5a8b9335','Christina Richason','Hi Christina, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-YTEwZGQ0NTMtZjczZi00MDY0LThkNzEtYmNmOGY1YTVkYWVkXzEwMA==:20260322T00031:9869c57a','2-YTEwZGQ0NTMtZjczZi00MDY0LThkNzEtYmNmOGY1YTVkYWVkXzEwMA==','2026-03-22T00:03:11+00','outbound','https://www.linkedin.com/in/joshua-dunn52','Joshua Dunn','Got it, I appreciate that.

That''s pretty common, most teams don''t think much about scrapers until they start dealing with tools breaking or surface damage.

If you ever want to try a couple out, I''d be happy to send some over for your team to check out. No pressure at all.',NULL,'INBOX'),
('export:2-YTEwZGQ0NTMtZjczZi00MDY0LThkNzEtYmNmOGY1YTVkYWVkXzEwMA==:20260321T19002:0d5ac939','2-YTEwZGQ0NTMtZjczZi00MDY0LThkNzEtYmNmOGY1YTVkYWVkXzEwMA==','2026-03-21T19:00:20+00','inbound','https://www.linkedin.com/in/joshua-dunn52','Joshua Dunn','That''s interesting thanks for sharing. We do have to remove sealant with scrapers sometimes for bigger jobs, I''ll take a look at what we use next time it comes up. I really never gave it much thought.',NULL,'INBOX'),
('export:2-YTEwZGQ0NTMtZjczZi00MDY0LThkNzEtYmNmOGY1YTVkYWVkXzEwMA==:20260320T13003:78452889','2-YTEwZGQ0NTMtZjczZi00MDY0LThkNzEtYmNmOGY1YTVkYWVkXzEwMA==','2026-03-20T13:00:32+00','outbound','https://www.linkedin.com/in/joshua-dunn52','Joshua Dunn','Good morning Joshua, that''s a great question. The biggest difference is everything we make is purpose-built and hand made specifically for aircraft maintenance, not mass-produced tooling.

Our scrapers are designed to be safe on sensitive surfaces and hold up in real world use. The phenolic material won''t gouge aluminum or composite, and they tend to last longer than typical plastic scrapers. Most teams end up switching after dealing with tools breaking or surface damage.

In your line maintenance environment, are your guys using scrapers much for sealant or adhesive removal?',NULL,'INBOX'),
('export:2-YTEwZGQ0NTMtZjczZi00MDY0LThkNzEtYmNmOGY1YTVkYWVkXzEwMA==:20260320T11194:fa6687ef','2-YTEwZGQ0NTMtZjczZi00MDY0LThkNzEtYmNmOGY1YTVkYWVkXzEwMA==','2026-03-20T11:19:40+00','inbound','https://www.linkedin.com/in/joshua-dunn52','Joshua Dunn','No, I operate in more of a line MX environment. What seperates Klein from other aircraft tooling companies?',NULL,'INBOX'),
('export:2-YTEwZGQ0NTMtZjczZi00MDY0LThkNzEtYmNmOGY1YTVkYWVkXzEwMA==:20260320T11193:9f001a0b','2-YTEwZGQ0NTMtZjczZi00MDY0LThkNzEtYmNmOGY1YTVkYWVkXzEwMA==','2026-03-20T11:19:39+00','outbound','https://www.linkedin.com/in/joshua-dunn52','Joshua Dunn','Hi Joshua, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-NWRjYmZmMTItZTc5Ni00ZjBiLThjZWMtNWU5Njc5NzQ0MzEwXzEwMA==:20260320T15312:d7854118','2-NWRjYmZmMTItZTc5Ni00ZjBiLThjZWMtNWU5Njc5NzQ0MzEwXzEwMA==','2026-03-20T15:31:27+00','inbound','https://www.linkedin.com/in/maria-de-jesus-0807bb37','MARIA DE JESUS','Any time',NULL,'INBOX'),
('export:2-NWRjYmZmMTItZTc5Ni00ZjBiLThjZWMtNWU5Njc5NzQ0MzEwXzEwMA==:20260320T15214:8a6f3968','2-NWRjYmZmMTItZTc5Ni00ZjBiLThjZWMtNWU5Njc5NzQ0MzEwXzEwMA==','2026-03-20T15:21:41+00','outbound','https://www.linkedin.com/in/maria-de-jesus-0807bb37','MARIA DE JESUS','Good morning Maria.  Thank you, I really appreciate you pointing me in the right direction!  I''ll reach out to them today.

Thanks again for your help!  I hope you have a great weekend!',NULL,'INBOX'),
('export:2-NWRjYmZmMTItZTc5Ni00ZjBiLThjZWMtNWU5Njc5NzQ0MzEwXzEwMA==:20260320T14121:3d88e063','2-NWRjYmZmMTItZTc5Ni00ZjBiLThjZWMtNWU5Njc5NzQ0MzEwXzEwMA==','2026-03-20T14:12:19+00','inbound','https://www.linkedin.com/in/maria-de-jesus-0807bb37','MARIA DE JESUS','Hi Sean, I''m not involved with sourcing tools or comsumables. Normally our purchasing department take care of that. Here is their email if you would like to contact them purchasing@velocitymx.com',NULL,'INBOX'),
('export:2-NWRjYmZmMTItZTc5Ni00ZjBiLThjZWMtNWU5Njc5NzQ0MzEwXzEwMA==:20260320T08492:042eda86','2-NWRjYmZmMTItZTc5Ni00ZjBiLThjZWMtNWU5Njc5NzQ0MzEwXzEwMA==','2026-03-20T08:49:23+00','outbound','https://www.linkedin.com/in/maria-de-jesus-0807bb37','MARIA DE JESUS','Hi Maria, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-NGY1YzAwMWItMTQ0Yi00ODUzLTkwNGUtNmNlOWMyM2UxZGZhXzEwMA==:20260320T14395:0fd335d0','2-NGY1YzAwMWItMTQ0Yi00ODUzLTkwNGUtNmNlOWMyM2UxZGZhXzEwMA==','2026-03-20T14:39:54+00','outbound','https://www.linkedin.com/in/brian-sprecher-43321979','Brian Sprecher','Thanks Brian, I really appreciate you pointing me in the right direction!  I''ll reach out to Steve.

Hope you have a great weekend as well!',NULL,'INBOX'),
('export:2-NGY1YzAwMWItMTQ0Yi00ODUzLTkwNGUtNmNlOWMyM2UxZGZhXzEwMA==:20260320T13324:06965134','2-NGY1YzAwMWItMTQ0Yi00ODUzLTkwNGUtNmNlOWMyM2UxZGZhXzEwMA==','2026-03-20T13:32:42+00','inbound','https://www.linkedin.com/in/brian-sprecher-43321979','Brian Sprecher','I am not. You would need to talk to Steve Trent steve@samexx.com. I hope this helps, have a great weekend!',NULL,'INBOX'),
('export:2-NGY1YzAwMWItMTQ0Yi00ODUzLTkwNGUtNmNlOWMyM2UxZGZhXzEwMA==:20260320T13303:491c3e3b','2-NGY1YzAwMWItMTQ0Yi00ODUzLTkwNGUtNmNlOWMyM2UxZGZhXzEwMA==','2026-03-20T13:30:34+00','outbound','https://www.linkedin.com/in/brian-sprecher-43321979','Brian Sprecher','Hi Brian, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-YzAxMGUzNGUtYjA1Yi00ZDJhLTliNGUtYTUwNWRkMWM0ZTRhXzEwMA==:20260320T03425:33092e4e','2-YzAxMGUzNGUtYjA1Yi00ZDJhLTliNGUtYTUwNWRkMWM0ZTRhXzEwMA==','2026-03-20T03:42:56+00','outbound','https://www.linkedin.com/in/christopher-reverski-41074342','Christopher Reverski','Hi Christopher. I wanted to introduce myself and Klein Manufacturing. We recently supplied phenolic scrapers to your team. I''d be glad to hear any feedback once they''ve had a chance to use them.',NULL,'INBOX'),
('export:2-ODNmMmI0NDctYmY1ZS00YjI4LTk5MjQtNmVmNjY3NDQ1Y2Y4XzEwMA==:20260319T22084:78825069','2-ODNmMmI0NDctYmY1ZS00YjI4LTk5MjQtNmVmNjY3NDQ1Y2Y4XzEwMA==','2026-03-19T22:08:47+00','outbound','https://www.linkedin.com/in/tetiana-lisina-1b451a144','Tetiana Lisina','Hi Tetiana,

Thanks for connecting! I checked out MyFAA, looks like you guys are doing some really interesting work around maintenance tracking and compliance.

I run a small manufacturing shop where we make specialized phenolic scrapers used in aircraft maintenance. Not sure if that overlaps directly with what you guys do, but figured it was worth connecting given we''re both in the aviation space.

Do you guys tend to work more directly with maintenance teams, or is it more on the compliance/management side?',NULL,'INBOX'),
('export:2-YzU2ZjA0NTItODEyNy00NTFmLWE3ODUtYmU3NzJhZDU5MTBlXzEwMA==:20260319T01232:2e863322','2-YzU2ZjA0NTItODEyNy00NTFmLWE3ODUtYmU3NzJhZDU5MTBlXzEwMA==','2026-03-19T01:23:29+00','outbound','https://www.linkedin.com/in/natedietsch','Nate Dietsch','Hi Nate, I wanted to circle back with you real quick.

You mentioned your team is already using our scrapers, which is great to hear. I''m curious, do you happen to know which ones they''re using or how they''re currently sourcing them?

If they''re going through a third party, I can usually simplify things quite a bit and get you set up with direct ordering, better pricing, and consistent supply.

Happy to send over a small batch as well so you can confirm they match what your team is using.

Let me know what you''re seeing on your end. Thank you.',NULL,'INBOX'),
('export:2-YzU2ZjA0NTItODEyNy00NTFmLWE3ODUtYmU3NzJhZDU5MTBlXzEwMA==:20250929T14311:f9804286','2-YzU2ZjA0NTItODEyNy00NTFmLWE3ODUtYmU3NzJhZDU5MTBlXzEwMA==','2025-09-29T14:31:11+00','outbound','https://www.linkedin.com/in/natedietsch','Nate Dietsch','Good morning Nate, that''s great to hear! I''m really glad your team is already using our scrapers and finding them useful. Yes, you can definitely order directly through me. I''d be happy to get you set up and make the process simple.

Do you have a sense of the typical volume your team goes through? I can provide tiered pricing based on usage, and I''d also be glad to send you a few samples so you have them on hand while we finalize things.

All I need is a purchase order once you''re ready, and I can ship parts directly to you. Whatever works best for your team, I''ll make it happen.

You can reach me directly at sales@kleinmfgllc.com or 916-671-4772 if that''s easier than messaging here. Thank you Nate.',NULL,'INBOX'),
('export:2-YzU2ZjA0NTItODEyNy00NTFmLWE3ODUtYmU3NzJhZDU5MTBlXzEwMA==:20250929T00393:d5a92bb6','2-YzU2ZjA0NTItODEyNy00NTFmLWE3ODUtYmU3NzJhZDU5MTBlXzEwMA==','2025-09-29T00:39:34+00','inbound','https://www.linkedin.com/in/natedietsch','Nate Dietsch','Hi Sean, thanks for your patience while I got to your message. My technicians order tools as they need them, and I''m happy to say we use your scrapers now! 

I believe we''ve procured them through other means. Is there a way to get them directly from you?',NULL,'INBOX'),
('export:2-YzU2ZjA0NTItODEyNy00NTFmLWE3ODUtYmU3NzJhZDU5MTBlXzEwMA==:20250625T16132:8187fe25','2-YzU2ZjA0NTItODEyNy00NTFmLWE3ODUtYmU3NzJhZDU5MTBlXzEwMA==','2025-06-25T16:13:24+00','outbound','https://www.linkedin.com/in/natedietsch','Nate Dietsch','Hi Nate, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-MGRhZWEyZjAtNzk5YS00ZGNiLWJhN2YtODQ5ODhmNzAxNzRmXzEwMA==:20251106T18113:c70070d4','2-MGRhZWEyZjAtNzk5YS00ZGNiLWJhN2YtODQ5ODhmNzAxNzRmXzEwMA==','2025-11-06T18:11:33+00','inbound','https://www.linkedin.com/in/lavonne-cole','Lavonne Cole','Hey there Sean, 

Figured this might be worth a quick note as you head into 2026 planning.

I work with manufacturers and B2B firms helping them build steady pipelines of qualified leads and not through ads, but by starting real LinkedIn conversations with the people who actually spec, quote, or buy what you make.

For one of our clients, that means around 400+ decision-makers reached per week and new opportunities popping up every few days. It''s all relationship-driven outreach, not spam.

We only work with one company per niche or service area to avoid overlap, so I wanted to reach out before we lock in for your region.

Would it make sense to grab 10 minutes this or next week to see if it could fill your calendar for Q1?

Best,
Lavonne
Vons Consulting','Worth a look before Q1 planning?','INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-ODQ4OGM4YWItYmE1My00Mjc5LTg2NWQtNWY0NzE3OWU2ZWI4XzEwMA==:20251102T04463:76a6aebf','2-ODQ4OGM4YWItYmE1My00Mjc5LTg2NWQtNWY0NzE3OWU2ZWI4XzEwMA==','2025-11-02T04:46:30+00','outbound','https://www.linkedin.com/in/tmacadamcatalina','Terry MacAdam','Thanks Terry!',NULL,'INBOX'),
('export:2-ODQ4OGM4YWItYmE1My00Mjc5LTg2NWQtNWY0NzE3OWU2ZWI4XzEwMA==:20251102T03530:eb71d013','2-ODQ4OGM4YWItYmE1My00Mjc5LTg2NWQtNWY0NzE3OWU2ZWI4XzEwMA==','2025-11-02T03:53:01+00','inbound','https://www.linkedin.com/in/tmacadamcatalina','Terry MacAdam','Happy birthday Sean',NULL,'INBOX'),
('export:2-M2YyMDBlNWMtMmZhOS00NzViLTkyMTAtNDA5MzJiMzNiMDVjXzEwMA==:20251101T17564:ec9b5090','2-M2YyMDBlNWMtMmZhOS00NzViLTkyMTAtNDA5MzJiMzNiMDVjXzEwMA==','2025-11-01T17:56:40+00','inbound','https://www.linkedin.com/in/toby-harper-ab9172133','Toby Harper','Hope you have a blessed day 🙏',NULL,'INBOX'),
('export:2-M2YyMDBlNWMtMmZhOS00NzViLTkyMTAtNDA5MzJiMzNiMDVjXzEwMA==:20251101T17563:50d24039','2-M2YyMDBlNWMtMmZhOS00NzViLTkyMTAtNDA5MzJiMzNiMDVjXzEwMA==','2025-11-01T17:56:30+00','inbound','https://www.linkedin.com/in/toby-harper-ab9172133','Toby Harper','You''re welcome, Sean',NULL,'INBOX'),
('export:2-M2YyMDBlNWMtMmZhOS00NzViLTkyMTAtNDA5MzJiMzNiMDVjXzEwMA==:20251101T16120:15d340fb','2-M2YyMDBlNWMtMmZhOS00NzViLTkyMTAtNDA5MzJiMzNiMDVjXzEwMA==','2025-11-01T16:12:07+00','outbound','https://www.linkedin.com/in/toby-harper-ab9172133','Toby Harper','Thank you Toby!',NULL,'INBOX'),
('export:2-M2YyMDBlNWMtMmZhOS00NzViLTkyMTAtNDA5MzJiMzNiMDVjXzEwMA==:20251101T15090:c0d16980','2-M2YyMDBlNWMtMmZhOS00NzViLTkyMTAtNDA5MzJiMzNiMDVjXzEwMA==','2025-11-01T15:09:08+00','inbound','https://www.linkedin.com/in/toby-harper-ab9172133','Toby Harper','Happy birthday!',NULL,'INBOX'),
('export:2-NTA0MzE0MGMtNTE0MS00MzJmLTg5MWUtNWRmZGU1NjljNGUyXzEwMA==:20251101T17301:ca2cf0b3','2-NTA0MzE0MGMtNTE0MS00MzJmLTg5MWUtNWRmZGU1NjljNGUyXzEwMA==','2025-11-01T17:30:16+00','inbound','https://www.linkedin.com/in/justin-wilmoth-aa5b0332','justin wilmoth','Wishing you a very happy birthday!',NULL,'INBOX'),
('export:2-NTA0MzE0MGMtNTE0MS00MzJmLTg5MWUtNWRmZGU1NjljNGUyXzEwMA==:20250719T10133:6bcd6592','2-NTA0MzE0MGMtNTE0MS00MzJmLTg5MWUtNWRmZGU1NjljNGUyXzEwMA==','2025-07-19T10:13:34+00','inbound','https://www.linkedin.com/in/justin-wilmoth-aa5b0332','justin wilmoth','Sorry but I just fix airplanes ✈️.',NULL,'INBOX'),
('export:2-NTA0MzE0MGMtNTE0MS00MzJmLTg5MWUtNWRmZGU1NjljNGUyXzEwMA==:20250719T10130:32710693','2-NTA0MzE0MGMtNTE0MS00MzJmLTg5MWUtNWRmZGU1NjljNGUyXzEwMA==','2025-07-19T10:13:03+00','inbound','https://www.linkedin.com/in/justin-wilmoth-aa5b0332','justin wilmoth','Hello, Sean',NULL,'INBOX'),
('export:2-NTA0MzE0MGMtNTE0MS00MzJmLTg5MWUtNWRmZGU1NjljNGUyXzEwMA==:20250719T10114:4f073e83','2-NTA0MzE0MGMtNTE0MS00MzJmLTg5MWUtNWRmZGU1NjljNGUyXzEwMA==','2025-07-19T10:11:41+00','outbound','https://www.linkedin.com/in/justin-wilmoth-aa5b0332','justin wilmoth','Hi Justin, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-ZjU5MmViMzgtMjYxMy00MTAzLWI3MmYtZDBjOTk4M2U2ZDBhXzAxMA==:20251101T14502:be43523d','2-ZjU5MmViMzgtMjYxMy00MTAzLWI3MmYtZDBjOTk4M2U2ZDBhXzAxMA==','2025-11-01T14:50:27+00','outbound','https://www.linkedin.com/in/troy-l-mccullum-2235001b0','Troy L. McCullum','Thank you Troy!',NULL,'INBOX'),
('export:2-ZjU5MmViMzgtMjYxMy00MTAzLWI3MmYtZDBjOTk4M2U2ZDBhXzAxMA==:20251101T10252:c0d16980','2-ZjU5MmViMzgtMjYxMy00MTAzLWI3MmYtZDBjOTk4M2U2ZDBhXzAxMA==','2025-11-01T10:25:28+00','inbound','https://www.linkedin.com/in/troy-l-mccullum-2235001b0','Troy L. McCullum','Happy birthday!',NULL,'INBOX'),
('export:2-ZjU5MmViMzgtMjYxMy00MTAzLWI3MmYtZDBjOTk4M2U2ZDBhXzAxMA==:20240112T22465:e353569a','2-ZjU5MmViMzgtMjYxMy00MTAzLWI3MmYtZDBjOTk4M2U2ZDBhXzAxMA==','2024-01-12T22:46:52+00','outbound','https://www.linkedin.com/in/troy-l-mccullum-2235001b0','Troy L. McCullum','Hi Troy! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-NWNjNTgyMmItNDQyNC00YWNmLTljNWQtMTM5ZTVlNzI5OTM2XzEwMA==:20251101T14300:4a30bf9c','2-NWNjNTgyMmItNDQyNC00YWNmLTljNWQtMTM5ZTVlNzI5OTM2XzEwMA==','2025-11-01T14:30:08+00','inbound','https://www.linkedin.com/in/advanced-aircraft-research-a-222689174','Advanced Aircraft Research Aircraft','Wishing you a very happy birthday!🎁',NULL,'INBOX'),
('export:2-NmVlMzAzNjQtYmQ2MS00OTUyLTgxMTktOTc1YThmNWJmYmYyXzEwMA==:20251024T10445:ddfec528','2-NmVlMzAzNjQtYmQ2MS00OTUyLTgxMTktOTc1YThmNWJmYmYyXzEwMA==','2025-10-24T10:44:55+00','outbound','https://www.linkedin.com/in/chris-s-193081188','Chris Smith','Hi Chris, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20251007T02563:b411e941','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-10-07T02:56:30+00','outbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Hi Chris,

Just checking in to see if you or your team had any feedback on the phenolic scrapers. I sent over the pricing and lead time info by email a while back — just wanted to make sure it came through in case it got buried.

If there''s any interest or questions I can help with, I''d love to support your team. Thanks again!',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250905T15263:b48718df','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-09-05T15:26:37+00','outbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Good morning Chris. I just wanted to follow up and make sure you received the pricing email I sent last week. I''d love to hear if your team had any initial feedback on the samples, or if you had any questions I can help with. Appreciate the opportunity — feel free to reach out anytime. Thank you!',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250828T19271:d1b7768f','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-08-28T19:27:17+00','outbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Hi Chris,

I just sent over the pricing and lead time details via email along with a formal quote PDF. Please feel free to reach out if you have any questions or if there''s anything else I can provide. Thanks again!',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250828T18421:80cb36ab','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-08-28T18:42:18+00','outbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Hi Chris,

That''s great to hear — I really appreciate you sharing the samples with your team and I''m glad there''s excitement around them!

At the moment, the two models you received (6" and 11") are the only sizes I currently manufacture. They were originally developed based on input from rivet and sealant removal techs, which is why they''re sized for those tasks and compatible with gun handles.

I don''t currently offer handheld-specific models, but I''ve received similar feedback and am actively exploring new shapes and grip options that would better suit handheld usage. If your team has any input on ideal length, shape, or use cases for handheld tools, I''d be grateful to hear it — I''d love to develop something purpose-built for your needs.

In the meantime, I''ll send pricing and lead time details to your email shortly. Thank you again for the opportunity!',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250828T18130:f9ae5201','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-08-28T18:13:00+00','inbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Can you please email pricing and lead times? Christopher.pratt@alaskaair.com',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250828T18122:2c6a9bc0','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-08-28T18:12:24+00','inbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','do you have any models for handheld usage? Do you have any handheld models?',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250828T18114:c0d4c00b','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-08-28T18:11:49+00','inbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Hello!

The package arrived and I have sent the samples out for use and eval. Folks are pretty excited about them. Rivet gun/handle models are great though are much more commonly used in MROs',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250827T02160:96909b8f','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-08-27T02:16:07+00','outbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Hi Chris,

Just wanted to check in and make sure the package of phenolic scraper samples made it to you okay — I saw it was delivered Saturday the 16th.

I''d love to hear any feedback you or your team may have after trying them out, and I''m happy to answer any questions that come up.

Thanks again for the opportunity!',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250814T19415:6a38447a','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-08-14T19:41:55+00','outbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','You''re welcome. Thank you for the opportunity! Looking forward to hearing your feedback. Please don''t hesitate to reach out with any questions. Thank you Chris!',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250814T18480:66315d36','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-08-14T18:48:07+00','inbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Thank you!! I''m looking forward to seeing them.',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250814T13254:8418e700','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-08-14T13:25:41+00','outbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Good morning Chris,

Just a quick note to let you know the phenolic scraper samples are going out today via UPS Ground. They''re packed in one box, and the tracking number is: 1Z0592W00340722573.

Thanks again for the opportunity — looking forward to hearing what you and your team think once you''ve had a chance to try them out. Thank you.',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250813T01213:0d127596','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-08-13T01:21:36+00','outbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Hi Chris,

That''s great to hear — thank you! I''ll ship out two samples of each size (6" and 11") to the Tacoma address tomorrow. I really appreciate you sharing them with your mx peers, and I''d love to hear any feedback you all have once you''ve had a chance to try them out.

I''ll send over tracking once they''re on the way. Thanks again for the opportunity!',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250812T22575:6dbb3750','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-08-12T22:57:59+00','inbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Sean, 

Thanks for the reminder, I would love to see some samples
Can you send them to 

Chris Pratt
821 N Steele St
Tacoma, WA
98406

I''ll be glad to share them with my mx peers and get you some feedback

Thanks!',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250729T01002:071487b1','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-07-29T01:00:25+00','outbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Hi Christopher,

Just wanted to follow up on my note from last week. I''d still be happy to send over a few sample scrapers for your evaluation if you''re interested. No pressure at all — just let me know what works best for you.

Appreciate your time either way! Thank you.',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250722T20121:48ed3239','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-07-22T20:12:11+00','outbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Hi Christopher,

Thanks for getting back to me — I appreciate your interest. I understand you''re not involved in consumable tooling, and that''s totally fine. If you''re open to it, I''d be glad to send you a few of our phenolic scraper samples for your own evaluation.

They''re strong, non-marring, and have become a go-to tool for MRO teams looking for a better option than plastic or Delrin. If you find them useful, I''d really appreciate it if you''d consider passing my info along internally or letting me know the best way to get plugged in at Alaska.

Just let me know the best address, and I''ll get the samples on their way. Thanks again!',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250722T19164:d307569c','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-07-22T19:16:41+00','inbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','thanks for reaching out. I am not involved in consumable tooling. I am interested in your product though. Phenolic sounds better than plastic or delrin.',NULL,'INBOX'),
('export:2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==:20250722T19152:77488a84','2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','2025-07-22T19:15:29+00','outbound','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','Hi Christopher, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02560:d254c4b1','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:56:01+00','inbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','Im familiar with the Lufthansa, most of our tools is source out especially if it was call out in the manual. We still get the Snap on and bluepoint brands',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02503:e88a10cd','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:50:31+00','outbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','That''s great — sounds like you''ve got a unique setup, being able to stay involved both in training and on the shop floor. That''s the best of both worlds.

I''m always curious to hear what kind of hand tools or consumables techs in your region prefer for composite work. Are most of them still sourcing through local distributors, or do you see them bringing in U.S.-made products at all?',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02424:733d06ef','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:42:41+00','inbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','Im currently full time with Heatcon. Im assigned at Asia Pacific so i do rounds on shop floors. Im also still a part time instructor at Lufthansa Technical Training Philippines, and that''s the reason why I can still go in the Hangar and shop floor.',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02392:7e570e5b','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:39:26+00','outbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','That makes sense — the rounded metal edges probably help reduce the risk of damage, but phenolic definitely hits a nice balance between strength and surface safety.

Do you still spend much time in the hangar these days, or is your work mostly on the training and sales side now?',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02370:0636b3f1','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:37:07+00','inbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','But the Phenolic scraper for sure will be good.',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02361:0b02dc2a','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:36:17+00','inbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','This is the currently being used and utilized here in Lufthansa. Those edges are rounded corners. It''s an approved tool and still no damage during usage',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02321:59cf2796','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:32:14+00','outbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','I can see how that metal scraper would be sturdy, but it seems like it could easily scratch or gouge aluminum or composite surfaces if you''re not careful. Did you ever see any damage or surface issues from using those?

Phenolic was developed as a middle ground for that reason, strong enough to remove cured material but still soft enough not to harm the substrate.',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02232:d7d897ef','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:23:28+00','inbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','I still have access to lufthansa hangar, and this is the one they are using',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02225:da39a3ee','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:22:59+00','inbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02225:5f063823','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:22:50+00','inbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','The only thing that i saw these past few years is this metal scraper',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02220:950b035c','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:22:07+00','inbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','During my time, we only used the plastic scrapres which is not sturdy enough. That''s thr only available in the tool store. That''s why i became interested in your phenolic scraper',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02192:c84ce962','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:19:22+00','outbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','That''s interesting, I only sell here in the U.S. right now, so I''m not sure how much they''ve made their way into Asia yet. I''m curious though, when you were working as a structures and composite mechanic, did you ever use phenolic scrapers or anything similar? Do shops over there typically use plastic, or do you see other materials being used?',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02152:26f05016','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:15:29+00','inbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','Yes nice, i was an structures and composite mechanic before and i know this frustrations. I havent seen this in Asia and at least at Lufthansa Technik Philippines. How''s the penetration of that in Asia?',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02095:265c1ea9','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:09:59+00','outbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','Good question, most technicians who switch from plastic to phenolic never go back. Phenolic scrapers hold a sharper edge much longer, so they last several times longer than plastic and can handle tougher cured sealant or adhesive without gouging surfaces.',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T02004:9257c038','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T02:00:49+00','inbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','saw it, what''s the ratio of using it compare to plastic scrapers?',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T01592:684f1c78','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T01:59:26+00','outbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','Yes they look just like that',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T01570:da39a3ee','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T01:57:03+00','inbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T01541:6a6469f6','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T01:54:10+00','inbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','Yes Sean, im from the Philippines and assigned in Asia Pacific. What''s your phenolic scrapers looks like? Can in handle metal?',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T01522:037e49c2','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T01:52:21+00','outbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','Thanks, Mark — great to connect! I saw you''re involved in composite repair and training, and that caught my attention since I manufacture phenolic scrapers here in California that are used in aircraft maintenance across the U.S. Always good to connect with others in the aviation maintenance space and learn how things are done in different regions.',NULL,'INBOX'),
('export:2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==:20251007T01422:934cb313','2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','2025-10-07T01:42:24+00','inbound','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','Thanks for connecting Sean; looking forward to following you, your future posts, and future engagement or collaboration, maybe.',NULL,'INBOX'),
('export:2-MWNiMWM4MzktZWI2OS00NzhlLThkMjctNmFlMzZhNWMzNDk3XzEwMA==:20250901T01423:6951fde0','2-MWNiMWM4MzktZWI2OS00NzhlLThkMjctNmFlMzZhNWMzNDk3XzEwMA==','2025-09-01T01:42:36+00','outbound','https://www.linkedin.com/in/jeff-carson-34272b6a','Jeff Carson','Hi Jeff, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-ZDhiZmJiMzgtZTdjNC00MzcxLTkwODItZDgyZmJkYTc2OTBjXzEwMA==:20250820T15140:e9c650cd','2-ZDhiZmJiMzgtZTdjNC00MzcxLTkwODItZDgyZmJkYTc2OTBjXzEwMA==','2025-08-20T15:14:01+00','outbound','https://www.linkedin.com/in/charles-walrod-52610563','Charles Walrod','Hi Chucky, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-NWVmMzk3MDMtOTgxYi00MDIzLTg0YWMtMzIwZGNlMDQyOTkwXzEwMA==:20250819T14371:69331174','2-NWVmMzk3MDMtOTgxYi00MDIzLTg0YWMtMzIwZGNlMDQyOTkwXzEwMA==','2025-08-19T14:37:17+00','outbound','https://www.linkedin.com/in/john-simon-405189153','John Simon','Hi John, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-ODFiMmEyNmQtZDZjYi00NGIwLTliZjAtZmM2OGQyMjdlZmU4XzEwMA==:20250818T09392:caf8979d','2-ODFiMmEyNmQtZDZjYi00NGIwLTliZjAtZmM2OGQyMjdlZmU4XzEwMA==','2025-08-18T09:39:22+00','outbound','https://www.linkedin.com/in/todd-hattaway-aviation-mgmt','Todd Hattaway','Hi Todd, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==:20250807T18514:6f25961d','2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==','2025-08-07T18:51:48+00','inbound','https://www.linkedin.com/in/randy-wirkkala-6b037042','Randy Wirkkala','Thanks Sean, I appreciate that. Thanks for the connection.',NULL,'INBOX'),
('export:2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==:20250806T16185:10a9c63f','2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==','2025-08-06T16:18:51+00','outbound','https://www.linkedin.com/in/randy-wirkkala-6b037042','Randy Wirkkala','Hi Randy,

Thanks so much for getting back to me — I really appreciate the thoughtful response and the detail you provided. Totally understand that your team''s work calls for smaller tip scrapers and that the need may not come up regularly in your operation.

If an opportunity does come up where the scrapers are a good fit, I''d be glad to support however I can. In the meantime, I truly appreciate the chance to connect and share what we make.

Wishing you and your team all the best — and thanks again for the opportunity.',NULL,'INBOX'),
('export:2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==:20250806T14581:fd7563da','2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==','2025-08-06T14:58:17+00','inbound','https://www.linkedin.com/in/randy-wirkkala-6b037042','Randy Wirkkala','Hi Sean,

We did receive the scrapers but have not had a chance to use them. The size and shape is not typical of the style we use as they are pretty wide and our usage is on thin line areas between panels or cleanup on fayed surfaces with small tip scrapers.

This isn''t a question on the quality of the scraper, but it seems they aren''t quite the style we would use regularly and it might be a while before we have a requirement that they can be used.

I appreciate you sending the samples, but i don''t think we can go into a replacement of current supplies at this time. I think it might also be that our operation isn''t that of large aircraft heavy MRO operations, but a small repair facility maintaining aircraft below heavy checks.

I wish you best success finding new clients!

Best regards,

Randy',NULL,'INBOX'),
('export:2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==:20250805T23475:7c053c2f','2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==','2025-08-05T23:47:54+00','outbound','https://www.linkedin.com/in/randy-wirkkala-6b037042','Randy Wirkkala','Hi Randy,

Hope you''re doing well. I just wanted to check in and see if you or your team have had a chance to try out the scrapers yet — I''d love to hear any feedback you might have.

I also heard from Scott Whittemore in Purchasing last week and sent over pricing on Friday, but I haven''t heard anything back just yet, so I figured I''d check in with you directly.

Appreciate the opportunity and would love to earn your business if there''s interest. Thank you.',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==:20250730T01010:485bf8fb','2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==','2025-07-30T01:01:04+00','outbound','https://www.linkedin.com/in/randy-wirkkala-6b037042','Randy Wirkkala','Looking forward to it. Thank you Randy, same to you!',NULL,'INBOX'),
('export:2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==:20250730T00203:433b1de5','2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==','2025-07-30T00:20:34+00','inbound','https://www.linkedin.com/in/randy-wirkkala-6b037042','Randy Wirkkala','Thank you Sean. 

I''ll look out for them and let you know what my team comes up with. 

Have a great afternoon.',NULL,'INBOX'),
('export:2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==:20250729T23115:6c69a7c5','2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==','2025-07-29T23:11:58+00','outbound','https://www.linkedin.com/in/randy-wirkkala-6b037042','Randy Wirkkala','Hi Randy,

Just wanted to let you know the samples went out this afternoon via UPS Ground. Here''s the tracking number: 1Z0592W00340678167.

I''m looking forward to your team''s feedback and the opportunity to earn your business. Thank you!',NULL,'INBOX'),
('export:2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==:20250729T00573:615b74dc','2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==','2025-07-29T00:57:30+00','outbound','https://www.linkedin.com/in/randy-wirkkala-6b037042','Randy Wirkkala','Hi Randy,

Apologies for the delay getting back to you, I was out of town over the weekend. I hope you had a great one as well!

Thanks again for the opportunity. We make our phenolic scrapers in two sizes: a 6" short version and an 11" long version, and I''ll be sending two samples of each to your attention tomorrow via UPS. I''ll follow up with the tracking number once the package is on its way.

I''m looking forward to hearing your team''s feedback and would love to earn your business. Thank you for the opportunity!',NULL,'INBOX'),
('export:2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==:20250726T19200:b8166b73','2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==','2025-07-26T19:20:00+00','inbound','https://www.linkedin.com/in/randy-wirkkala-6b037042','Randy Wirkkala','Hi Sean,

Thanks for reaching out, I''m sure my folks wouldn''t mind trying a couple samples for comparison. If you could, please send pricing info as well. Our address is 

Global Aviation, Inc. 
2250 NE 25th Ave 
Hillsboro, OR 97124

Appreciate the offer. Have a great weekend. 

Randy',NULL,'INBOX'),
('export:2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==:20250715T00473:129ee811','2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==','2025-07-15T00:47:31+00','outbound','https://www.linkedin.com/in/randy-wirkkala-6b037042','Randy Wirkkala','Hi Randy,
Thanks for connecting. Just wanted to follow up in case my earlier message got buried — if phenolic scrapers are something your team uses or keeps on hand, I''d be happy to send a few samples your way.

No pressure at all — feel free to let me know if you''re the right person for this or if there''s someone else I should reach out to. Thank you.',NULL,'INBOX'),
('export:2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==:20250706T00422:f64507c8','2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==','2025-07-06T00:42:20+00','outbound','https://www.linkedin.com/in/randy-wirkkala-6b037042','Randy Wirkkala','Hi Randy, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-YTBiODNjMTYtZGUyMS00M2UxLWI0ZDEtNGVjZGZjMzk2NGNlXzEwMA==:20250801T19592:412476dc','2-YTBiODNjMTYtZGUyMS00M2UxLWI0ZDEtNGVjZGZjMzk2NGNlXzEwMA==','2025-08-01T19:59:24+00','outbound','https://www.linkedin.com/in/scott-coryea','Scott Coryea','Hi Scott, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-YTJhMjFkOGEtZTAxZi00ZGJlLWI1YjktMmViOTA3ZDQzMjI0XzEwMA==:20250730T04231:5e9d00e2','2-YTJhMjFkOGEtZTAxZi00ZGJlLWI1YjktMmViOTA3ZDQzMjI0XzEwMA==','2025-07-30T04:23:14+00','outbound','https://www.linkedin.com/in/ernesto-rodriguez-4693a4103','Ernesto Rodriguez','Hi Ernesto, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-NmNmZWY5NTYtMGJhMC00ODdiLTlmMGUtNDIyMzE4YWM2ZjkxXzEwMA==:20250729T01153:2df870f4','2-NmNmZWY5NTYtMGJhMC00ODdiLTlmMGUtNDIyMzE4YWM2ZjkxXzEwMA==','2025-07-29T01:15:34+00','outbound','https://www.linkedin.com/in/kevinedwardcox','Kevin Cox','Hi Kevin, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-Yzk2ZTdhYzMtZTlmOC00MzI0LTgwOTYtYTY4OTllNjI3NjZlXzEwMA==:20250725T11474:9d39f81f','2-Yzk2ZTdhYzMtZTlmOC00MzI0LTgwOTYtYTY4OTllNjI3NjZlXzEwMA==','2025-07-25T11:47:48+00','outbound','https://www.linkedin.com/in/erica-hernandez-9bb9b0136','Erica Hernandez','Hi Erica, I''d like to connect and introduce Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-MGRlNDg0MmEtNzgxZC00NTQ5LTgxYTEtNTgxNDQ5ZDEyZGRkXzEwMA==:20250722T13155:78299754','2-MGRlNDg0MmEtNzgxZC00NTQ5LTgxYTEtNTgxNDQ5ZDEyZGRkXzEwMA==','2025-07-22T13:15:58+00','outbound','https://www.linkedin.com/in/rick-tinker-18570a159','Rick Tinker','Hi Rick, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-ZjJkNjc1NmItOGQzMC00ZTdlLTkzNDMtMjlhZGQ0YTdjMTBiXzEwMA==:20250717T02375:0c999d5f','2-ZjJkNjc1NmItOGQzMC00ZTdlLTkzNDMtMjlhZGQ0YTdjMTBiXzEwMA==','2025-07-17T02:37:59+00','outbound','https://www.linkedin.com/in/gustavo-escobedo-morales-555ab5186','Gustavo Escobedo-Morales','Hi Gustavo, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-Y2E0MDAwNTUtMWU0Mi00NzhiLTg4ZmUtMDQ2NjJjZGQ3MDRlXzEwMA==:20250715T14583:b3d1996d','2-Y2E0MDAwNTUtMWU0Mi00NzhiLTg4ZmUtMDQ2NjJjZGQ3MDRlXzEwMA==','2025-07-15T14:58:31+00','outbound','https://www.linkedin.com/in/thomas-barton-35a7976a','Thomas Barton','Hi Thomas, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-ZTk5NzI5NDEtNjBjOS00ODQ0LTkyYzktODVkNzgwNmU3YTQzXzEwMA==:20250715T12462:2f50a541','2-ZTk5NzI5NDEtNjBjOS00ODQ0LTkyYzktODVkNzgwNmU3YTQzXzEwMA==','2025-07-15T12:46:24+00','outbound','https://www.linkedin.com/in/michael-stephenson-326212141','Michael Stephenson','Hi Michael, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-ZDAyODYwNWEtZjllYS00NTc2LThlZjctNjQ4MjViYWMyMDYzXzEwMA==:20250715T12061:ca092f85','2-ZDAyODYwNWEtZjllYS00NTc2LThlZjctNjQ4MjViYWMyMDYzXzEwMA==','2025-07-15T12:06:15+00','outbound','https://www.linkedin.com/in/lazaro-lopez-834172284','Lazaro Lopez','Hi Lazaro, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-N2JmNGU2OTAtNmU4NC00ZTdjLThlNDYtMDkxNjUyODhmNDM0XzEwMA==:20250715T00482:2fa47e4b','2-N2JmNGU2OTAtNmU4NC00ZTdjLThlNDYtMDkxNjUyODhmNDM0XzEwMA==','2025-07-15T00:48:29+00','outbound','https://www.linkedin.com/in/aaron-bankston-0574a4179','Aaron Bankston','Hi Aaron,
Thanks for connecting. Just wanted to follow up in case my earlier message got buried — if phenolic scrapers are something your team uses or keeps on hand, I''d be happy to send a few samples your way.

No pressure at all — feel free to let me know if you''re the right person for this or if there''s someone else I should reach out to. Thank you.',NULL,'INBOX'),
('export:2-N2JmNGU2OTAtNmU4NC00ZTdjLThlNDYtMDkxNjUyODhmNDM0XzEwMA==:20250630T20222:0ed5227f','2-N2JmNGU2OTAtNmU4NC00ZTdjLThlNDYtMDkxNjUyODhmNDM0XzEwMA==','2025-06-30T20:22:24+00','outbound','https://www.linkedin.com/in/aaron-bankston-0574a4179','Aaron Bankston','Hi Aaron, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-NTZkZTcwYzgtZDQzMy00ZWFiLWE2MmEtZDcxN2VmZTNmNjM3XzEwMA==:20250715T00481:829e20f1','2-NTZkZTcwYzgtZDQzMy00ZWFiLWE2MmEtZDcxN2VmZTNmNjM3XzEwMA==','2025-07-15T00:48:14+00','outbound','https://www.linkedin.com/in/michael-lavin-01788469','Michael Lavin','Hi Michael,
Thanks for connecting. Just wanted to follow up in case my earlier message got buried — if phenolic scrapers are something your team uses or keeps on hand, I''d be happy to send a few samples your way.

No pressure at all — feel free to let me know if you''re the right person for this or if there''s someone else I should reach out to. Thank you.',NULL,'INBOX'),
('export:2-NTZkZTcwYzgtZDQzMy00ZWFiLWE2MmEtZDcxN2VmZTNmNjM3XzEwMA==:20250701T20032:2f50a541','2-NTZkZTcwYzgtZDQzMy00ZWFiLWE2MmEtZDcxN2VmZTNmNjM3XzEwMA==','2025-07-01T20:03:24+00','outbound','https://www.linkedin.com/in/michael-lavin-01788469','Michael Lavin','Hi Michael, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-ZWQ4YThkMGUtNmJlYy00YmNjLTgzYmUtZjJkNTg1YmJiODVjXzEwMA==:20250715T00475:1cc2b296','2-ZWQ4YThkMGUtNmJlYy00YmNjLTgzYmUtZjJkNTg1YmJiODVjXzEwMA==','2025-07-15T00:47:50+00','outbound','https://www.linkedin.com/in/ruben-vega-murillo-5816832b','Ruben Vega-Murillo','Hi Ruben,
Thanks for connecting. Just wanted to follow up in case my earlier message got buried — if phenolic scrapers are something your team uses or keeps on hand, I''d be happy to send a few samples your way.

No pressure at all — feel free to let me know if you''re the right person for this or if there''s someone else I should reach out to. Thank you.',NULL,'INBOX'),
('export:2-ZWQ4YThkMGUtNmJlYy00YmNjLTgzYmUtZjJkNTg1YmJiODVjXzEwMA==:20250704T07463:3dbaa6c5','2-ZWQ4YThkMGUtNmJlYy00YmNjLTgzYmUtZjJkNTg1YmJiODVjXzEwMA==','2025-07-04T07:46:32+00','outbound','https://www.linkedin.com/in/ruben-vega-murillo-5816832b','Ruben Vega-Murillo','Hi Ruben, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-NWMzYTVlMjUtMTkxNy00YzhlLTg0YWEtMWEwMTE5YTM5ODQwXzEwMA==:20250715T00470:851a36a6','2-NWMzYTVlMjUtMTkxNy00YzhlLTg0YWEtMWEwMTE5YTM5ODQwXzEwMA==','2025-07-15T00:47:08+00','outbound','https://www.linkedin.com/in/philip-rhodes-1b903b8','Philip Rhodes','Hi Philip,
Thanks for connecting. Just wanted to follow up in case my earlier message got buried — if phenolic scrapers are something your team uses or keeps on hand, I''d be happy to send a few samples your way.

No pressure at all — feel free to let me know if you''re the right person for this or if there''s someone else I should reach out to. Thank you.',NULL,'INBOX'),
('export:2-NWMzYTVlMjUtMTkxNy00YzhlLTg0YWEtMWEwMTE5YTM5ODQwXzEwMA==:20250708T02175:921c0144','2-NWMzYTVlMjUtMTkxNy00YzhlLTg0YWEtMWEwMTE5YTM5ODQwXzEwMA==','2025-07-08T02:17:59+00','outbound','https://www.linkedin.com/in/philip-rhodes-1b903b8','Philip Rhodes','Hi Philip, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-MDUxMTA2MzUtNDk3Yy00ZDY5LWFhZTAtYmRkNTQ5Zjc0MGQ1XzEwMA==:20250715T00464:be8eaa96','2-MDUxMTA2MzUtNDk3Yy00ZDY5LWFhZTAtYmRkNTQ5Zjc0MGQ1XzEwMA==','2025-07-15T00:46:41+00','outbound','https://www.linkedin.com/in/bill-denny','Bill Denny','Hi Bill,
Thanks for connecting. Just wanted to follow up in case my earlier message got buried — if phenolic scrapers are something your team uses or keeps on hand, I''d be happy to send a few samples your way.

No pressure at all — feel free to let me know if you''re the right person for this or if there''s someone else I should reach out to. Thank you.',NULL,'INBOX'),
('export:2-MDUxMTA2MzUtNDk3Yy00ZDY5LWFhZTAtYmRkNTQ5Zjc0MGQ1XzEwMA==:20250713T17152:7c4ec1c0','2-MDUxMTA2MzUtNDk3Yy00ZDY5LWFhZTAtYmRkNTQ5Zjc0MGQ1XzEwMA==','2025-07-13T17:15:25+00','outbound','https://www.linkedin.com/in/bill-denny','Bill Denny','Hi Bill, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-ZTBhNDQ3YTctODU4OC00ZmRjLTk0YWUtMjE1NzkzNjE1MmVmXzEwMA==:20250715T00422:f20f5ab9','2-ZTBhNDQ3YTctODU4OC00ZmRjLTk0YWUtMjE1NzkzNjE1MmVmXzEwMA==','2025-07-15T00:42:26+00','outbound','https://www.linkedin.com/in/tim-reaid-jr-832a5b2a3','Tim Reaid Jr','Thanks, Tim — appreciate the reply.
If anything ever changes or if you need phenolic scrapers in the future, feel free to reach out. Wishing you and your team smooth operations.',NULL,'INBOX'),
('export:2-ZTBhNDQ3YTctODU4OC00ZmRjLTk0YWUtMjE1NzkzNjE1MmVmXzEwMA==:20250708T01151:9deebdb1','2-ZTBhNDQ3YTctODU4OC00ZmRjLTk0YWUtMjE1NzkzNjE1MmVmXzEwMA==','2025-07-08T01:15:19+00','inbound','https://www.linkedin.com/in/tim-reaid-jr-832a5b2a3','Tim Reaid Jr','I have what i need currently.  Ty',NULL,'INBOX'),
('export:2-ZTBhNDQ3YTctODU4OC00ZmRjLTk0YWUtMjE1NzkzNjE1MmVmXzEwMA==:20250708T01061:3e167f04','2-ZTBhNDQ3YTctODU4OC00ZmRjLTk0YWUtMjE1NzkzNjE1MmVmXzEwMA==','2025-07-08T01:06:14+00','outbound','https://www.linkedin.com/in/tim-reaid-jr-832a5b2a3','Tim Reaid Jr','Hi Tim, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-YmVkZDhlZTMtMjk1Ni00ZjVhLTg1NzYtNGE4MmRjMjdmMTA2XzEwMA==:20250715T00271:f972067a','2-YmVkZDhlZTMtMjk1Ni00ZjVhLTg1NzYtNGE4MmRjMjdmMTA2XzEwMA==','2025-07-15T00:27:14+00','outbound','https://www.linkedin.com/in/daniel-clark-874231a8','Daniel Clark','Hello Daniel,

Thank you for connecting with me.  I wanted to quickly introduce myself—I''m Sean Klein, and I manufacture USA-made phenolic scrapers that are widely used in aircraft maintenance. These tools have been trusted by major airline maintenance teams for years. 

Do you know if your team currently uses phenolic scrapers in any part of your maintenance work? I''d be happy to send over a few samples—no obligation—just a chance for your team to test them out. 

I personally handle the manufacturing, which means lead times are short, pricing stays consistent, and quality is tightly controlled—something that''s helped other MRO teams avoid delays and sourcing issues. 

You can take a look at our products at www.kleinmfgllc.com. 

Thank you for your time, I appreciate it.

Sean Klein
President
Klein Manufacturing, LLC
(916) 671-4772
sales@kleinmfgllc.com',NULL,'INBOX'),
('export:2-MzJiMDJjMTYtOWU1OC00Yzk3LThhNTctZmMwZTk3ODY1YjFmXzEwMA==:20250630T16092:5e698c93','2-MzJiMDJjMTYtOWU1OC00Yzk3LThhNTctZmMwZTk3ODY1YjFmXzEwMA==','2025-06-30T16:09:26+00','outbound','https://www.linkedin.com/in/christopher-redding-857772142','Christopher Redding','Hi Christopher, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-ZDEwOGQzNmQtYTc2Yy00OGQ3LTlmMzctNjUwMTM4MjhiYjA1XzEwMA==:20250630T14332:b9fa8e74','2-ZDEwOGQzNmQtYTc2Yy00OGQ3LTlmMzctNjUwMTM4MjhiYjA1XzEwMA==','2025-06-30T14:33:22+00','outbound','https://www.linkedin.com/in/alex-talarczyk','Alex Talarczyk','Hi Alex, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-NjRmNjkzOTYtZmEwNC00NDFhLWE3MmYtODcyNTVjODIwYjMwXzEwMA==:20250627T16141:2313987d','2-NjRmNjkzOTYtZmEwNC00NDFhLWE3MmYtODcyNTVjODIwYjMwXzEwMA==','2025-06-27T16:14:19+00','outbound','https://www.linkedin.com/in/brad-ongna-4b1a9430','Brad Ongna','Hi Brad, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.',NULL,'INBOX'),
('export:2-NDcyYTBlNmItYTEyMS00ZDdkLWE5YzgtMWI5Y2VmODQxM2E3XzEwMA==:20250625T12470:fef0a001','2-NDcyYTBlNmItYTEyMS00ZDdkLWE5YzgtMWI5Y2VmODQxM2E3XzEwMA==','2025-06-25T12:47:00+00','outbound','https://www.linkedin.com/in/chip-bonner-5a2b662','Chip Bonner','Hi Chip, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-MGVhOTE4ZTYtMGUzYy00OTY4LWE0OTEtZTI4MmRjZmY4ZDU0XzEwMA==:20250624T18574:f06a3959','2-MGVhOTE4ZTYtMGUzYy00OTY4LWE0OTEtZTI4MmRjZmY4ZDU0XzEwMA==','2025-06-24T18:57:49+00','outbound','https://www.linkedin.com/in/nick-baker-a481a6a3','Nick Baker','Hi Nick, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-OWEyNjY2ZTUtNjQ3YS00ZGY4LTgwOTktZDQ5ZjQ2NTkzMzM1XzEwMA==:20250624T16303:06a217f5','2-OWEyNjY2ZTUtNjQ3YS00ZGY4LTgwOTktZDQ5ZjQ2NTkzMzM1XzEwMA==','2025-06-24T16:30:36+00','outbound','https://www.linkedin.com/in/adam-b-3a7a93247','Adam Barron','Hello Adam,

I wanted to quickly introduce myself—I''m Sean Klein, and I manufacture USA-made phenolic scrapers that are widely used in aircraft maintenance. These tools have been trusted by major airline maintenance teams for years.

Do you know if your team at ACI currently uses phenolic scrapers in any part of their maintenance work? I''d be happy to send over a few samples—no obligation—just a chance for your team to test them out.

I personally handle the manufacturing, which means lead times are short, pricing stays consistent, and quality is tightly controlled—something that''s helped other MRO teams avoid delays and sourcing issues.

You can take a look at our products at www.kleinmfgllc.com.

Thank you for your time, I appreciate it!',NULL,'INBOX'),
('export:2-YWM3MDMzOWQtNjM0ZS00NWU3LWFjZWEtNWY5YjVlY2ExZDcyXzEwMA==:20250624T16284:4a357b76','2-YWM3MDMzOWQtNjM0ZS00NWU3LWFjZWEtNWY5YjVlY2ExZDcyXzEwMA==','2025-06-24T16:28:41+00','outbound','https://www.linkedin.com/in/carl-yutrzenka','Carl Yutrzenka','Hello Carl,

Thank you for the connect request!  I wanted to quickly introduce myself—I''m Sean Klein, and I manufacture USA-made phenolic scrapers that are widely used in aircraft maintenance. These tools have been trusted by major airline maintenance teams for years.

Do you know if your team currently uses phenolic scrapers in any part of your maintenance work? I''d be happy to send over a few samples—no obligation—just a chance for your team to test them out
. 
I personally handle the manufacturing, which means lead times are short, pricing stays consistent, and quality is tightly controlled—something that''s helped other MRO teams avoid delays and sourcing issues
. 
You can take a look at our products at www.kleinmfgllc.com
. 
Thank you for your time, I appreciate it!',NULL,'INBOX'),
('export:2-NzEzNzYyZGUtNGE1Ny00Yjg0LTk1YmItZWI2NjliNmU2ZDE3XzAxMg==:20250603T03380:a67b3e96','2-NzEzNzYyZGUtNGE1Ny00Yjg0LTk1YmItZWI2NjliNmU2ZDE3XzAxMg==','2025-06-03T03:38:07+00','outbound','https://www.linkedin.com/in/calver-gallard-a57b7b191','Calver Gallard','Hi Calver, I just wanted to follow up and introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-NzEzNzYyZGUtNGE1Ny00Yjg0LTk1YmItZWI2NjliNmU2ZDE3XzAxMg==:20231126T17183:56c6afa2','2-NzEzNzYyZGUtNGE1Ny00Yjg0LTk1YmItZWI2NjliNmU2ZDE3XzAxMg==','2023-11-26T17:18:38+00','outbound','https://www.linkedin.com/in/calver-gallard-a57b7b191','Calver Gallard','Hi Calver, it''s nice to meet you. I wanted to introduce myself and my company, Klein Manufacturing LLC which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-NzEzNzYyZGUtNGE1Ny00Yjg0LTk1YmItZWI2NjliNmU2ZDE3XzAxMg==:20231126T00511:2362781c','2-NzEzNzYyZGUtNGE1Ny00Yjg0LTk1YmItZWI2NjliNmU2ZDE3XzAxMg==','2023-11-26T00:51:13+00','outbound','https://www.linkedin.com/in/calver-gallard-a57b7b191','Calver Gallard','Hello Calver, my name is Sean Klein and I''d like to introduce my company Klein Manufacturing LLC.  We specialize in producing high quality phenolic scrapers in the USA for aircraft maintenance. I''d like to discuss how our scrapers could assist your aircraft maintenance operations.',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-YTI1ODQ4YzctODBiMS00NzZmLTkzMjEtZjI0MTUxZTQ4NjJiXzEwMA==:20250603T02591:7eed2377','2-YTI1ODQ4YzctODBiMS00NzZmLTkzMjEtZjI0MTUxZTQ4NjJiXzEwMA==','2025-06-03T02:59:13+00','outbound','https://www.linkedin.com/in/richard-kovacs-451051358','Richard Kovacs','Hi Rich, just wanted to follow up and see if Ben had a chance to check out our phenolic scrapers or if there''s anything else I can provide to help. I''d be happy to send samples or product info if it''s helpful. Appreciate you passing my info along!',NULL,'INBOX'),
('export:2-YTI1ODQ4YzctODBiMS00NzZmLTkzMjEtZjI0MTUxZTQ4NjJiXzEwMA==:20250514T16163:58e7394d','2-YTI1ODQ4YzctODBiMS00NzZmLTkzMjEtZjI0MTUxZTQ4NjJiXzEwMA==','2025-05-14T16:16:30+00','outbound','https://www.linkedin.com/in/richard-kovacs-451051358','Richard Kovacs','Hi Rich, great to hear from you! Ben is welcome to contact me anytime at sales@kleinmfgllc.com or on my cell at 916-671-4772. I''d love the opportunity to work with your team and would be happy to send over some samples for you to put to the test. He can also check out our products at www.kleinmfgllc.com.  Thank you!',NULL,'INBOX'),
('export:2-YTI1ODQ4YzctODBiMS00NzZmLTkzMjEtZjI0MTUxZTQ4NjJiXzEwMA==:20250514T16065:d6b775df','2-YTI1ODQ4YzctODBiMS00NzZmLTkzMjEtZjI0MTUxZTQ4NjJiXzEwMA==','2025-05-14T16:06:52+00','inbound','https://www.linkedin.com/in/richard-kovacs-451051358','Richard Kovacs','How can he contact you?',NULL,'INBOX'),
('export:2-YTI1ODQ4YzctODBiMS00NzZmLTkzMjEtZjI0MTUxZTQ4NjJiXzEwMA==:20250514T16064:d6f8a715','2-YTI1ODQ4YzctODBiMS00NzZmLTkzMjEtZjI0MTUxZTQ4NjJiXzEwMA==','2025-05-14T16:06:45+00','inbound','https://www.linkedin.com/in/richard-kovacs-451051358','Richard Kovacs','I am not, but Ben is I will get your info over to him',NULL,'INBOX'),
('export:2-YTI1ODQ4YzctODBiMS00NzZmLTkzMjEtZjI0MTUxZTQ4NjJiXzEwMA==:20250512T23055:9d32f23f','2-YTI1ODQ4YzctODBiMS00NzZmLTkzMjEtZjI0MTUxZTQ4NjJiXzEwMA==','2025-05-12T23:05:59+00','outbound','https://www.linkedin.com/in/richard-kovacs-451051358','Richard Kovacs','Hi Rich, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-ZjZhOWFjZjktNGE5Mi00ZjRiLTlhMDgtZDEyOTdiMGI4MGFiXzEwMA==:20250515T14493:4341699b','2-ZjZhOWFjZjktNGE5Mi00ZjRiLTlhMDgtZDEyOTdiMGI4MGFiXzEwMA==','2025-05-15T14:49:30+00','outbound','https://www.linkedin.com/in/rob-cox-91004a70','Rob Cox','Hi Rob, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-YWZjMWYzMzYtYWEyYi00ODJmLWFmZGItZDJiZDZhYzBkMWQxXzEwMA==:20250514T20302:662acd7d','2-YWZjMWYzMzYtYWEyYi00ODJmLWFmZGItZDJiZDZhYzBkMWQxXzEwMA==','2025-05-14T20:30:26+00','outbound','https://www.linkedin.com/in/richard-martínez-b87683171','Richard Martínez','Hi Richard, I''m Sean with Klein Manufacturing. We produce heavy-duty phenolic scrapers proudly made in the USA—ideal for aircraft sealant removal and surface prep. I''d love to connect and see if you''re involved in sourcing MRO tools or open to reviewing a few free samples.  Thank you.',NULL,'INBOX'),
('export:2-OTcwMTZlOTktZTc5Zi00MTRmLTkxYzMtYzYyYmExMmY2OTgwXzAxMg==:20250514T19413:1cd52a38','2-OTcwMTZlOTktZTc5Zi00MTRmLTkxYzMtYzYyYmExMmY2OTgwXzAxMg==','2025-05-14T19:41:32+00','outbound','https://www.linkedin.com/in/steve-trent-1ba0b1ba','Steve Trent','Hi Steve, just following up on my previous message. We manufacture heavy-duty phenolic scrapers here in the U.S. for aircraft maintenance — commonly used for sealant removal and surface prep. I''d be happy to send over a few samples for your team to check out. You can also find us online at kleinmfgllc.com. Please let me know if you''d be interested. Thank you.',NULL,'INBOX'),
('export:2-OTcwMTZlOTktZTc5Zi00MTRmLTkxYzMtYzYyYmExMmY2OTgwXzAxMg==:20240119T00231:f979aa66','2-OTcwMTZlOTktZTc5Zi00MTRmLTkxYzMtYzYyYmExMmY2OTgwXzAxMg==','2024-01-19T00:23:18+00','outbound','https://www.linkedin.com/in/steve-trent-1ba0b1ba','Steve Trent','Hi 
Hi Steve! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-ZjhmZmZiODctMmM2OS00OWVhLWFmZDEtOTliNjU1MzQ0ZTEzXzAxMA==:20250513T13483:42cefeed','2-ZjhmZmZiODctMmM2OS00OWVhLWFmZDEtOTliNjU1MzQ0ZTEzXzAxMA==','2025-05-13T13:48:30+00','outbound','https://www.linkedin.com/in/chris-corrington-b173a920','Chris Corrington','Hi Chris, just following up on my message from last year. I wanted to reintroduce myself and my company, Klein Manufacturing—we make phenolic scrapers used in exterior aircraft maintenance. If your team uses anything similar, I''d love to send over a few samples for you to check out. You can also see more about what we make at www.kleinmfgllc.com. Thanks for your time.',NULL,'INBOX'),
('export:2-ZjhmZmZiODctMmM2OS00OWVhLWFmZDEtOTliNjU1MzQ0ZTEzXzAxMA==:20240501T22222:020e7d4c','2-ZjhmZmZiODctMmM2OS00OWVhLWFmZDEtOTliNjU1MzQ0ZTEzXzAxMA==','2024-05-01T22:22:26+00','outbound','https://www.linkedin.com/in/chris-corrington-b173a920','Chris Corrington','Hi Chris! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YmM4ZTg0NWItYTMxNi00ZjA0LWJkOWMtZWMwNjY5MzA1MmEzXzAxMA==:20250513T02403:4cc7a0af','2-YmM4ZTg0NWItYTMxNi00ZjA0LWJkOWMtZWMwNjY5MzA1MmEzXzAxMA==','2025-05-13T02:40:39+00','outbound','https://www.linkedin.com/in/anthony-johnson-32881b227','Anthony Johnson','Hi Anthony,

Just following up on my message from last summer. I''d still love to send over a few phenolic scraper samples for your team to check out if you''re using anything similar in your maintenance work. All of our products are proudly made in the U.S., and we''ve had great feedback from other aviation maintenance teams. Let me know if you''re open to it—no pressure at all if now''s not the right time. Thank you.',NULL,'INBOX'),
('export:2-YmM4ZTg0NWItYTMxNi00ZjA0LWJkOWMtZWMwNjY5MzA1MmEzXzAxMA==:20240611T18462:b16416a7','2-YmM4ZTg0NWItYTMxNi00ZjA0LWJkOWMtZWMwNjY5MzA1MmEzXzAxMA==','2024-06-11T18:46:25+00','outbound','https://www.linkedin.com/in/anthony-johnson-32881b227','Anthony Johnson','Hi Anthony,

It''s great connecting with you. I''d like to introduce myself and my company, Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?  I would love to send you some samples of our products for your review and testing if you are interested.  Thank you!',NULL,'INBOX'),
('export:2-MWUwMzliZGItZmFjNi00ZjZiLWJhYWUtYjJjMjcyMDEwOTMwXzEwMA==:20250512T23092:32803640','2-MWUwMzliZGItZmFjNi00ZjZiLWJhYWUtYjJjMjcyMDEwOTMwXzEwMA==','2025-05-12T23:09:25+00','outbound',NULL,'','Hello, I''d like to introduce myself—my name is Sean Klein with Klein Manufacturing. We produce USA-made phenolic scrapers widely used in aircraft maintenance. Does your team currently use phenolic scrapers during routine MRO work?',NULL,'INBOX'),
('export:2-MjMwMjdmZGUtOGQwMC00MzVkLTk2NWEtMDUyODJhZjU3NTRhXzEwMA==:20250512T23050:2b1ca64c','2-MjMwMjdmZGUtOGQwMC00MzVkLTk2NWEtMDUyODJhZjU3NTRhXzEwMA==','2025-05-12T23:05:05+00','outbound','https://www.linkedin.com/in/michael-miner','Michael Miner','Hi Michael, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-ZDI0YTU1ZGItY2Q2MC00ZmI1LWExYjctYmI2OWU1ZDVhOGIwXzEwMA==:20250424T22152:91eeba4a','2-ZDI0YTU1ZGItY2Q2MC00ZmI1LWExYjctYmI2OWU1ZDVhOGIwXzEwMA==','2025-04-24T22:15:23+00','outbound','https://www.linkedin.com/in/eric-smith-53228477','Eric Smith','Hi Eric, I''d like to connect and introduce Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?',NULL,'INBOX'),
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20241105T18522:73d7a740','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-11-05T18:52:29+00','inbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','You''re very much Sean!',NULL,'INBOX'),
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20241105T13460:1ad1566e','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-11-05T13:46:03+00','outbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','Thank you Harry!!',NULL,'INBOX'),
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20241102T13473:48359012','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-11-02T13:47:35+00','inbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','Happy belated birthday!',NULL,'INBOX'),
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20240119T04170:97cba485','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-01-19T04:17:05+00','inbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','Thanks',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20240118T15005:040106e5','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-01-18T15:00:51+00','outbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','Good morning Harry!  Sounds great, I''ll send you an email shortly.  Thank you!',NULL,'INBOX'),
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20240118T05045:24d91185','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-01-18T05:04:58+00','inbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','I would definitely like to see a sample! 
Harry@MakersAir.com',NULL,'INBOX'),
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20240118T05025:c3af2df5','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-01-18T05:02:51+00','inbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','Absolutely',NULL,'INBOX'),
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20240118T01102:44ab5ebf','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-01-18T01:10:20+00','outbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','I agree they''re a fantastic product! Wow that''s a long history using phenolic scrapers! I''m very proud of the quality of the scrapers that our company makes and I''d love to hear your feedback on how our scrapers compare to the ones you''re currently using.',NULL,'INBOX'),
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20240118T00590:099a45de','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-01-18T00:59:00+00','inbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','55 years and haven''t been able to find much in the way of phenolic scrapers.',NULL,'INBOX'),
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20240118T00573:3c607802','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-01-18T00:57:39+00','inbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','Thanks Sean, I absolutely agree that phenolic scrapers are the best! 
I''ve used them for at least',NULL,'INBOX'),
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20240118T00345:db57ebe0','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-01-18T00:34:59+00','outbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','Hi Harry!  I''m happy to connect with you as well, and I''m glad to hear you''re already familiar with the phenolic scraper product!  As I mentioned, my company specializes in manufacturing phenolic scrapers.  Our scrapers are hand made in California and have been rigorously tested by Boeing for both durability and longevity, and far exceed their standards.  Are there any issues with the ones you''re currently using?  I would love the opportunity to earn your business and send you some samples of our scrapers for your testing and review.  Would you be interested?',NULL,'INBOX'),
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20240118T00191:5397e058','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-01-18T00:19:16+00','inbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','Yes',NULL,'INBOX'),
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20240118T00191:a7075d11','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-01-18T00:19:13+00','inbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','I''m happy to connect',NULL,'INBOX'),
('export:2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==:20240118T00183:a3e43b51','2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','2024-01-18T00:18:38+00','outbound','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','Hi Harry! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YTVhMmY5N2EtYmE0ZS00NDgxLWI3ZDQtMTE1NjAxYzI1ZWMzXzAxMA==:20240806T01272:61b503cd','2-YTVhMmY5N2EtYmE0ZS00NDgxLWI3ZDQtMTE1NjAxYzI1ZWMzXzAxMA==','2024-08-06T01:27:28+00','outbound','https://www.linkedin.com/in/frank-j-pedersen-jr-b503b42','Frank J. Pedersen, Jr.','Hey Frank! How are you? I saw you on here and wanted to say hello! It''s been a long time! 

I''ve been working for B&M Builders, a civil construction company in Rancho for the last 7 years and actually emailed with you a few months ago. We''ve worked with you guys on a few projects. Just thought it was funny and small world and wanted to say hi! Hope all is well!',NULL,'INBOX'),
('export:2-YTVhMmY5N2EtYmE0ZS00NDgxLWI3ZDQtMTE1NjAxYzI1ZWMzXzAxMA==:20240713T17481:05402cd8','2-YTVhMmY5N2EtYmE0ZS00NDgxLWI3ZDQtMTE1NjAxYzI1ZWMzXzAxMA==','2024-07-13T17:48:12+00','inbound','https://www.linkedin.com/in/frank-j-pedersen-jr-b503b42','Frank J. Pedersen, Jr.','Hi Sean!',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240702T23203:f476fc21','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-07-02T23:20:37+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hi Shawn! Just wanted to check in with you to see if you were able to show any of the other mechanics the samples of our phenolic scrapers. Are you interested in placing a small test order for either of our products? Please let me know when you can, thank you!',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240213T18525:dbdae239','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-02-13T18:52:59+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hi Shawn!  Great to hear from you and thank you for your feedback!  I''m glad to hear you''re happy with our product!  At this time those are the only 2 sized scrapers we make, but I can look into making additional sizes for the future.  What width and length would you like to see for a scraper to use in the small compact areas?  I''m looking forward to hearing the input from your other mechanics as well!  Let me know what kind of quantities you would consider ordering and I can send over a price sheet with price breaks depending on order quantity.  Looking forward to hearing from you soon.  Thank you!',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240213T17431:e8c059ae','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-02-13T17:43:17+00','inbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hello Sean.  During some recent maintenance tasks I have been able to test your product.  Some positives, I enjoyed the length of the scrappers and the leverage it presented, it has the right amount of strength and durability for all levels of tasks.  Something I would like to see (personally) the width of the scrapping surface to be narrower or have the option for a narrow version, possibly a shorter version as well for small compact working areas.  Overall I''m satisfied with your product.  I would like to show your product off to other mechanics and get their input and see if there is a market to purchase a higher quantity.',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240131T18330:c3d87a0b','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-31T18:33:02+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hi Shawn!  I hope you''re doing well!  I wanted to check in with you to see if you had an opportunity to test out the samples of our phenolic scrapers.  Were you able to put them to use?  If so, how did they work out and how do they compare to the ones you''re currently using?  I would love to discuss pricing with you if you are interested in placing an order.  Please let me know, thank you!',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240125T02304:8a1c7665','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-25T02:30:42+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hi Shawn! I definitely understand hectic days! Glad you got them, sounds like a plan. Thank you so much, I hope yours goes well also! And thank you for this opportunity!',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240125T02192:df5ee5ee','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-25T02:19:22+00','inbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hello Sean!  I have received your package, today was a bit hectic but I plan to test your scrappers soon.  Thank you for the follow up and I hope the rest of your week goes well.',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240125T01075:7519f30a','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-25T01:07:54+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hi Shawn! Looks like the scraper samples were delivered today, just wanted to make sure you got them. Glad they weren''t lost by UPS! Looking forward to hearing your thoughts on the scrapers. Thank you!',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240124T03205:c6e46985','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-24T03:20:57+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','I agree, I''ve had some issues with UPS not delivering shipments on the day they''re supposed to arrive. I assume maybe it''s weather related, but who knows. Thanks for your patience Shawn, have a great evening!',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240124T00395:31087c41','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-24T00:39:56+00','inbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','It seems like the mail service as of late is having issues.',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240124T00393:99791ab9','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-24T00:39:33+00','inbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Thanks, Sean',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240123T20171:f51e096b','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-23T20:17:19+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hi Shawn!  Hope you''re doing well!  I just tracked the shipment of samples and it looks like UPS has a delay on the shipment and it doesn''t have an updated delivery date.  Unfortunately it doesn''t tell me the reason for the delay, hopefully they haven''t lost the package.  I''ll check back tomorrow to see if there''s an update and will keep in touch.  Thank you, have a great day!',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240119T02122:cac3a391','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-19T02:12:23+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Thank you Shawn, same to you!',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240119T01561:cd7d6a93','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-19T01:56:18+00','inbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Thank you, Sean!  I will certainly provide feedback after testing your product.  Have a great weekend.',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240119T00440:f091f379','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-19T00:44:04+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hi Shawn!  The samples of the phenolic scrapers were sent out this afternoon via UPS ground, they should arrive next Tuesday 1/23.  Tracking # 1Z0592W00340565270.  I''m looking forward to hearing your thoughts on our products, and am eager to earn your business.  Please feel free to reach out to me any time on my cell phone (916) 671-4772 or via email: kleinmanufacturing@gmail.com.  Thank you for this opportunity!',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240118T02401:de00258d','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-18T02:40:15+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hi Shawn! Sounds great, I''ll get the samples shipped out tomorrow via UPS and I''ll send you the tracking number when I have it. Thank you so much for this opportunity! I''m looking forward to hearing your feedback. 

You can always message me on here, or you can text/call me on my cell phone (916) 671-4772, or email me at kleinmanufacturing@gmail.com. 

Thank you!',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240118T02313:bf66478e','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-18T02:31:35+00','inbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Please send 2 of each sample to:
Attn: Shawn Cushman
6012 Aviation Drive
Pflugerville, TX 78660

I appreciate the opportunity to test your product and look forward to investing in your products.',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240118T00171:5532b036','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-18T00:17:15+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hi Shawn! No problem on the delay, hope I didn''t bug you. I can send some samples of our scrapers out tomorrow via UPS. We make them in both a 6" and 11" version. Would 2 of each be enough to sample, or would you like more? I just need an address for where you''d like me to send them and I''ll get them shipped out and will send you the tracking number.',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240118T00002:d705046c','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-18T00:00:22+00','inbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hello Sean!  My apologies for the delay of my reply.  I would indeed enjoy taking a look at your product and having an opportunity to test your scrappers out.  How would you like to proceed?',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240117T18174:3bd1fb00','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-17T18:17:49+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hi Shawn!  I hope you''re having a great week!  I wanted to follow up with you to see if you have any interest in testing out some samples of our phenolic scrapers to compare to the ones you''re using currently.  I''d love the opportunity to earn your business and to further discuss our phenolic scrapers with you.  If you have any questions or would like to discuss, you can message me on here, call/text my cell phone (916) 671-4772, or you can email me: kleinmanufacturing@gmail.com.  Thank you!',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240115T02214:e8ef2b6b','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-15T02:21:42+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hi Shawn! It''s great to meet you! I hope you''ve had a great weekend! 

Our scrapers are hand made in the USA from a high strength phenolic material and the handles are reinforced with hardened steel to resist shearing off during use.  Our scrapers have been rigorously tested by Boeing for both durability and longevity, and far exceed their standards.  I believe our scrapers are far more durable than those from our competitors, and will help you increase productivity during aircraft maintenance.  We manufacture the phenolic scrapers in both a 6" and 11" version and I would love to send you some samples of our products for your use and review. Would that be ok with you?',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240113T01332:d6abaf89','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-13T01:33:22+00','inbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hello, Sean!  It''s a pleasure to connect.  Yes, from to time I find myself involved in maintenance activities requiring plastic/phenolic scrappers.  Tell me about your product(s).',NULL,'INBOX'),
('export:2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==:20240112T17495:506502d4','2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','2024-01-12T17:49:54+00','outbound','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','Hi Shawn! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-MmFjNmM0OWMtYzk3Yy00MmMxLTgxZTgtMjY2MWE0YTRhZDE1XzAxMA==:20240504T16511:492da703','2-MmFjNmM0OWMtYzk3Yy00MmMxLTgxZTgtMjY2MWE0YTRhZDE1XzAxMA==','2024-05-04T16:51:10+00','outbound','https://www.linkedin.com/in/cole-ward-a463b81a5','Cole Ward','Hi Cole!  I''d like to connect with you and introduce myself and my company, Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-NzgwNWQ5NTEtZDQwMy00NGFmLWE0NzctOTVhYzRhNTg3MTI3XzAxMA==:20240423T13495:75a612ee','2-NzgwNWQ5NTEtZDQwMy00NGFmLWE0NzctOTVhYzRhNTg3MTI3XzAxMA==','2024-04-23T13:49:56+00','inbound','https://www.linkedin.com/in/jason-meynarez-6649165','Jason Meynarez','Hi Sean, I hope you are doing well. I want to touch base because I often come across companies that are overpaying for their aviation insurance. We currently broker insurance for approximately 250 companies in the aviation industry, and our dedicated team possesses extensive experience in the aviation Insurance industry.

Our experience extends not only to insurance brokering but also to underwriting, enabling us to leverage insurance company rating models for negotiating competitive terms. Our market expertise, negotiation skills, and our commitment to securing the best terms for our clients consistently yield impressive lower premiums with high quality coverage.

Let''s grab a time to talk. Do you have some time this week?
-Jason',NULL,'INBOX'),
('export:2-NzgwNWQ5NTEtZDQwMy00NGFmLWE0NzctOTVhYzRhNTg3MTI3XzAxMA==:20240418T14022:8659af9b','2-NzgwNWQ5NTEtZDQwMy00NGFmLWE0NzctOTVhYzRhNTg3MTI3XzAxMA==','2024-04-18T14:02:21+00','outbound','https://www.linkedin.com/in/jason-meynarez-6649165','Jason Meynarez','I''m happy to connect, Jason',NULL,'INBOX'),
('export:2-NzgwNWQ5NTEtZDQwMy00NGFmLWE0NzctOTVhYzRhNTg3MTI3XzAxMA==:20240418T14021:7246ca0e','2-NzgwNWQ5NTEtZDQwMy00NGFmLWE0NzctOTVhYzRhNTg3MTI3XzAxMA==','2024-04-18T14:02:16+00','inbound','https://www.linkedin.com/in/jason-meynarez-6649165','Jason Meynarez','Hi Sean, I''ve built some great connections in the aviation field throughout the years. I thought it would be great to connect with you here on LinkedIn. Let''s connect and I''ll send you a message soon. -Jason',NULL,'INBOX'),
('export:2-NDI0ZjU2NWMtNTZhMS00MWVhLTg1NGYtOTFhOGNlYmZhMzM4XzAxMA==:20240408T21010:53efa559','2-NDI0ZjU2NWMtNTZhMS00MWVhLTg1NGYtOTFhOGNlYmZhMzM4XzAxMA==','2024-04-08T21:01:03+00','outbound','https://www.linkedin.com/in/jonathan-p-a923b5b4','Jonathan Pizarro','Hi Jonathan! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do you use phenolic scrapers for any exterior aircraft maintenance at Southwest Airlines?',NULL,'INBOX'),
('export:2-MmU2ZGI3OTQtZWYzOC00OTAwLTllNjctOGFiMzk0ZDk0NzFlXzAxMA==:20240312T15172:76e2b9ae','2-MmU2ZGI3OTQtZWYzOC00OTAwLTllNjctOGFiMzk0ZDk0NzFlXzAxMA==','2024-03-12T15:17:25+00','inbound','https://www.linkedin.com/in/justin-loyd-69b3a537','Justin Loyd','Not at this location, just orbital and block sanding. I have used them in the past',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-MmU2ZGI3OTQtZWYzOC00OTAwLTllNjctOGFiMzk0ZDk0NzFlXzAxMA==:20240312T15153:59ea72c1','2-MmU2ZGI3OTQtZWYzOC00OTAwLTllNjctOGFiMzk0ZDk0NzFlXzAxMA==','2024-03-12T15:15:36+00','outbound','https://www.linkedin.com/in/justin-loyd-69b3a537','Justin Loyd','Hi Justin! I''d like to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do you use phenolic scrapers for any exterior aircraft maintenance prior to aircraft painting?',NULL,'INBOX'),
('export:2-Zjk5YzM3NzUtMDI4ZS00MjkyLWIzNWYtYjJkYTg4MDU0NDMyXzAxMg==:20240312T14163:88c5ff6e','2-Zjk5YzM3NzUtMDI4ZS00MjkyLWIzNWYtYjJkYTg4MDU0NDMyXzAxMg==','2024-03-12T14:16:37+00','outbound','https://www.linkedin.com/in/gregory-reyes-estevez-8b1642236','Gregory  Reyes Estevez','Hi Gregory! I''d like to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do you use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-NTE4ZDUwNTEtYjA0NS00ZWY2LTg2OGEtNWM2MGYxZDk3OTFhXzAxMA==:20240311T16592:c9c84fb6','2-NTE4ZDUwNTEtYjA0NS00ZWY2LTg2OGEtNWM2MGYxZDk3OTFhXzAxMA==','2024-03-11T16:59:25+00','outbound','https://www.linkedin.com/in/brandon-clausen-2044a37a','Brandon Clausen','Hi Brandon! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-MzI2NzAyYTUtMWU4MS00NjMxLWI4MmMtMzc3MWZjNWExYjliXzAxMA==:20240308T22300:b9d64aac','2-MzI2NzAyYTUtMWU4MS00NjMxLWI4MmMtMzc3MWZjNWExYjliXzAxMA==','2024-03-08T22:30:02+00','outbound','https://www.linkedin.com/in/brian-felt-ba415b117','Brian Felt','Hi Brian! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-ZGQwYTJiOTEtMWRiZS00NzgzLWI1YjAtMDUxMWU3ZTg3NGUzXzAxMg==:20240215T16165:3ecb60d4','2-ZGQwYTJiOTEtMWRiZS00NzgzLWI1YjAtMDUxMWU3ZTg3NGUzXzAxMg==','2024-02-15T16:16:50+00','outbound',NULL,'LinkedIn Member','Hi Persi! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-ZTJmNWRmMzQtMmUxZS00NzBjLWFkZWItNjE0OTA1ZTZmMzNkXzAxMA==:20240213T01330:acb3777b','2-ZTJmNWRmMzQtMmUxZS00NzBjLWFkZWItNjE0OTA1ZTZmMzNkXzAxMA==','2024-02-13T01:33:04+00','outbound','https://www.linkedin.com/in/gilberto-rivera-aa5501166','Gilberto Rivera','Hi Gilberto! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YmY4ODFkNzItOGViNS00MWQxLWI4YjUtNzMzYWFjNWZmYmZjXzAxMA==:20240210T00082:af2e1fc8','2-YmY4ODFkNzItOGViNS00MWQxLWI4YjUtNzMzYWFjNWZmYmZjXzAxMA==','2024-02-10T00:08:25+00','outbound','https://www.linkedin.com/in/kerry-mergler-56a47571','Kerry Mergler','Hi Kerry! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance at Southwest?',NULL,'INBOX'),
('export:2-YjI0YTQ1NzEtZTdlZS00NWI3LWJjNjctYWZmZDYyMzE2NjdkXzAxMg==:20240205T14451:381a1ff6','2-YjI0YTQ1NzEtZTdlZS00NWI3LWJjNjctYWZmZDYyMzE2NjdkXzAxMg==','2024-02-05T14:45:13+00','inbound','https://www.linkedin.com/in/joe-dinolfo-25bb4a5','Joe Dinolfo','I''ve never used them we do private plans, not commercial',NULL,'INBOX'),
('export:2-YjI0YTQ1NzEtZTdlZS00NWI3LWJjNjctYWZmZDYyMzE2NjdkXzAxMg==:20240131T18271:87bddad6','2-YjI0YTQ1NzEtZTdlZS00NWI3LWJjNjctYWZmZDYyMzE2NjdkXzAxMg==','2024-01-31T18:27:14+00','outbound','https://www.linkedin.com/in/joe-dinolfo-25bb4a5','Joe Dinolfo','Hi Joe!  Same here, I''m happy to connect with you!  I reached out to see if you ever use phenolic scrapers to prep aircrafts prior to painting.  Is that a product that you''re familiar with, or one that you ever have a need for?',NULL,'INBOX'),
('export:2-YjI0YTQ1NzEtZTdlZS00NWI3LWJjNjctYWZmZDYyMzE2NjdkXzAxMg==:20240131T14372:a7075d11','2-YjI0YTQ1NzEtZTdlZS00NWI3LWJjNjctYWZmZDYyMzE2NjdkXzAxMg==','2024-01-31T14:37:27+00','inbound','https://www.linkedin.com/in/joe-dinolfo-25bb4a5','Joe Dinolfo','I''m happy to connect',NULL,'INBOX'),
('export:2-YjI0YTQ1NzEtZTdlZS00NWI3LWJjNjctYWZmZDYyMzE2NjdkXzAxMg==:20240123T16201:12bbd21e','2-YjI0YTQ1NzEtZTdlZS00NWI3LWJjNjctYWZmZDYyMzE2NjdkXzAxMg==','2024-01-23T16:20:14+00','outbound','https://www.linkedin.com/in/joe-dinolfo-25bb4a5','Joe Dinolfo','Hi Joe! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do you use phenolic scrapers to prep the surface prior to painting an aircraft?',NULL,'INBOX'),
('export:2-ZjBhZTk0ZWMtZmViOS00ZDgzLWI4ODUtMDhlMGJiYjYxMjdkXzAxMA==:20240203T02165:58ec0a9f','2-ZjBhZTk0ZWMtZmViOS00ZDgzLWI4ODUtMDhlMGJiYjYxMjdkXzAxMA==','2024-02-03T02:16:51+00','outbound','https://www.linkedin.com/in/gilbert-palos-2a2a36a1','Gilbert Palos','Hi Gilbert!  I''d like to connect with you and introduce myself and my company, Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-OThhYWY3ODMtMmE3Zi00ZTUxLTg3Y2MtNGM3Yjc5Mzg3YTlmXzAxMA==:20240131T19442:d46441c3','2-OThhYWY3ODMtMmE3Zi00ZTUxLTg3Y2MtNGM3Yjc5Mzg3YTlmXzAxMA==','2024-01-31T19:44:29+00','outbound','https://www.linkedin.com/in/david-jensen-41578140','David Jensen','Hi David! I''m happy to connect with you!  I reached out to see if your maintenance technicians ever use phenolic scrapers during any aircraft maintenance.  Is that a product that you''re familiar with, or one that you ever have a need for?',NULL,'INBOX'),
('export:2-OThhYWY3ODMtMmE3Zi00ZTUxLTg3Y2MtNGM3Yjc5Mzg3YTlmXzAxMA==:20240116T17121:e2a4afad','2-OThhYWY3ODMtMmE3Zi00ZTUxLTg3Y2MtNGM3Yjc5Mzg3YTlmXzAxMA==','2024-01-16T17:12:14+00','outbound','https://www.linkedin.com/in/david-jensen-41578140','David Jensen','Hi David! I''d like to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20240131T18362:f1c8795a','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2024-01-31T18:36:21+00','outbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','Hi Jason!  I hope you''re doing well!  I sent you a couple emails and left you a voicemail a couple weeks ago, just thought I''d reach out to you on here as well.  I wanted to check in to see if you had an opportunity to test out the samples of our phenolic scrapers I sent back at the end of November.  Were you able to put them to use?  If so, how did they work out and how do they compare to the ones you''re currently using?  Do you have a need for more scrapers, and if so would you be interested in placing an order?  Please let me know, thank you!',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T20434:c088d357','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T20:43:40+00','outbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','It''s my pleasure',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T20372:b846144a','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T20:37:21+00','inbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','Thank you very much',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T20322:d9f2896a','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T20:32:21+00','outbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','My pleasure, thank you Jason.  I''ll send you an email this afternoon with the tracking number once I get it from UPS.  

Thank you!',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T20300:5e9eb8c2','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T20:30:09+00','inbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','Thank you Sean for reaching out.  My number is 908.868.7417  or email is jason@nighthawkjobs.com',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T20280:5d81c480','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T20:28:09+00','outbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','Ok, great!  I''ll get those samples out to you this afternoon and will send you the tracking number when I get it.  

If it''s easier for you, you can call or text me anytime instead of messaging on LinkedIn.  My cell phone number is 916-671-4772.  Or you can email me, kleinmanufacturing@gmail.com.

Thank you for this opportunity Jason!!',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T20244:12fcda81','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T20:24:44+00','inbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','Nighthawk Aviation Services
308 Oak Lane
West Windsor, NJ 08550',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T19552:e44a2ef8','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T19:55:26+00','outbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','What address would you like me to send the samples to?',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T19530:0ef57a58','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T19:53:00+00','outbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','I would be happy to send out some samples of both of our products to you today.  I''ll send 3 samples of each product, the 6" long and 11" long scraper.  Would that be ok, or would you like additional samples?',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T19520:95541345','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T19:52:09+00','outbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','I can definitely look into what kind of rubber handle I can put over the shank to make it more comfortable to use our products.',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T19495:ac2ff3e5','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T19:49:52+00','inbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','I would like to try out your samples',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T19492:7b4de327','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T19:49:28+00','inbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','I would use the rubber handle on both nylon and phenolic because it is comfortable for my hands',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T19402:92d28686','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T19:40:27+00','outbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','Hi Jason!  No problem, I know it was a busy week last week with the Thanksgiving holiday. My Thanksgiving was great, thank you for asking.  I hope yours was as well!

The Yard sells a scraper similar to our product, but at almost twice the cost.  Do you use the notch in the side of the scraper that the ones from the Yard come with? I believe we could save you some serious money on the phenolic scrapers as we offer our 6" long phenolic scraper for $10.50 each.  We also have an 11" long version that we sell for $12 each.  I would love the opportunity to send you some samples of our products if you are interested.

Unfortunately, we do not make the nylon scrapers at this time.  Which version of the scrapers would you use the rubber handle on?',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T19171:1c839892','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T19:17:17+00','inbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','Good Afternoon  Sean,

Sorry for my delayed response. I hope you had a great Thanksgiving as well. I typically purchase scrappers from the yard but I also use the hard plastic/nylon type as well. When I''m always in search of is a rubber handle cover to go over the back of the scrapper even if I round i
The edges',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231128T15463:362d730d','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-28T15:46:36+00','outbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','Good morning Jason.  I hope you had a great Thanksgiving!  I wanted to follow up with you this morning about the phenolic scrapers you use for maintenance.  Where are you currently purchasing the scrapers that you use?',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231121T05424:18548353','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-21T05:42:47+00','outbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','Yes, I make phenolic scrapers in 2 different sizes, 6" and 11" lengths. Both sizes are for use with a .401 shank rivet gun. Are those sizes you''re currently using? I would love the opportunity to send you some samples of our products for your review and use. Would that be acceptable?',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231121T05362:e131d2f1','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-21T05:36:21+00','inbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','Hi Sean,

Yes I do use phenolic scrapers for   a multitude of maintenance.  Do you guys sell different products?',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231121T05220:df4c4059','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-21T05:22:00+00','outbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','Hi Jason, it''s nice to meet you. I wanted to introduce myself and my company, Klein Manufacturing LLC which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231121T05161:bde4b41a','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-21T05:16:10+00','inbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','Hi Sean, how can I help you?',NULL,'INBOX'),
('export:2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==:20231121T05152:57ba2bd2','2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','2023-11-21T05:15:29+00','outbound','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','Hi Jason, I''m Sean Klein from Klein Manufacturing LLC, manufacturing high quality phenolic scrapers for aircraft maintenance. I''d like to connect with you to discuss how we can elevate your operations',NULL,'INBOX'),
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240131T18322:4b4b53f7','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-31T18:32:27+00','outbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','Hi Arthur!  I hope you''re doing well!  I wanted to check in with you to see if you had an opportunity to test out the samples of our phenolic scrapers.  Were you able to put them to use?  If so, how did they work out and how do they compare to the ones you''re currently using?  I would love to discuss pricing with you if you are interested in placing an order.  Please let me know, thank you!',NULL,'INBOX'),
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240123T18453:ec40723a','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-23T18:45:33+00','outbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','Hi Arthur!  Glad to hear you received them!  Yes, the 2 different samples are the only sizes that we make currently.  Are there other sizes of phenolic scrapers that you use or need?  Yes, our parts have a round handle to be used with a .401" shank rivet gun or air hammer, and the handles are reinforced with a hardened steel rod to resist shearing off during use.',NULL,'INBOX'),
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240123T18292:f9781c54','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-23T18:29:22+00','inbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','Sean we have revived the scrappers and will be using them today . Is that all the shapes and sizes provide . I notice they have handles is that also universal',NULL,'INBOX'),
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240122T17325:91d7428d','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-22T17:32:58+00','outbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','Hi Arthur!  That sounds great, thank you!',NULL,'INBOX'),
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240122T17205:1afc8ece','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-22T17:20:53+00','inbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','Good afternoon Sean,
I have advised our team to pick them up and we will  advise . Tomorrow we have a windshield change',NULL,'INBOX'),
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240122T16182:e573bef6','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-22T16:18:22+00','outbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','Good morning Arthur!  I hope you had a great weekend!  I just tracked the shipment of the phenolic scraper samples and it looks like they were delivered last Friday so I just wanted to check in with you and make sure you received the box.  Please feel free to reach out to me anytime with any questions.  You can call/text my cell phone 916-671-4772, or email me at kleinmanufacturing@gmail.com.  Looking forward to hearing your thoughts on our scrapers.  Thank you!',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240116T16021:6a632112','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-16T16:02:16+00','outbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','Good morning Arthur!  I sent 2 samples of each of our products out today via UPS 3rd day air so you should receive them this Friday 1/19.  Tracking number is: 1Z0592W01241648868.

We make the phenolic scrapers in a 6" and 11" length.  I look forward to hearing your feedback after your review.  Thank you for this opportunity!',NULL,'INBOX'),
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240115T22103:3beacec6','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-15T22:10:36+00','outbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','That sounds great, looking forward to it! UPS is not picking up today for the MLK holiday so I''ll get this package of samples shipped out tomorrow and I''ll shoot you the tracking number. Thanks Arthur, have a great evening!',NULL,'INBOX'),
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240115T21410:44fc8f9d','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-15T21:41:05+00','inbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','Thank you sir , I will advise what we think !',NULL,'INBOX'),
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240115T02283:8acdc1ad','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-15T02:28:33+00','outbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','Hi Arthur! Excellent, I will ship the samples out on Tuesday and I''ll send you the tracking number once I have it. I''m excited to hear your thoughts and review of our products, and I look forward to earning your business! My phone number is 916-671-4772, and my email address is: kleinmanufacturing@gmail.com. You can call or email me anytime. Thank you!!',NULL,'INBOX'),
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240115T02190:97dd0900','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-15T02:19:09+00','inbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','Of course Sean , we are actually in need of an order . I''m excited to see what your scrappers are like. Please send scrappers to 

101 Charles A Lindbergh Drive , Suite 204, Teterboro,NJ,07608

Attn : Empire Aviation USA',NULL,'INBOX'),
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240115T02171:d8912541','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-15T02:17:10+00','outbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','Hi Arthur! I''m great, thank you. How are you? I would love to send you some samples of our scrapers for you to test out, and we are eager to earn your business. I believe UPS is closed tomorrow for MLK day, but I can have the samples shipped out on Tuesday. Can you send me the address for where you''d like me to send them?',NULL,'INBOX'),
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240115T01553:5463666c','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-15T01:55:33+00','inbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','How are you Sean, we currently use plastic and would love to try out your scrappers.',NULL,'INBOX'),
('export:2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==:20240111T21322:29e892bf','2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','2024-01-11T21:32:21+00','outbound','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','Hi Arthur! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-ZTM4OGVhYTAtZjk5Yy00ODlkLWExYjItYjYwM2Y5NWI2NDJjXzAxMA==:20240130T12454:b181da38','2-ZTM4OGVhYTAtZjk5Yy00ODlkLWExYjItYjYwM2Y5NWI2NDJjXzAxMA==','2024-01-30T12:45:46+00','outbound','https://www.linkedin.com/in/brian-woods-25632bb2','Brian Woods','Hi Brian! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YTYxODgzOGMtNTQwNC00N2Q3LWI0NTYtMDdkNmZkM2NlMGI5XzAxMA==:20240126T22174:3aa394ec','2-YTYxODgzOGMtNTQwNC00N2Q3LWI0NTYtMDdkNmZkM2NlMGI5XzAxMA==','2024-01-26T22:17:45+00','outbound','https://www.linkedin.com/in/al-guerra-77b01754','Al Guerra','Hi Al! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YTY4MWQwNDUtOTk1YS00YTY1LWEwYzAtMzY1YjYwZjRlOGQ1XzAxMg==:20240126T15391:aa23a852','2-YTY4MWQwNDUtOTk1YS00YTY1LWEwYzAtMzY1YjYwZjRlOGQ1XzAxMg==','2024-01-26T15:39:14+00','outbound','https://www.linkedin.com/in/jamesbellard','James Bellard','Good morning James!  I''m happy to connect as well!  I reached out to see if you use phenolic scrapers for any aircraft maintenance at Zenetex.  My company is local based in Orangevale and we make phenolic scrapers for aircraft maintenance.  Do you use phenolic scrapers for any of your work at Zenetex?',NULL,'INBOX'),
('export:2-YTY4MWQwNDUtOTk1YS00YTY1LWEwYzAtMzY1YjYwZjRlOGQ1XzAxMg==:20240126T14204:a7075d11','2-YTY4MWQwNDUtOTk1YS00YTY1LWEwYzAtMzY1YjYwZjRlOGQ1XzAxMg==','2024-01-26T14:20:49+00','inbound','https://www.linkedin.com/in/jamesbellard','James Bellard','I''m happy to connect',NULL,'INBOX'),
('export:2-YTY4MWQwNDUtOTk1YS00YTY1LWEwYzAtMzY1YjYwZjRlOGQ1XzAxMg==:20240126T14183:ad3798be','2-YTY4MWQwNDUtOTk1YS00YTY1LWEwYzAtMzY1YjYwZjRlOGQ1XzAxMg==','2024-01-26T14:18:31+00','outbound','https://www.linkedin.com/in/jamesbellard','James Bellard','Hi James! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-MjNlODdlM2UtNjYyYi00MDhlLTlhOGMtZDhiZjJlZjUwYTQ3XzAxMg==:20240122T17403:872696e6','2-MjNlODdlM2UtNjYyYi00MDhlLTlhOGMtZDhiZjJlZjUwYTQ3XzAxMg==','2024-01-22T17:40:38+00','outbound','https://www.linkedin.com/in/juan-alvarez-64510b182','Juan Alvarez','Hi Juan! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry.  Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YmVmOWYwNDctZWI3NS00MTJlLWE5YTQtMmE4Njc5MjNlNTA3XzAxMA==:20240122T14022:cb413358','2-YmVmOWYwNDctZWI3NS00MTJlLWE5YTQtMmE4Njc5MjNlNTA3XzAxMA==','2024-01-22T14:02:21+00','outbound','https://www.linkedin.com/in/lauren-palmer-674926291','Lauren Palmer','Hi Lauren! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-NjYxYWI0MmQtY2E1OC00YmMzLWFkMzEtYzZjYjgyZjRkNGE1XzAxMg==:20240118T22230:20dc03de','2-NjYxYWI0MmQtY2E1OC00YmMzLWFkMzEtYzZjYjgyZjRkNGE1XzAxMg==','2024-01-18T22:23:09+00','outbound','https://www.linkedin.com/in/jeffrey-linstra-aa701712','Jeffrey Linstra','Hi Jeff! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-NDRkMmE2MDEtNzY4Yi00MzBhLTk2ZWQtYjVmNGI1MTkwNjM1XzAxMg==:20240118T19525:20a9befe','2-NDRkMmE2MDEtNzY4Yi00MzBhLTk2ZWQtYjVmNGI1MTkwNjM1XzAxMg==','2024-01-18T19:52:51+00','outbound','https://www.linkedin.com/in/sjms56','Steven Sinski','Hi Steven!  I understand, thank you for letting me know.  If the need for phenolic scrapers ever comes up in the future, please keep me in mind.  My company makes 2 different types of phenolic scrapers and I would love to send you samples in the future if the need arises.  I hope you have a great day!',NULL,'INBOX'),
('export:2-NDRkMmE2MDEtNzY4Yi00MzBhLTk2ZWQtYjVmNGI1MTkwNjM1XzAxMg==:20240118T18495:776d1236','2-NDRkMmE2MDEtNzY4Yi00MzBhLTk2ZWQtYjVmNGI1MTkwNjM1XzAxMg==','2024-01-18T18:49:57+00','inbound','https://www.linkedin.com/in/sjms56','Steven Sinski','No, thank you',NULL,'INBOX'),
('export:2-NDRkMmE2MDEtNzY4Yi00MzBhLTk2ZWQtYjVmNGI1MTkwNjM1XzAxMg==:20240118T18493:edf3bfdc','2-NDRkMmE2MDEtNzY4Yi00MzBhLTk2ZWQtYjVmNGI1MTkwNjM1XzAxMg==','2024-01-18T18:49:35+00','outbound','https://www.linkedin.com/in/sjms56','Steven Sinski','Hi Steven! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YzZhOTgwMzAtZDNkYy00MGEyLTllMzMtMjBlODQ5ZGRkYzFmXzAxMA==:20240118T19123:55bd2253','2-YzZhOTgwMzAtZDNkYy00MGEyLTllMzMtMjBlODQ5ZGRkYzFmXzAxMA==','2024-01-18T19:12:37+00','outbound','https://www.linkedin.com/in/kevin-laird-2b678520','Kevin Laird','Hi Kevin! I''d like to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-ZGZjYTY1NDUtZWNlMy00NTIxLWIwNmEtMDhkMThhOTRmNTQ4XzAxMA==:20240118T13402:6d1e5c07','2-ZGZjYTY1NDUtZWNlMy00NTIxLWIwNmEtMDhkMThhOTRmNTQ4XzAxMA==','2024-01-18T13:40:29+00','outbound','https://www.linkedin.com/in/aaron-esparza','Aaron Esparza','Hi Aaron! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-MzIyYzRjODItNzA0ZS00YjFkLTkzYmYtZjkxNjIyOGY4YTBkXzAxMg==:20240117T19430:0d5a47ff','2-MzIyYzRjODItNzA0ZS00YjFkLTkzYmYtZjkxNjIyOGY4YTBkXzAxMg==','2024-01-17T19:43:06+00','outbound','https://www.linkedin.com/in/alejandro-gomez-453452b6','Alejandro Gomez','Hi Alejandro! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==:20240117T18342:f509d4f8','2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==','2024-01-17T18:34:20+00','outbound','https://www.linkedin.com/in/dale-bomgardner-59ba6614','Dale Bomgardner','That''s ok, I understand.  Thank you for taking the time to discuss with me, I really appreciate it!

We sell our phenolic scrapers directly to Boeing and Delta.  I''ve been trying to get in with Southwest but haven''t gotten anywhere so thought I''d try reaching out to some technicians on LinkedIn to see if phenolic scrapers are even used at Southwest.  I''m happy to hear you''re using scrapers at Southwest.  Would you be able to tell me about how many are in the free stock bin, or how many you use a month average?

If you think of someone who might be able to allow some samples of our scrapers to be tested, I would greatly appreciate it if you pointed me in their direction.  Thank you Dale!',NULL,'INBOX'),
('export:2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==:20240117T18231:9c2884a7','2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==','2024-01-17T18:23:11+00','inbound','https://www.linkedin.com/in/dale-bomgardner-59ba6614','Dale Bomgardner','I''m the end user, not sure who to even ask. Sorry',NULL,'INBOX'),
('export:2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==:20240117T18104:7e7d9a52','2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==','2024-01-17T18:10:48+00','outbound','https://www.linkedin.com/in/dale-bomgardner-59ba6614','Dale Bomgardner','Oh ok, that makes sense.  Would you be interested in testing out some samples of our phenolic scrapers to compare to the ones you are currently using?  

Our scrapers have been rigorously tested by Boeing for both durability and longevity, and far exceed their standards.  Our scrapers are more durable than those from our competitors and will help you increase productivity during aircraft maintenance.',NULL,'INBOX'),
('export:2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==:20240117T18020:8e01eb36','2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==','2024-01-17T18:02:02+00','inbound','https://www.linkedin.com/in/dale-bomgardner-59ba6614','Dale Bomgardner','We have phenolic and nylon scrapers in the free stock bins for technicians to use as needed.',NULL,'INBOX'),
('export:2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==:20240117T17571:4d959a26','2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==','2024-01-17T17:57:10+00','outbound','https://www.linkedin.com/in/dale-bomgardner-59ba6614','Dale Bomgardner','Hi Dale, it''s great to meet you! That''s great you''re already familiar with the product!  How often are you using scrapers for maintenance?  Do you have any issues with the scrapers you''re using right now?',NULL,'INBOX'),
('export:2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==:20240117T17521:297fcf9a','2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==','2024-01-17T17:52:14+00','inbound','https://www.linkedin.com/in/dale-bomgardner-59ba6614','Dale Bomgardner','Yes we do.',NULL,'INBOX'),
('export:2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==:20240117T17263:736f1a18','2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==','2024-01-17T17:26:37+00','outbound','https://www.linkedin.com/in/dale-bomgardner-59ba6614','Dale Bomgardner','Hi Dale! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do you use phenolic scrapers for any exterior aircraft maintenance at Southwest Airlines?',NULL,'INBOX'),
('export:2-NmM2NmNlNTktZjRhNS00ZGM1LTkzODctMTUyZDBlOTA3MjUwXzAxMA==:20240117T15444:f5bda30e','2-NmM2NmNlNTktZjRhNS00ZGM1LTkzODctMTUyZDBlOTA3MjUwXzAxMA==','2024-01-17T15:44:49+00','outbound','https://www.linkedin.com/in/denilson-almeida-80683435','Denilson  Almeida','Good morning Denilson!  Sounds great, I look forward to hearing from you.  I would love the opportunity to send you some samples of our products for your testing and review.  Please let me know if that is something you would be open to.  

Please feel free to reach out to me at any time with any questions.  You can reach me on here, or you can call/text me on my cell phone (916) 671-4772 or you can send me an email: kleinmanufacturing@gmail.com.  Thank you.',NULL,'INBOX'),
('export:2-NmM2NmNlNTktZjRhNS00ZGM1LTkzODctMTUyZDBlOTA3MjUwXzAxMA==:20240117T15064:f736879d','2-NmM2NmNlNTktZjRhNS00ZGM1LTkzODctMTUyZDBlOTA3MjUwXzAxMA==','2024-01-17T15:06:41+00','inbound','https://www.linkedin.com/in/denilson-almeida-80683435','Denilson  Almeida','I''ll get back to you',NULL,'INBOX'),
('export:2-NmM2NmNlNTktZjRhNS00ZGM1LTkzODctMTUyZDBlOTA3MjUwXzAxMA==:20240117T15061:e087ab18','2-NmM2NmNlNTktZjRhNS00ZGM1LTkzODctMTUyZDBlOTA3MjUwXzAxMA==','2024-01-17T15:06:18+00','inbound','https://www.linkedin.com/in/denilson-almeida-80683435','Denilson  Almeida','Thanks for sharing',NULL,'INBOX'),
('export:2-NmM2NmNlNTktZjRhNS00ZGM1LTkzODctMTUyZDBlOTA3MjUwXzAxMA==:20240112T15380:9ed7c793','2-NmM2NmNlNTktZjRhNS00ZGM1LTkzODctMTUyZDBlOTA3MjUwXzAxMA==','2024-01-12T15:38:01+00','outbound','https://www.linkedin.com/in/denilson-almeida-80683435','Denilson  Almeida','Good morning Denilson!  It''s nice to meet you too!  I reached out to introduce myself and my company Klein Manufacturing that specializes in producing high quality phenolic scrapers for use during aircraft maintenance.  Do you use phenolic scrapers in any of the aircraft maintenance you perform at United Airlines?

Our scrapers are made in the United States from a high strength phenolic material and the handles are reinforced with hardened steel to resist shearing off during use.  Our scrapers have been rigorously tested by Boeing for both durability and longevity, and far exceed their standards.  I believe our scrapers are far more durable than those from our competitors, and will help you increase productivity during aircraft maintenance.',NULL,'INBOX'),
('export:2-NmM2NmNlNTktZjRhNS00ZGM1LTkzODctMTUyZDBlOTA3MjUwXzAxMA==:20240111T23062:c4b532be','2-NmM2NmNlNTktZjRhNS00ZGM1LTkzODctMTUyZDBlOTA3MjUwXzAxMA==','2024-01-11T23:06:22+00','inbound','https://www.linkedin.com/in/denilson-almeida-80683435','Denilson  Almeida','Hi Sean, nice to meet you',NULL,'INBOX'),
('export:2-NmM2NmNlNTktZjRhNS00ZGM1LTkzODctMTUyZDBlOTA3MjUwXzAxMA==:20240111T23045:e86707c2','2-NmM2NmNlNTktZjRhNS00ZGM1LTkzODctMTUyZDBlOTA3MjUwXzAxMA==','2024-01-11T23:04:57+00','outbound','https://www.linkedin.com/in/denilson-almeida-80683435','Denilson  Almeida','Hi Denilson! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers to UAL standards for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YzA4MTI2MDMtNGU3NS00NzMyLTk4YzQtZTVlOTJkZjMwODNlXzAxMg==:20240117T12235:f11d1b57','2-YzA4MTI2MDMtNGU3NS00NzMyLTk4YzQtZTVlOTJkZjMwODNlXzAxMg==','2024-01-17T12:23:57+00','outbound','https://www.linkedin.com/in/thomas-wittig-87762944','Thomas Wittig','Hi Thomas! I''d like to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do your maintenance technicians use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-NDlkOWJlMTYtNjgyYS00YmNmLTg0ZDctYjFjOGUyYzhkYTM2XzAxMA==:20240116T20391:4acb8356','2-NDlkOWJlMTYtNjgyYS00YmNmLTg0ZDctYjFjOGUyYzhkYTM2XzAxMA==','2024-01-16T20:39:14+00','outbound','https://www.linkedin.com/in/rohit-rameshar-14188287','Rohit Rameshar','Hi Rohit! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry.  Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-ZmQxNWRhODUtY2ZlNS00YTQ5LTliYWItZGVkN2NhODllMzc4XzAxMg==:20240116T19431:0ae17d39','2-ZmQxNWRhODUtY2ZlNS00YTQ5LTliYWItZGVkN2NhODllMzc4XzAxMg==','2024-01-16T19:43:12+00','outbound','https://www.linkedin.com/in/steve-betts-13128230','Steve Betts','Hi Steve, I hope you''re doing well.  I wanted to follow up with you to see if any of your maintenance technicians use phenolic scrapers during exterior aircraft maintenance.  My company Klein Manufacturing specializes in manufacturing phenolic scrapers for use in the aircraft industry.  I would love to connect with you to further discuss how our products could help elevate your aircraft maintenance operations.',NULL,'INBOX'),
('export:2-ZmQxNWRhODUtY2ZlNS00YTQ5LTliYWItZGVkN2NhODllMzc4XzAxMg==:20231206T04301:540cc926','2-ZmQxNWRhODUtY2ZlNS00YTQ5LTliYWItZGVkN2NhODllMzc4XzAxMg==','2023-12-06T04:30:16+00','outbound','https://www.linkedin.com/in/steve-betts-13128230','Steve Betts','Hi Steve!  I''d like to connect with you to introduce myself and my company, Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-NjY1ZmYwZWEtNjMzNS00YzQxLWI2ZjgtZTE5NzExN2U0MmM5XzAxMg==:20240116T16481:e1cac4f9','2-NjY1ZmYwZWEtNjMzNS00YzQxLWI2ZjgtZTE5NzExN2U0MmM5XzAxMg==','2024-01-16T16:48:15+00','outbound','https://www.linkedin.com/in/will-rodrigues-b882191a2','Will Rodrigues','Hi Will! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do you use phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-ZWJkNGY1ZWQtMzc0ZC00Y2Q3LTg3ZjktMDZlMmRjMjQ4YjM0XzAxMw==:20240116T16125:33994489','2-ZWJkNGY1ZWQtMzc0ZC00Y2Q3LTg3ZjktMDZlMmRjMjQ4YjM0XzAxMw==','2024-01-16T16:12:51+00','outbound','https://www.linkedin.com/in/rodrigochochelgoncalves','Rodrigo Goncalves','Good morning Rodrigo!  I hope your New Year is starting off well!  I wanted to follow up with you to find out if you use phenolic scrapers for aircraft maintenance and if you would be interested in checking out some samples of our products.',NULL,'INBOX'),
('export:2-ZWJkNGY1ZWQtMzc0ZC00Y2Q3LTg3ZjktMDZlMmRjMjQ4YjM0XzAxMw==:20231221T22373:9ca2b958','2-ZWJkNGY1ZWQtMzc0ZC00Y2Q3LTg3ZjktMDZlMmRjMjQ4YjM0XzAxMw==','2023-12-21T22:37:35+00','outbound','https://www.linkedin.com/in/rodrigochochelgoncalves','Rodrigo Goncalves','Hi Rodrigo! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-MjNiM2I5MTAtZmEyMi00NzRjLTk2YTEtZDgzMzQxOGIyZjE3XzAxMg==:20240116T12290:025d4df8','2-MjNiM2I5MTAtZmEyMi00NzRjLTk2YTEtZDgzMzQxOGIyZjE3XzAxMg==','2024-01-16T12:29:02+00','outbound','https://www.linkedin.com/in/dan-muir-589b1a50','Dan Muir','Hi Dan! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry.  Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-NzExMTA1NWQtOWViYS00NDdhLWJkYjItN2EyZTA4ZGY0ZDBlXzAxMA==:20240115T21350:b197f731','2-NzExMTA1NWQtOWViYS00NDdhLWJkYjItN2EyZTA4ZGY0ZDBlXzAxMA==','2024-01-15T21:35:07+00','outbound','https://www.linkedin.com/in/earl-glover-jr-89827939','Earl Glover jr','That''s great to hear you''re already familiar with the product! How are the scrapers you''re currently using working out for you? Would you be interested in testing out some samples of our products to see how they compare to what you''re currently using?',NULL,'INBOX'),
('export:2-NzExMTA1NWQtOWViYS00NDdhLWJkYjItN2EyZTA4ZGY0ZDBlXzAxMA==:20240115T21255:016f7e70','2-NzExMTA1NWQtOWViYS00NDdhLWJkYjItN2EyZTA4ZGY0ZDBlXzAxMA==','2024-01-15T21:25:53+00','inbound','https://www.linkedin.com/in/earl-glover-jr-89827939','Earl Glover jr','Yes, I do',NULL,'INBOX'),
('export:2-NzExMTA1NWQtOWViYS00NDdhLWJkYjItN2EyZTA4ZGY0ZDBlXzAxMA==:20240115T21145:b035e461','2-NzExMTA1NWQtOWViYS00NDdhLWJkYjItN2EyZTA4ZGY0ZDBlXzAxMA==','2024-01-15T21:14:54+00','outbound','https://www.linkedin.com/in/earl-glover-jr-89827939','Earl Glover jr','Hi Earl, nice to meet you as well! Do you ever use phenolic scrapers to prep the aircraft before painting?',NULL,'INBOX'),
('export:2-NzExMTA1NWQtOWViYS00NDdhLWJkYjItN2EyZTA4ZGY0ZDBlXzAxMA==:20240115T21050:c4b532be','2-NzExMTA1NWQtOWViYS00NDdhLWJkYjItN2EyZTA4ZGY0ZDBlXzAxMA==','2024-01-15T21:05:05+00','inbound','https://www.linkedin.com/in/earl-glover-jr-89827939','Earl Glover jr','Hi Sean, nice to meet you',NULL,'INBOX'),
('export:2-NzExMTA1NWQtOWViYS00NDdhLWJkYjItN2EyZTA4ZGY0ZDBlXzAxMA==:20231219T01340:d5a91705','2-NzExMTA1NWQtOWViYS00NDdhLWJkYjItN2EyZTA4ZGY0ZDBlXzAxMA==','2023-12-19T01:34:07+00','outbound','https://www.linkedin.com/in/earl-glover-jr-89827939','Earl Glover jr','Hi Earl! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-MjFmMjM1NjQtZWI4Ny00NWMzLWI3YTktMTM1NDI5MmIyMzc4XzAxMg==:20240115T19010:546bfc62','2-MjFmMjM1NjQtZWI4Ny00NWMzLWI3YTktMTM1NDI5MmIyMzc4XzAxMg==','2024-01-15T19:01:01+00','outbound','https://www.linkedin.com/in/raul-jr-7534b21a7','Raul Jr','Hi Raul! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry.  Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-ODY1NWI4ODgtYTUwMC00NGEzLTg5ZmYtMjg3NjE1N2YzNzE0XzAxMg==:20240115T17050:733d54c4','2-ODY1NWI4ODgtYTUwMC00NGEzLTg5ZmYtMjg3NjE1N2YzNzE0XzAxMg==','2024-01-15T17:05:08+00','outbound','https://www.linkedin.com/in/michael-dehm-6317b671','Michael Dehm','Hi Michael! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-ZjhjNWU3M2UtZmZmMy00YjhiLWFkODctODZmMzZlMGMwNzZmXzAxMg==:20240114T04125:4af10ee3','2-ZjhjNWU3M2UtZmZmMy00YjhiLWFkODctODZmMzZlMGMwNzZmXzAxMg==','2024-01-14T04:12:53+00','outbound','https://www.linkedin.com/in/joshua-vargas-a26a09251','Joshua Vargas','Hi Joshua! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-MzQ3ZjkxYjYtMDhmMC00M2Q1LWJmZGQtYzFiYTE0ZjFkODZkXzAxMA==:20240112T16455:11834268','2-MzQ3ZjkxYjYtMDhmMC00M2Q1LWJmZGQtYzFiYTE0ZjFkODZkXzAxMA==','2024-01-12T16:45:54+00','outbound','https://www.linkedin.com/in/hussein-osman-ab338445','Hussein Osman','Hi Hussein! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Did you utilize phenolic scrapers for any exterior aircraft maintenance while you were with UPS?',NULL,'INBOX'),
('export:2-MDJhNGE3MzktZGY3My00NTg5LWExMWYtOGE4NWMyMGJhN2Y4XzAxMA==:20240111T22173:9981f55d','2-MDJhNGE3MzktZGY3My00NTg5LWExMWYtOGE4NWMyMGJhN2Y4XzAxMA==','2024-01-11T22:17:33+00','outbound','https://www.linkedin.com/in/leroy-brooks-jr-38b3261b1','Leroy Brooks jr','Hi Leroy! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YTk0NjM3MjUtMWM2Yi00Njc3LTk2YTUtY2RkNjdjMmQ4MjY3XzAxMA==:20240111T20254:85ce59b3','2-YTk0NjM3MjUtMWM2Yi00Njc3LTk2YTUtY2RkNjdjMmQ4MjY3XzAxMA==','2024-01-11T20:25:41+00','outbound','https://www.linkedin.com/in/taylor-payton-5250b6ba','Taylor Payton','Hi Taylor! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-Zjg1MmIxZWUtNTMwZC00NzkwLTg2YjEtOTkzZjJmMGE0NGQzXzAxMA==:20231221T01300:fc6de8e0','2-Zjg1MmIxZWUtNTMwZC00NzkwLTg2YjEtOTkzZjJmMGE0NGQzXzAxMA==','2023-12-21T01:30:01+00','outbound','https://www.linkedin.com/in/andrew-nelson-65b1a97','Andrew Nelson','Hi Andrew! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-ODdiYjM2MTAtODRhMC00YjM5LTk1OGYtMWFmYzY4ZDA3Y2M4XzAxMw==:20231219T20463:49dcef3b','2-ODdiYjM2MTAtODRhMC00YjM5LTk1OGYtMWFmYzY4ZDA3Y2M4XzAxMw==','2023-12-19T20:46:31+00','inbound','https://www.linkedin.com/in/kevin-mclaughlin-237b3431','Kevin McLaughlin','I don''t have any operations. I''m looking for employment opportunities or consulting opportunities in the aircraft maintenance industry.',NULL,'INBOX'),
('export:2-ODdiYjM2MTAtODRhMC00YjM5LTk1OGYtMWFmYzY4ZDA3Y2M4XzAxMw==:20231219T20452:95ba3639','2-ODdiYjM2MTAtODRhMC00YjM5LTk1OGYtMWFmYzY4ZDA3Y2M4XzAxMw==','2023-12-19T20:45:22+00','outbound','https://www.linkedin.com/in/kevin-mclaughlin-237b3431','Kevin McLaughlin','Hi Kevin, I''m Sean Klein from Klein Manufacturing LLC, producing high quality phenolic scrapers for aircraft maintenance. I''d like to connect with you to discuss how we can elevate your operations',NULL,'INBOX'),
('export:2-Y2EyYmFkMzItNWIxNy00MjBlLWEyMzctOTgzZGM5YTZiNDQzXzAxMA==:20231218T15080:19db99f6','2-Y2EyYmFkMzItNWIxNy00MjBlLWEyMzctOTgzZGM5YTZiNDQzXzAxMA==','2023-12-18T15:08:04+00','outbound','https://www.linkedin.com/in/tinablackwelder','Tina Blackwelder','Hi Tina! Thank you for connecting! I wanted to introduce myself and my company, Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Do you know if your aircraft maintenance technicians are currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-OTQxOGU3NjMtZjNiMC00NjdjLTgzYzAtODZiMjRkMGFkYWE0XzAxMA==:20231215T14421:9d4bb7bc','2-OTQxOGU3NjMtZjNiMC00NjdjLTgzYzAtODZiMjRkMGFkYWE0XzAxMA==','2023-12-15T14:42:15+00','outbound','https://www.linkedin.com/in/ben-kazanecki-0287b88a','Ben Kazanecki','Hi Ben! I loved your post from today! I''d like to connect with you to introduce myself and my company Klein Manufacturing that specializes in manufacturing phenolic scrapers for the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-OGQ2YWUyZmItN2M3NC00YjRhLThmNDctOWQ4NjE0NGUxMmY0XzAxMA==:20231208T22050:92201732','2-OGQ2YWUyZmItN2M3NC00YjRhLThmNDctOWQ4NjE0NGUxMmY0XzAxMA==','2023-12-08T22:05:07+00','outbound','https://www.linkedin.com/in/jessica-parsons-5aab72135','Jessica Parsons','That would be great!  I''ll send you the prints to quote when I get orders from my customer for the machined parts.  

I have PNs for my parts that my current customers use but I don''t think those numbers would show up anywhere else.  I''ll get those over to you, thank you!!!',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-OGQ2YWUyZmItN2M3NC00YjRhLThmNDctOWQ4NjE0NGUxMmY0XzAxMA==:20231208T16351:8b639582','2-OGQ2YWUyZmItN2M3NC00YjRhLThmNDctOWQ4NjE0NGUxMmY0XzAxMA==','2023-12-08T16:35:14+00','inbound','https://www.linkedin.com/in/jessica-parsons-5aab72135','Jessica Parsons','Yes, I would love to quote your machining needs. 
And, if you have PNs for the phenolic scrapers from manufacturers, I can check with my buyers to see if they purchase those. We make parts for boeing planes and other military aircraft. We are also trying to get on with the DLA, so I could search there once we are setup. 
Good to hear from you, stay in touch!    jessica@ntengineering.us',NULL,'INBOX'),
('export:2-OGQ2YWUyZmItN2M3NC00YjRhLThmNDctOWQ4NjE0NGUxMmY0XzAxMA==:20231208T15270:5714ad2f','2-OGQ2YWUyZmItN2M3NC00YjRhLThmNDctOWQ4NjE0NGUxMmY0XzAxMA==','2023-12-08T15:27:01+00','outbound','https://www.linkedin.com/in/jessica-parsons-5aab72135','Jessica Parsons','Hi Jessica!  It''s been a long time, I''m glad we connected!  

Yes I''m still making the phenolic scrapers.  Business was excellent until 2020 when Covid happened, since then it''s been very unpredictable with inconsistent orders and long periods with no orders at all.  I made this LinkedIn profile a few months ago to try and find new customers that use my parts.  No luck yet but I''ll keep trying.

That''s great you''re still with ShopKeeper!  How''s business there?  Congratulations on NT Engineering!  Aerospace machining is one of the few industries we weren''t really in at O.K.  I still have a need for machined parts from time to time for 1 of my old customers from O.K.  Would you be interested in taking a look at the prints and quoting the parts when that need comes up?  I don''t suppose you have any contacts that might purchase phenolic scrapers for aircraft maintenance?  I had to ask haha.  

I''m glad to hear you''re doing well!',NULL,'INBOX'),
('export:2-OGQ2YWUyZmItN2M3NC00YjRhLThmNDctOWQ4NjE0NGUxMmY0XzAxMA==:20231208T02374:ec372e9c','2-OGQ2YWUyZmItN2M3NC00YjRhLThmNDctOWQ4NjE0NGUxMmY0XzAxMA==','2023-12-08T02:37:46+00','inbound','https://www.linkedin.com/in/jessica-parsons-5aab72135','Jessica Parsons','Hi! Long time no talk. I hope all is well. 

Are you still making the phenolic scrapers? 

I am still with ShopKeeper and now I also own a small aerospace shop in Rancho Cordova called NT Engineering. 

Thank you for connecting.',NULL,'INBOX'),
('export:2-MzU3MzczODEtODEwZi00OTI1LWI1ODQtN2Y5NDAyNDczMzA3XzAxMA==:20231208T15374:2164eef3','2-MzU3MzczODEtODEwZi00OTI1LWI1ODQtN2Y5NDAyNDczMzA3XzAxMA==','2023-12-08T15:37:42+00','outbound','https://www.linkedin.com/in/darryl-stallworth-24520775','darryl stallworth','I am as well!  Thank you Darryl!',NULL,'INBOX'),
('export:2-MzU3MzczODEtODEwZi00OTI1LWI1ODQtN2Y5NDAyNDczMzA3XzAxMA==:20231208T15095:a7075d11','2-MzU3MzczODEtODEwZi00OTI1LWI1ODQtN2Y5NDAyNDczMzA3XzAxMA==','2023-12-08T15:09:54+00','inbound','https://www.linkedin.com/in/darryl-stallworth-24520775','darryl stallworth','I''m happy to connect',NULL,'INBOX'),
('export:2-MzU3MzczODEtODEwZi00OTI1LWI1ODQtN2Y5NDAyNDczMzA3XzAxMA==:20231208T15004:da190a07','2-MzU3MzczODEtODEwZi00OTI1LWI1ODQtN2Y5NDAyNDczMzA3XzAxMA==','2023-12-08T15:00:42+00','outbound','https://www.linkedin.com/in/darryl-stallworth-24520775','darryl stallworth','Hi Darryl!  Thank you for reaching out to connect!  I''d like to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YmU4MTc5OGYtNmE2MC00ODE0LWEwOWMtZWE3MmY3YTRjMGE4XzAxMA==:20231207T04293:2c07bacb','2-YmU4MTc5OGYtNmE2MC00ODE0LWEwOWMtZWE3MmY3YTRjMGE4XzAxMA==','2023-12-07T04:29:36+00','outbound','https://www.linkedin.com/in/dagmawi-asfaw-159433183','Dagmawi Asfaw','Hello Dagmawi, I''m Sean Klein from Klein Manufacturing LLC producing high quality phenolic scrapers in the USA for aircraft maintenance. I''d like to discuss how our scrapers can assist your maintenance operations.',NULL,'INBOX'),
('export:2-MjUzODc3YjItZjcwZC00ZGU0LTk5YzgtMDUwMTU1ZTRlOWIxXzAxMA==:20231206T00005:a6607b35','2-MjUzODc3YjItZjcwZC00ZGU0LTk5YzgtMDUwMTU1ZTRlOWIxXzAxMA==','2023-12-06T00:00:59+00','outbound','https://www.linkedin.com/in/jonathan-blaker10','Jonathan  Blaker','Hi Jonathan! I''d like to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Our scrapers are made to UAL standards from a high strength phenolic material and the handles are reinforced with hardened steel to resist shearing during use.  Our scrapers have been rigorously tested by Boeing for both durability and longevity, and far exceed their standards.  Our scrapers are competitively priced and are more durable than those from our competitors to help you increase productivity during aircraft maintenance. Are your maintenance technicians currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-MjUzODc3YjItZjcwZC00ZGU0LTk5YzgtMDUwMTU1ZTRlOWIxXzAxMA==:20231203T19263:6974d317','2-MjUzODc3YjItZjcwZC00ZGU0LTk5YzgtMDUwMTU1ZTRlOWIxXzAxMA==','2023-12-03T19:26:37+00','outbound','https://www.linkedin.com/in/jonathan-blaker10','Jonathan  Blaker','Hi Jonathan!  I''d like to connect with you and introduce myself and my company, Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==:20231205T23400:37cc903c','2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==','2023-12-05T23:40:06+00','outbound','https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan Dale','Hi Ahsan!  I hope you''re doing well!  Just following up with you on our conversation from last week about sampling some of our phenolic scrapers for aircraft maintenance.  Were you able to discuss with your boss and get approval to give our products a test?  I would love the opportunity to earn your business.  Please let me know when you can, thank you!',NULL,'INBOX'),
('export:2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==:20231130T18402:27401ee9','2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==','2023-11-30T18:40:24+00','outbound','https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan Dale','That sounds great, thank you so much, I appreciate the opportunity!  Looking forward to hearing back from you!  Thank you Ahsan!',NULL,'INBOX'),
('export:2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==:20231130T18384:9a2dbada','2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==','2023-11-30T18:38:44+00','inbound','https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan Dale','Interesting let me check with my boss and make sure it''s cool and I''ll get back to you either tonight or tomorrow',NULL,'INBOX'),
('export:2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==:20231130T18321:31801019','2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==','2023-11-30T18:32:11+00','outbound','https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan Dale','No problem, I appreciate your honesty!  Where do the scrapers typically break when you''re using them?  Does the handle shear off, or is the scraper edge breaking during use?

Our scrapers are made from a high strength phenolic material and the handles are reinforced with hardened steel to resist shearing off during use.  Our scrapers have been rigorously tested by Boeing for both durability and longevity, and far exceed their standards.  I believe our scrapers are far more durable than those from our competitors, and will help you increase productivity during aircraft maintenance.  

Would you be willing to test out some samples of our products?  We manufacture the phenolic scrapers in both a 6" and 11" version and I would love to send you some samples of our products for your use and review.  We are a local company based in Orangevale, CA and could have the samples sent out to you this afternoon.',NULL,'INBOX'),
('export:2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==:20231130T16153:ea14c870','2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==','2023-11-30T16:15:30+00','inbound','https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan Dale','And they are fine a bit easy to break but not much you can do there haha',NULL,'INBOX'),
('export:2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==:20231130T16150:c3f73648','2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==','2023-11-30T16:15:05+00','inbound','https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan Dale','I do not know to be honest with you',NULL,'INBOX'),
('export:2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==:20231128T15583:e725b454','2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==','2023-11-28T15:58:36+00','outbound','https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan Dale','Hi Ahsan.  That''s great to hear you''re already familiar with the product!  How are the ones Zenetex currently uses working out for you, and do you know where they are currently being purchased 
from?',NULL,'INBOX'),
('export:2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==:20231128T15545:10145bb1','2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==','2023-11-28T15:54:55+00','inbound','https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan Dale','And yes we do for various purposes',NULL,'INBOX'),
('export:2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==:20231128T15544:c4b532be','2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==','2023-11-28T15:54:43+00','inbound','https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan Dale','Hi Sean, nice to meet you',NULL,'INBOX'),
('export:2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==:20231128T15432:d8ddedff','2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==','2023-11-28T15:43:21+00','outbound','https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan Dale','Hi Ahsan, it''s nice to meet you. I wanted to introduce myself and my company, Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==:20231128T15394:13e773d2','2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==','2023-11-28T15:39:47+00','inbound','https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan Dale','How can I help you?',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==:20231128T15393:f538e24a','2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==','2023-11-28T15:39:33+00','outbound','https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan Dale','Hi Ahsan, I''m Sean Klein from Klein Manufacturing LLC, producing high quality phenolic scrapers for aircraft maintenance. I''d like to connect with you to discuss how we can elevate your operations',NULL,'INBOX'),
('export:2-MTE5NWExMzMtNGRjOC00ZmY2LWI1MDgtYTI3YjUzODJkYWYwXzAxMg==:20231205T02403:bb6ac86e','2-MTE5NWExMzMtNGRjOC00ZmY2LWI1MDgtYTI3YjUzODJkYWYwXzAxMg==','2023-12-05T02:40:37+00','outbound','https://www.linkedin.com/in/eric-vossler-5a72715a','Eric Vossler','Hi Eric! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers to UAL standards for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-NGJiYzFhYTAtMzZkYy00NDQ3LWEwNDQtN2U3Njk3ODk5YzRhXzAxMA==:20231202T21081:4e45f531','2-NGJiYzFhYTAtMzZkYy00NDQ3LWEwNDQtN2U3Njk3ODk5YzRhXzAxMA==','2023-12-02T21:08:19+00','outbound','https://www.linkedin.com/in/yonar-candelario-67b885113','Yonar Candelario','Hi Yonar! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers to UAL standards for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-OTJjZGM5ZjYtYmI2MS00ZjhhLTg5NGEtYTUyY2YxMTM5ODBiXzAxMA==:20231202T04083:2ba9c541','2-OTJjZGM5ZjYtYmI2MS00ZjhhLTg5NGEtYTUyY2YxMTM5ODBiXzAxMA==','2023-12-02T04:08:31+00','outbound','https://www.linkedin.com/in/mark-reyes-b199911b8','Mark Reyes','Hi Mark! I''d like to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Our scrapers are made from a high strength phenolic material and the handles are reinforced with hardened steel to resist shearing during use.  Our scrapers have been rigorously tested by Boeing for both durability and longevity, and far exceed their standards.  Our scrapers are competitively priced and are more durable than those from our competitors to help you increase productivity during aircraft maintenance. Are your maintenance technicians currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-OTJjZGM5ZjYtYmI2MS00ZjhhLTg5NGEtYTUyY2YxMTM5ODBiXzAxMA==:20231201T16021:6415fe54','2-OTJjZGM5ZjYtYmI2MS00ZjhhLTg5NGEtYTUyY2YxMTM5ODBiXzAxMA==','2023-12-01T16:02:19+00','outbound','https://www.linkedin.com/in/mark-reyes-b199911b8','Mark Reyes','Hi Mark! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers to UAL standards for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YjljMDM2MjItZTk3ZS00MDg3LWEyZDItOTYzMGFlNmIwZjc1XzAxMA==:20231202T04063:00e7f6d5','2-YjljMDM2MjItZTk3ZS00MDg3LWEyZDItOTYzMGFlNmIwZjc1XzAxMA==','2023-12-02T04:06:38+00','outbound','https://www.linkedin.com/in/eric-willis-27a563141','Eric Willis','Hi Eric! I''d like to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Our scrapers are made from a high strength phenolic material and the handles are reinforced with hardened steel to resist shearing during use.  Our scrapers have been rigorously tested by Boeing for both durability and longevity, and far exceed their standards.  Our scrapers are competitively priced and are more durable than those from our competitors to help you increase productivity during aircraft maintenance. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YjljMDM2MjItZTk3ZS00MDg3LWEyZDItOTYzMGFlNmIwZjc1XzAxMA==:20231201T05542:a651f5b7','2-YjljMDM2MjItZTk3ZS00MDg3LWEyZDItOTYzMGFlNmIwZjc1XzAxMA==','2023-12-01T05:54:28+00','outbound','https://www.linkedin.com/in/eric-willis-27a563141','Eric Willis','Hi Eric! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance at Frontier Airlines?',NULL,'INBOX'),
('export:2-NTkxNGVlZTUtOTBiMS00NmIzLTg2ZDYtZDQ1Y2I4NWZiZTlkXzAxMA==:20231201T11543:6415fe54','2-NTkxNGVlZTUtOTBiMS00NmIzLTg2ZDYtZDQ1Y2I4NWZiZTlkXzAxMA==','2023-12-01T11:54:34+00','outbound','https://www.linkedin.com/in/mark-ward-8a793955','Mark Ward','Hi Mark! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers to UAL standards for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YTE0ZTk3OWItNDgyMC00Njc4LWI1N2MtNTk2YzY5ZmM0ZmJiXzAxMw==:20231130T21104:f6d77968','2-YTE0ZTk3OWItNDgyMC00Njc4LWI1N2MtNTk2YzY5ZmM0ZmJiXzAxMw==','2023-11-30T21:10:42+00','outbound','https://www.linkedin.com/in/nikkolas-bott-henderson-30548367','Nikkolas Bott-Henderson','Hi Nikkolas!  It''s great to connect with you and I really appreciate you passing along my information to those in charge of purchasing!  I can best be reached on my cell phone, 916-671-4772, or by email: kleinmanufacturing@gmail.com

I''m glad you''re familiar with the phenolic scraper product!  Our scrapers are made in the USA, from a high strength phenolic material and the handles are reinforced with hardened steel to resist shearing off during use.  Our scrapers have been rigorously tested by Boeing for both durability and longevity, and far exceed their standards.  I believe our scrapers are far more durable than those from our competitors, and will help you increase productivity during aircraft maintenance.

Would you be interested in testing out some samples of our products?  We manufacture the phenolic scrapers in both a 6" and 11" version and I would love to send you some samples of our products for your use and review.',NULL,'INBOX'),
('export:2-YTE0ZTk3OWItNDgyMC00Njc4LWI1N2MtNTk2YzY5ZmM0ZmJiXzAxMw==:20231130T20504:67a21b82','2-YTE0ZTk3OWItNDgyMC00Njc4LWI1N2MtNTk2YzY5ZmM0ZmJiXzAxMw==','2023-11-30T20:50:48+00','inbound','https://www.linkedin.com/in/nikkolas-bott-henderson-30548367','Nikkolas Bott-Henderson','Hi Sean nice to speak with you. We use scrappers but I don''t have the authorization to make purchase orders for the company. I''ll gladly pass your info to the people in charge here that do.',NULL,'INBOX'),
('export:2-YTE0ZTk3OWItNDgyMC00Njc4LWI1N2MtNTk2YzY5ZmM0ZmJiXzAxMw==:20231129T23001:8fb7202c','2-YTE0ZTk3OWItNDgyMC00Njc4LWI1N2MtNTk2YzY5ZmM0ZmJiXzAxMw==','2023-11-29T23:00:18+00','outbound','https://www.linkedin.com/in/nikkolas-bott-henderson-30548367','Nikkolas Bott-Henderson','Hi Nikkolas, it''s nice to meet you. I wanted to introduce myself and my company, Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YTE0ZTk3OWItNDgyMC00Njc4LWI1N2MtNTk2YzY5ZmM0ZmJiXzAxMw==:20231128T22593:c32714fb','2-YTE0ZTk3OWItNDgyMC00Njc4LWI1N2MtNTk2YzY5ZmM0ZmJiXzAxMw==','2023-11-28T22:59:33+00','outbound','https://www.linkedin.com/in/nikkolas-bott-henderson-30548367','Nikkolas Bott-Henderson','Hi Nikkolas! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers to UAL standards for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-OTEyOGNhYzktMDZkOC00ZTZiLTlhYzAtY2NhZjJkZTRmZDIzXzAxMg==:20231129T23433:776d1236','2-OTEyOGNhYzktMDZkOC00ZTZiLTlhYzAtY2NhZjJkZTRmZDIzXzAxMg==','2023-11-29T23:43:35+00','inbound','https://www.linkedin.com/in/bretdeeb','Bret Deeb','No, thank you',NULL,'INBOX'),
('export:2-OTEyOGNhYzktMDZkOC00ZTZiLTlhYzAtY2NhZjJkZTRmZDIzXzAxMg==:20231129T22543:a59a3bda','2-OTEyOGNhYzktMDZkOC00ZTZiLTlhYzAtY2NhZjJkZTRmZDIzXzAxMg==','2023-11-29T22:54:37+00','outbound','https://www.linkedin.com/in/bretdeeb','Bret Deeb','Hi Bret, it''s nice to meet you. I wanted to introduce myself and my company, Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-OTEyOGNhYzktMDZkOC00ZTZiLTlhYzAtY2NhZjJkZTRmZDIzXzAxMg==:20231128T23003:5535e024','2-OTEyOGNhYzktMDZkOC00ZTZiLTlhYzAtY2NhZjJkZTRmZDIzXzAxMg==','2023-11-28T23:00:34+00','outbound','https://www.linkedin.com/in/bretdeeb','Bret Deeb','Hi Bret! I''d like to connect with you to introduce myself and my company Klein Manufacturing which specializes in manufacturing phenolic scrapers to UAL standards for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231129T19212:7220ff00','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-29T19:21:25+00','outbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','Hi Cory!  I hope you''re doing well today!  Just wanted to follow up with you to see if there''s a time that works for you tomorrow to meet.  Please let me know when you can, thank you!',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T17332:516a4741','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T17:33:20+00','outbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','No problem.  Yes, I''m available Thursday.  What time would work best for you?',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T17322:69612c12','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T17:32:29+00','inbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','I can''t make that time. How about Thursday?',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T17130:45719be8','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T17:13:04+00','outbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','I''m available anytime after 3pm this afternoon.',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T17115:546337eb','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T17:11:54+00','inbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','What time this afternoon?',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T17103:1e4ba498','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T17:10:39+00','outbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','I completely agree.  Are you available this afternoon, or another time this week?',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T17083:831479d6','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T17:08:33+00','inbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','Introductions are always good.',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T17060:04acfc02','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T17:06:09+00','outbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','That would be great!!  I would love that opportunity, thank you so much!  We manufacture the scrapers in 2 different lengths, 6" and 11" length.  Both sizes are for designed to be used with a .401" shank rivet gun or air hammer.   I can ship samples of both of them to you, or if you''re still local in Citrus Heights I could meet in person to introduce myself.  What would work better for you?',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T17031:36358590','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T17:03:12+00','inbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','I''m still in the field',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T17023:c7fddfd1','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T17:02:38+00','inbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','I can take some samples as well.',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T17013:afbc86eb','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T17:01:37+00','outbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','That''s exciting for the possibility to start a new career!  Would you be able to refer me to some of your connections who might be able to utilize our product?  I''d love the opportunity to send them some samples and earn their business.',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T16542:496b3cc6','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T16:54:22+00','inbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','I''m not sure if I''m going stay in that field but I have many contacts that are.',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T16433:adecdb08','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T16:43:35+00','outbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','That''s great to hear!  My company Klein Manufacturing is a local company based in Orangevale and we specialize in manufacturing phenolic scrapers for use in the aircraft maintenance industry.  I''m seeking to expand our business and find new clients who utilize this product.  Are you thinking your next career will still be in the aircraft maintenance industry?',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T16362:49091c47','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T16:36:27+00','inbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','We used them periodically if we had to remove sealants or other similar compounds.',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T16345:cae9cc45','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T16:34:57+00','outbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','Hi Cory!  That''s great to hear you''re already familiar with the product!  It looks like you''re retired from the Air Force, congratulations!!  How often did you use phenolic scrapers for maintenance operations?',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T16325:9b80734e','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T16:32:52+00','inbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','Hello Sean. Actually, yes we do.',NULL,'INBOX'),
('export:2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==:20231128T16321:863409dd','2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','2023-11-28T16:32:19+00','outbound','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','Hi Cory!  I''d like to connect with you and introduce myself and my company, Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-YWJjMjI3ZjUtZTFlYi00YTc5LWEwYmItNzBmMGQ5OWZkNmJkXzAxMA==:20231128T22294:a28fad09','2-YWJjMjI3ZjUtZTFlYi00YTc5LWEwYmItNzBmMGQ5OWZkNmJkXzAxMA==','2023-11-28T22:29:43+00','outbound','https://www.linkedin.com/in/fabian-g-2732a0119','Fabian Gonzales','Hi Fabian!  I understand, thank you for the info!  I''ve tried to get in contact with someone in purchasing at Lockheed to discuss our products, but I''ve had little luck.  Would you be able to point me in the right direction, or possibly refer me to someone I could discuss this with?  I appreciate any assistance you can give.  Thank you for your time!',NULL,'INBOX'),
('export:2-YWJjMjI3ZjUtZTFlYi00YTc5LWEwYmItNzBmMGQ5OWZkNmJkXzAxMA==:20231128T21352:723c5cb6','2-YWJjMjI3ZjUtZTFlYi00YTc5LWEwYmItNzBmMGQ5OWZkNmJkXzAxMA==','2023-11-28T21:35:25+00','inbound','https://www.linkedin.com/in/fabian-g-2732a0119','Fabian Gonzales','We use a mil standard that is provided by Lockheed. I wouldn''t be able to use anything else without engineering approval',NULL,'INBOX'),
('export:2-YWJjMjI3ZjUtZTFlYi00YTc5LWEwYmItNzBmMGQ5OWZkNmJkXzAxMA==:20231128T21323:c6cc9ccc','2-YWJjMjI3ZjUtZTFlYi00YTc5LWEwYmItNzBmMGQ5OWZkNmJkXzAxMA==','2023-11-28T21:32:35+00','outbound','https://www.linkedin.com/in/fabian-g-2732a0119','Fabian Gonzales','Hi Fabian! I''d like to introduce myself and my company Klein Manufacturing specializing in phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance? Brandon Holley referred me to you, I hope to connect soon!',NULL,'INBOX'),
('export:2-NTM4MWFlMDUtMGMxZS00YTY1LTg3MzUtZjNjOTRmN2I2OTM0XzAxMA==:20231128T18173:f254a1f8','2-NTM4MWFlMDUtMGMxZS00YTY1LTg3MzUtZjNjOTRmN2I2OTM0XzAxMA==','2023-11-28T18:17:36+00','outbound','https://www.linkedin.com/in/brandon-holley','Brandon Holley','Thank you for your time Brandon!',NULL,'INBOX'),
('export:2-NTM4MWFlMDUtMGMxZS00YTY1LTg3MzUtZjNjOTRmN2I2OTM0XzAxMA==:20231128T18134:cb38d7f0','2-NTM4MWFlMDUtMGMxZS00YTY1LTg3MzUtZjNjOTRmN2I2OTM0XzAxMA==','2023-11-28T18:13:48+00','outbound','https://www.linkedin.com/in/brandon-holley','Brandon Holley','Hi Brandon!  Thank you for the information, I really appreciate it!  I will reach out to Fabian, thank you!',NULL,'INBOX'),
('export:2-NTM4MWFlMDUtMGMxZS00YTY1LTg3MzUtZjNjOTRmN2I2OTM0XzAxMA==:20231128T18121:778e9d6d','2-NTM4MWFlMDUtMGMxZS00YTY1LTg3MzUtZjNjOTRmN2I2OTM0XzAxMA==','2023-11-28T18:12:11+00','inbound','https://www.linkedin.com/in/brandon-holley','Brandon Holley','I do not use them or purchase them for my company.  Fabian Gonzales is the e best contact for our operation.',NULL,'INBOX'),
('export:2-NTM4MWFlMDUtMGMxZS00YTY1LTg3MzUtZjNjOTRmN2I2OTM0XzAxMA==:20231128T18093:c65dff02','2-NTM4MWFlMDUtMGMxZS00YTY1LTg3MzUtZjNjOTRmN2I2OTM0XzAxMA==','2023-11-28T18:09:38+00','outbound','https://www.linkedin.com/in/brandon-holley','Brandon Holley','Hi Brandon!  I''d like to connect with you and introduce myself and my company, Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-MjQ1MThhY2UtZDQ5Zi00YzM3LWEzOGItOTViMGU1Y2JlZTg3XzAxMA==:20231128T17372:e9bf761b','2-MjQ1MThhY2UtZDQ5Zi00YzM3LWEzOGItOTViMGU1Y2JlZTg3XzAxMA==','2023-11-28T17:37:24+00','outbound','https://www.linkedin.com/in/terrance-walker-319770146','Terrance Walker','Ok, no problem.  My company Klein Manufacturing is a local company based in Orangevale and we specialize in manufacturing phenolic scrapers for use in the aircraft maintenance industry.  I''m seeking to expand our business and find new clients who utilize this product.  If you know anyone who could use our product, I would greatly appreciate a referral.  Thank you so much for your time Terrance!',NULL,'INBOX');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-MjQ1MThhY2UtZDQ5Zi00YzM3LWEzOGItOTViMGU1Y2JlZTg3XzAxMA==:20231128T17350:33441b57','2-MjQ1MThhY2UtZDQ5Zi00YzM3LWEzOGItOTViMGU1Y2JlZTg3XzAxMA==','2023-11-28T17:35:09+00','inbound','https://www.linkedin.com/in/terrance-walker-319770146','Terrance Walker','I''m sorry my brother, I do not',NULL,'INBOX'),
('export:2-MjQ1MThhY2UtZDQ5Zi00YzM3LWEzOGItOTViMGU1Y2JlZTg3XzAxMA==:20231128T17304:d5210ed1','2-MjQ1MThhY2UtZDQ5Zi00YzM3LWEzOGItOTViMGU1Y2JlZTg3XzAxMA==','2023-11-28T17:30:41+00','outbound','https://www.linkedin.com/in/terrance-walker-319770146','Terrance Walker','That''s great to hear you''re familiar with the product.  Do you know the name of the company that makes the ones the Air Force purchases?',NULL,'INBOX'),
('export:2-MjQ1MThhY2UtZDQ5Zi00YzM3LWEzOGItOTViMGU1Y2JlZTg3XzAxMA==:20231128T17165:93a31db6','2-MjQ1MThhY2UtZDQ5Zi00YzM3LWEzOGItOTViMGU1Y2JlZTg3XzAxMA==','2023-11-28T17:16:57+00','inbound','https://www.linkedin.com/in/terrance-walker-319770146','Terrance Walker','Occasionally, but I don''t pay for them',NULL,'INBOX'),
('export:2-MjQ1MThhY2UtZDQ5Zi00YzM3LWEzOGItOTViMGU1Y2JlZTg3XzAxMA==:20231128T17162:8a75c720','2-MjQ1MThhY2UtZDQ5Zi00YzM3LWEzOGItOTViMGU1Y2JlZTg3XzAxMA==','2023-11-28T17:16:21+00','outbound','https://www.linkedin.com/in/terrance-walker-319770146','Terrance Walker','Hi Terrance!  I''d like to connect with you and introduce myself and my company, Klein Manufacturing which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-NGQwYmE2NjUtZTU2MC00YzA3LTgzZjQtZWVlMjg2NTBjMjZlXzAxMA==:20231126T17203:48973819','2-NGQwYmE2NjUtZTU2MC00YzA3LTgzZjQtZWVlMjg2NTBjMjZlXzAxMA==','2023-11-26T17:20:31+00','outbound','https://www.linkedin.com/in/john-vanderbeck-872602176','John Vanderbeck','Hi John, it''s nice to meet you. I wanted to introduce myself and my company, Klein Manufacturing LLC which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for any exterior aircraft maintenance?',NULL,'INBOX'),
('export:2-ZjY5MGI0NjMtNmVkZS00YWE0LWIyMzMtMmE4MDEzYzcyZDcxXzAxMA==:20231121T16472:ec4ad82d','2-ZjY5MGI0NjMtNmVkZS00YWE0LWIyMzMtMmE4MDEzYzcyZDcxXzAxMA==','2023-11-21T16:47:24+00','outbound','https://www.linkedin.com/in/eric-swenson-19596b108','Eric Swenson','Hi Eric,

My name is Sean Klein and I want to introduce my company, Klein Manufacturing LLC, which specializes in manufacturing phenolic scrapers for use in the aircraft maintenance industry. Are you currently utilizing phenolic scrapers for aircraft maintenance?  I would love the opportunity to discuss how our products could assist you with aircraft maintenance.

Sean Klein
President
Klein Manufacturing, LLC','Phenolic Scrapers','INBOX'),
('export:2-NWZhYzA3NWYtYjYzYy00ZmJhLTkxN2QtY2NkMTJkNDI5NWY1XzAxMg==:20231121T03401:687ffb23','2-NWZhYzA3NWYtYjYzYy00ZmJhLTkxN2QtY2NkMTJkNDI5NWY1XzAxMg==','2023-11-21T03:40:12+00','outbound','https://www.linkedin.com/in/scott-mccool-b035b815','Scott McCool','Hello Scott,

I hope this message finds you well. As someone involved in aircraft maintenance, have you considered the benefits of utilizing phenolic scrapers? The innovative products produced by my company Klein Manufacturing LLC are engineered to elevate your maintenance experience. With a focus on durability and precision, our phenolic scrapers offer a superior solution for your daily tasks. Experience the difference – enhance efficiency, reliability, and longevity in your maintenance routine. Elevate your standards with our high-performance phenolic scrapers. Let''s ensure your aircraft maintenance reaches new heights together. Curious to witness the impact of our phenolic scrapers firsthand? We''d love to send you samples for a trial. Are you open to exploring how our products can revolutionize your aircraft maintenance routine? Please let me know, and I''ll ship them your way.

Thank you for your time. 

Sean Klein
President 
Klein Manufacturing, LLC
Kleinmanufacturing@gmail.com
916-671-4772','Phenolic Scrapers','INBOX'),
('export:2-MzUzZDNlZjEtZGQwYi00NTM1LThiMDItMzE3Y2VkMzNkN2JjXzEwMA==:20260519T05044:d46a8023','2-MzUzZDNlZjEtZGQwYi00NTM1LThiMDItMzE3Y2VkMzNkN2JjXzEwMA==','2026-05-19T05:04:43+00','inbound',NULL,'Sara Molina','Your background matches some of our paid board and advisory positions that we have been retained to do a search for and present candidates to. We would love to have a discussion with you! Please schedule a call at your earliest convenience. See calendar below.

https://calendly.com/boardsi/board-seat-inquiry-l34?month=2025-06',NULL,'ARCHIVE'),
('export:2-NWZkNjMyOTEtNDA5OC00ZDVlLWE3MWEtNmY5OTcwYmZmYjhiXzEwMA==:20260511T17114:318b19a5','2-NWZkNjMyOTEtNDA5OC00ZDVlLWE3MWEtNmY5OTcwYmZmYjhiXzEwMA==','2026-05-11T17:11:40+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''ve been monitoring your business''s progress, and it seems you might be looking to expand or add a new location to your portfolio.

There''s a reason industry-leading aerospace companies like GE Aerospace and TransDigm Group call Ohio home. They recognize that Ohio''s world-class talent, proximity to supply chains, and innovation ecosystem give them a competitive advantage.

Would you like to discuss how JobsOhio, Ohio''s private economic development corporation, can help you tap into Ohio''s sites, financial incentives, and skilled workforce?',NULL,'ARCHIVE'),
('export:2-MTI1MjkzZDktYTA5MS00ZTU5LWE5NDMtZGEyMjYyOThhY2JiXzEwMA==:20260504T14312:afa0fd23','2-MTI1MjkzZDktYTA5MS00ZTU5LWE5NDMtZGEyMjYyOThhY2JiXzEwMA==','2026-05-04T14:31:27+00','inbound',NULL,'Eric Hamberger','Hi Sean,

Driving revenue today goes beyond hitting targets. It is about building sustainable systems across sales, marketing, product, and customer success.

The Chief Revenue Officer Program from Wharton Executive Education helps you align teams, strengthen revenue strategy, and build scalable growth engines.

Are you equipped to operate at the level the modern CRO role now demands? Read more.

Best regards,
Eric Hamberger 
Managing Director, Wharton Online

Download the brochure to explore the program curriculum and admissions details',NULL,'ARCHIVE'),
('export:2-ODYyY2FkNmQtZjcyNC00YTVkLTk0ZWItYTQ5YWRlNTVmZTUxXzEwMA==:20260501T04193:d3567608','2-ODYyY2FkNmQtZjcyNC00YTVkLTk0ZWItYTQ5YWRlNTVmZTUxXzEwMA==','2026-05-01T04:19:35+00','inbound',NULL,'LinkedIn Member','Hi %FIRSTNAME%,

In the time it''s taken you to read this message — Hiring Assistant could have run dozens of searches to source hidden top talent, drafted personalized outreach, and kicked off prescreening. And you? You could be focusing on building real relationships and closing top talent. Interested in learning more?',NULL,'ARCHIVE'),
('export:2-MWMxYzM1YjMtZGE0Ni00NWU0LWFkYWItMTVlMzRiYjhmYjBmXzEwMA==:20260425T21145:d46a8023','2-MWMxYzM1YjMtZGE0Ni00NWU0LWFkYWItMTVlMzRiYjhmYjBmXzEwMA==','2026-04-25T21:14:53+00','inbound',NULL,'Lisa Williams','Your background matches some of our paid board and advisory positions that we have been retained to do a search for and present candidates to. We would love to have a discussion with you! Please schedule a call at your earliest convenience. See calendar below.

https://calendly.com/boardsi/board-seat-inquiry-l34?month=2025-06',NULL,'ARCHIVE'),
('export:2-ZGViMTc1M2UtNWMyYS00ZWRhLTk2Y2YtODBkZDQyZDcyOTZkXzEwMA==:20260418T05241:ca54527b','2-ZGViMTc1M2UtNWMyYS00ZWRhLTk2Y2YtODBkZDQyZDcyOTZkXzEwMA==','2026-04-18T05:24:18+00','inbound',NULL,'LinkedIn Member','Hey %FIRSTNAME%, many commercial contractors come to us when they''re ready to modernize how they run service, projects, or both in one platform.

BuildOps is an all-in-one operations platform built specifically for commercial contractors, connecting field and office in real time. From dispatch and maintenance to large construction jobs, we help teams work out of a single source of truth.

Where are you looking to improve first?',NULL,'ARCHIVE'),
('export:2-YTYwZWUyMGMtZDljMS00NjRiLWE3YzQtZDRlMmMwMDI5OTM3XzEwMA==:20260410T16495:07dd58d5','2-YTYwZWUyMGMtZDljMS00NjRiLWE3YzQtZDRlMmMwMDI5OTM3XzEwMA==','2026-04-10T16:49:57+00','inbound',NULL,'Keri Ribardiere','Hi Sean — I work with a select group of executives as their personal agent.

My job is simple — get you placed. Board seats, speaking engagements, investment opportunities, high-value networking connections.

You focus on your work. I handle making sure the right people know you exist.

I have availability for one more client this month. 20 minutes to see if you''re the right fit.',NULL,'ARCHIVE'),
('export:2-YmMzOWZiZTQtMmI0My00ZTk4LWExMzUtYzNjNGQyYzNkNTY4XzEwMA==:20260402T15400:17dbf9a5','2-YmMzOWZiZTQtMmI0My00ZTk4LWExMzUtYzNjNGQyYzNkNTY4XzEwMA==','2026-04-02T15:40:04+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''m Ian Andrew from JobsOhio – Ohio''s private economic development corporation. I''ve been monitoring your business''s progress, and it seems like you''re poised for growth.  

There''s a reason industry-leading advanced air mobility companies like Anduril Industries and Joby Aviation call Ohio home. They recognize that Ohio''s world-class talent, proximity to supply chains, and miles of testing infrastructure give them a competitive advantage. 

I''m curious, are you looking to expand or develop a new location strategy? If so, as JobsOhio''s Senior Manager of North American Business Development, I''m happy to work with you every step of the way.

Would you like to hear more about Ohio''s sites, financial incentives, and skilled workforce at no cost to you?',NULL,'ARCHIVE'),
('export:2-Yzg3MmFkYzktMjY4Yy00MjQ0LTgwYjgtZTRkZTA1ZWUwYWVhXzEwMA==:20260322T01240:3941cfd0','2-Yzg3MmFkYzktMjY4Yy00MjQ0LTgwYjgtZTRkZTA1ZWUwYWVhXzEwMA==','2026-03-22T01:24:04+00','inbound',NULL,'LinkedIn Member','Hi %FIRSTNAME%,

You''re 4x more likely to book a meeting with a warm introduction. Sales Navigator helps you uncover strategic "warm paths" including shared connections, past colleagues, and recent buyer activity within your target accounts.

Use these insights to personalize your outreach and secure the conversations that lead to growth. What''s your next move?',NULL,'ARCHIVE'),
('export:2-ODFmMWIxZjYtZGI3Yy00NDM4LWIzNjgtMGNkNjAxMGVlNmJhXzEwMA==:20260319T01195:24ef191f','2-ODFmMWIxZjYtZGI3Yy00NDM4LWIzNjgtMGNkNjAxMGVlNmJhXzEwMA==','2026-03-19T01:19:58+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''m Jordan Tyler from JobsOhio – Ohio''s private economic development corporation. I''ve been monitoring your business''s progress, and it seems like you''re poised for growth.  

There''s a reason industry-leading advanced air mobility companies like Anduril Industries and Joby Aviation call Ohio home. They recognize that Ohio''s world-class talent, proximity to supply chains, and miles of testing infrastructure give them a competitive advantage. 

I''m curious, are you looking to expand or develop a new location strategy? If so, as JobsOhio''s Manager of North American Business Development, I''m happy to work with you every step of the way.

Would you like to hear more about Ohio''s sites, financial incentives, and skilled workforce at no cost to you?',NULL,'ARCHIVE'),
('export:2-NGMxNzM1ZGItNmM3Ny00NGI5LWIyYzItMTY5NGI2NDAxYTU3XzEwMA==:20260310T21502:d9c32580','2-NGMxNzM1ZGItNmM3Ny00NGI5LWIyYzItMTY5NGI2NDAxYTU3XzEwMA==','2026-03-10T21:50:23+00','inbound',NULL,'Kristine McCarthy','Hello Sean,

We recently came across your profile and would like to invite you to apply for inclusion in the 2026 edition of Who''s Who in America!

There is no cost or obligation to be included in Who''s Who in America!

This is an Invitation- Only opportunity and inclusion is contingent upon verification and acceptance by the Marquis Submissions Department.

Marquis has been publishing the biographies of the world''s most influential professionals since 1898. Inclusion is considered by many to be the pinnacle of success!

We hope you''ll consider applying to be a part of this 125+ year long tradition!',NULL,'ARCHIVE'),
('export:2-NTUxZWNhYjktNjkxMy00Y2Y2LWFmYWItYWNjNGE3MTI1NWMyXzEwMA==:20260226T13243:ff375f2c','2-NTUxZWNhYjktNjkxMy00Y2Y2LWFmYWItYWNjNGE3MTI1NWMyXzEwMA==','2026-02-26T13:24:38+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''ve been monitoring your business''s progress, and it seems like you might be in the market to expand or add a new location to the portfolio.  

There''s a reason industry-leading advanced air mobility companies like Anduril Industries and Joby Aviation call Ohio home. They recognize that Ohio''s world-class talent, proximity to supply chains, and miles of testing infrastructure give them a competitive advantage. 

Would you like to discuss how JobsOhio, Ohio''s private economic development corporation, can help you tap into Ohio''s sites, financial incentives, and skilled workforce?',NULL,'ARCHIVE'),
('export:2-OTkwNzFmNDQtM2Q5YS00MmVhLTg5NTgtZWQ2NmI5NTUyMjhiXzEwMA==:20260210T22240:ff375f2c','2-OTkwNzFmNDQtM2Q5YS00MmVhLTg5NTgtZWQ2NmI5NTUyMjhiXzEwMA==','2026-02-10T22:24:02+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''ve been monitoring your business''s progress, and it seems like you might be in the market to expand or add a new location to the portfolio.  

There''s a reason industry-leading advanced air mobility companies like Anduril Industries and Joby Aviation call Ohio home. They recognize that Ohio''s world-class talent, proximity to supply chains, and miles of testing infrastructure give them a competitive advantage. 

Would you like to discuss how JobsOhio, Ohio''s private economic development corporation, can help you tap into Ohio''s sites, financial incentives, and skilled workforce?',NULL,'ARCHIVE');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-MDU1ZjJhY2MtOWRhMy00ZTgzLTlkODYtNjJlYTczYmI2YjdkXzEwMA==:20260129T18431:b570b5ee','2-MDU1ZjJhY2MtOWRhMy00ZTgzLTlkODYtNjJlYTczYmI2YjdkXzEwMA==','2026-01-29T18:43:10+00','inbound',NULL,'Richard Freishtat, Ph.D.','Hi Sean,  

The Duke General Management Program (Duke GMP) is an immersive 7-month multi-modular program designed for seasoned professionals and executives who are eager to elevate their managerial and leadership capabilities in order to thrive in the ever-evolving business landscape. 

The program is conducted by Fuqua''s distinguished faculty, renowned for their expertise and cutting-edge research in the domains of business management and leadership. The immersive curriculum equips you with strategic, managerial, and analytical competencies, ensuring you emerge as an influential leader, ready to tackle the challenges of the changing business world and drive long-term organizational success. 

Upon completing the Duke GMP, you will be positioned to become a strategic leader, equipped with cutting-edge management skills and leadership acumen to drive long-term organizational success and foster innovation in today''s dynamic, global corporate environment. 

Program Highlights:  
✅Credentials from a world-renowned business school   
✅A leading-edge curriculum focused on real-world application 
✅Capstone project to ground learnings in a real-world application 
✅Become a part of the Global Duke Executive Education Network 
   
Program Details: 
✅ Schedule: April, 2026 - Oct, 2026
✅ Format: Blended (Live online & Classroom sessions) 
✅ Location: Duke University Campus (Durham, N.C., USA) 

I''d like to personally invite you to apply to the program. I believe you can benefit significantly from the program and look forward to connecting with you to discuss further.',NULL,'ARCHIVE'),
('export:2-NGFiOTgyMDgtNTdmZi00ODUzLWIzYTUtOTU4YTY2NGNkNmFiXzEwMA==:20260121T21472:6acae1d4','2-NGFiOTgyMDgtNTdmZi00ODUzLWIzYTUtOTU4YTY2NGNkNmFiXzEwMA==','2026-01-21T21:47:22+00','inbound',NULL,'MIT Professional Education','Hi Sean,

Leading global organizations are seeking business and technology leaders who can employ a strategic perspective to drive business growth through the application of AI and ML. 
The "AI and ML: Leading Business Growth" program by MIT Professional Education is a comprehensive 21-week program led by MIT faculty. This action-learning-based live virtual program will not only prepare you to navigate a dynamic marketplace driven by AI and ML, but it will also help you ensure continued career progression.

While exploring the critical aspects of AI and ML, the program empowers you, as a business leader, to leverage the knowledge gained during the program to enhance efficiency, inform solution selection, facilitate implementation, manage risk, and drive business growth.

Here are some of the highlights of the program that make it a top choice for mid to senior-level managers and leaders across industries;

✅Action-learning-based live virtual program
✅Led by distinguished MIT faculty
✅Inclusion in the MIT Professional Education network
✅Peer group of global leaders and practitioners in the field of AI and ML
✅No-code approach

Program Details:
✅ Duration: 21 weeks
✅ Schedule: April, 2026 - Sept, 2026

We are currently accepting applications for the AI and ML: Leading Business Growth 2026 cohort. You can benefit significantly from this program and look forward to connecting with you to discuss your career growth in more detail.

Regards, 
Program Team at Great Learning 
The "AI and ML: Leading Business Growth" program 
By MIT Professional Education 
mitpe.aiml@mygreatlearning.com | +1 857 847 0617',NULL,'ARCHIVE'),
('export:2-YTNmNGE2MzEtZDk1ZC00YjVkLTg1MTUtZjgyYzNmNzFiNDkzXzEwMA==:20260113T21443:dce9ecbc','2-YTNmNGE2MzEtZDk1ZC00YjVkLTg1MTUtZjgyYzNmNzFiNDkzXzEwMA==','2026-01-13T21:44:33+00','inbound',NULL,'Swapnil Shinde','Hey Sean!

In just 30 minutes, you''ll learn why companies like yours trust Zeni''s AI bookkeeping platform with a dedicated finance team to accelerate growth. 💰

I''m the CEO & Co-founder of Zeni, where our vision is to fully automate bookkeeping for your business so you can save an average of 70 hours a month and increase the accuracy of your financial operations.

With a unique blend of AI, machine learning, and finance experts, Zeni acts as your internal finance team, scaling seamlessly with your company''s growth 🚀

We want to help you spend more time growing your business and less time on your bookkeeping!

Ready to transform your finances? Take a call with my team to see how Zeni can help.

Interested? 👇',NULL,'ARCHIVE'),
('export:2-ODJiOTM4NjctMGM3Yy00NzZmLWI5MDQtZmRiYjEzMGI5ZDk0XzEwMA==:20260105T18365:0c93fcd9','2-ODJiOTM4NjctMGM3Yy00NzZmLWI5MDQtZmRiYjEzMGI5ZDk0XzEwMA==','2026-01-05T18:36:52+00','inbound',NULL,'LinkedIn Member','Hi %FIRSTNAME% - do you have an interest in working with companies as an advisor or joining a few advisory boards?

My company AdvisoryCloud is working with 100''s of companies that are looking for executives to join their advisory boards - many of which are seeking expertise in the %INDUSTRY% industry.

Can I have my team send over a few advisory roles that could be good matches for you?',NULL,'ARCHIVE'),
('export:2-NGIwZTU3NjMtYmY1OS00MWZkLTlkNmUtMTM1MjE5YjI3OTE3XzEwMA==:20251130T17074:fe019ea8','2-NGIwZTU3NjMtYmY1OS00MWZkLTlkNmUtMTM1MjE5YjI3OTE3XzEwMA==','2025-11-30T17:07:42+00','inbound',NULL,'LinkedIn Member','Your background matches some of our paid board and advisory positions that we have been retained to do a search for and present candidates to. We would love to have a discussion with you! Please schedule a call at your earliest convenience. See calendar below.

https://calendly.com/boardsi/board-seat-inquiry-l34?month=2025-07',NULL,'ARCHIVE'),
('export:2-NDcyZjYxMDQtMmMxOC00NjY1LWEzYWYtZjg3NmY2MDBmOTllXzEwMA==:20251101T14500:afcb7208','2-NDcyZjYxMDQtMmMxOC00NjY1LWEzYWYtZjg3NmY2MDBmOTllXzEwMA==','2025-11-01T14:50:06+00','inbound',NULL,'LinkedIn Member','4/5 aviation companies are using the wrong operating system to run their business. Our 2-minute survey provides a FREE shortlist of the solutions that are purpose-built for your type of operations.
Hope this is helpful for you %FIRSTNAME%!',NULL,'ARCHIVE'),
('export:2-ZTE3YTQ3MDEtYTU5Ni00Y2NmLTkwMGQtZDVjZDg2ZWM0ODJhXzEwMA==:20251024T13155:24ef191f','2-ZTE3YTQ3MDEtYTU5Ni00Y2NmLTkwMGQtZDVjZDg2ZWM0ODJhXzEwMA==','2025-10-24T13:15:53+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''m Jordan Tyler from JobsOhio – Ohio''s private economic development corporation. I''ve been monitoring your business''s progress, and it seems like you''re poised for growth.  

There''s a reason industry-leading advanced air mobility companies like Anduril Industries and Joby Aviation call Ohio home. They recognize that Ohio''s world-class talent, proximity to supply chains, and miles of testing infrastructure give them a competitive advantage. 

I''m curious, are you looking to expand or develop a new location strategy? If so, as JobsOhio''s Manager of North American Business Development, I''m happy to work with you every step of the way.

Would you like to hear more about Ohio''s sites, financial incentives, and skilled workforce at no cost to you?',NULL,'ARCHIVE'),
('export:2-OTU5N2M3ODMtMWQwOC00OGI2LTg1NTUtYmNhM2E5MGQ2YzMzXzEwMA==:20251015T12104:1477fa0c','2-OTU5N2M3ODMtMWQwOC00OGI2LTg1NTUtYmNhM2E5MGQ2YzMzXzEwMA==','2025-10-15T12:10:45+00','inbound',NULL,'Brad Killaly','Hi Sean,

I''m Brad Killaly, faculty director of the Chief Data and AI Officer (CDAIO) Program from the Ross School of Business and Michigan Engineering Professional Education. I''m reaching out because your leadership background aligns well with our Chief Data and AI Officer (CDAIO) Program.

Designed for senior professionals leading AI and data initiatives, this program will help you develop the strategic mindset and technical skills to drive innovation, tackle C-suite challenges, and lead with impact in an increasingly AI-powered and digital business landscape. The program also empowers you to leverage emerging technologies, including generative AI, to improve operational efficiency and streamline business processes.

In this program, you will:
• Develop and implement scalable data and AI strategies aligned with business goals
• Integrate AI and analytics to improve decision-making, compliance, and efficiency
• Lead organizational digital transformation through hands-on learning and innovation labs

Program details:
• Format: On campus and live online
• Duration: 5 months
• Fee: US$16,000 (a program fee benefit is available for early applicants)
• Eligibility: Minimum of 10 years of work experience
• Networking: Five-day in-person immersion at the Ross School of Business and the University of Michigan College of Engineering campus in Ann Arbor, Michigan

Download the brochure today to explore the curriculum and admissions details.

Learn More ➔

Brad Killaly
Faculty Director
Chief Data and AI Officer (CDAIO) Program',NULL,'ARCHIVE'),
('export:2-YjVjZTk0ZjEtN2U4Mi00Nzk2LThlMTUtZDRmYjA4YTVkYWVmXzEwMA==:20251010T02090:c7b8a8cf','2-YjVjZTk0ZjEtN2U4Mi00Nzk2LThlMTUtZDRmYjA4YTVkYWVmXzEwMA==','2025-10-10T02:09:09+00','inbound',NULL,'LinkedIn Member','Hi %FIRSTNAME%,

You''re 4x more likely to book a meeting when a connection makes the intro. Sales Navigator helps you spot these Warm Paths into your accounts.

Start by searching for relevant leads or check Relationship Explorer to identify Warm Paths for already saved accounts.',NULL,'ARCHIVE'),
('export:2-ZTdhZmM4ZTEtYjFiYy00ZTlmLWFkYzMtNzFlNzM4YTAzNzBjXzEwMA==:20251006T14444:4f01ba0b','2-ZTdhZmM4ZTEtYjFiYy00ZTlmLWFkYzMtNzFlNzM4YTAzNzBjXzEwMA==','2025-10-06T14:44:40+00','inbound',NULL,'LinkedIn Member','Greetings %FIRSTNAME%,

As the Dean of Education at UMass Global, I''d like to invite you to apply for our Master''s in Teaching program. Based off your experience at %COMPANYNAME% I believe you''d excel with us. Are you ready to elevate your teaching career?

Our MAT options integrate a master''s degree with a teaching credential, recognized by the California Council on Teacher Credentialing, providing you with advanced tools and techniques for success in the classroom. This is the perfect moment to take on this challenge and move forward in your career.

Warm regards,

Lori Piowlski 
Dean of Education, UMass Global',NULL,'ARCHIVE'),
('export:2-MDI1M2I1MjEtM2Q1Yy00NDljLTgwNzMtN2QwNThjNGQ0OGI5XzEwMA==:20250929T14230:7d50cabc','2-MDI1M2I1MjEtM2Q1Yy00NDljLTgwNzMtN2QwNThjNGQ0OGI5XzEwMA==','2025-09-29T14:23:07+00','inbound',NULL,'Atlassian','Hi Sean,

We know getting a team organized and on the same page can be a full time job – likely on top of your other full time job. That''s why we recommend Confluence – to make teamwork actually feel like less work. With Confluence as your team''s home base, your team will be able to: 
Organize everything in one placeTurn conversation into actionBuild an open culture of teamworkAnd so much more

Just sign up for free, pick one of the customizable templates, and get started.',NULL,'ARCHIVE'),
('export:2-OWE2MjBjOTctZjczNS00OTg1LWFkZWMtZGQzYjkzOTAxYmY0XzEwMA==:20250917T15201:0341ddd0','2-OWE2MjBjOTctZjczNS00OTg1LWFkZWMtZGQzYjkzOTAxYmY0XzEwMA==','2025-09-17T15:20:12+00','inbound',NULL,'Grace Schenkelberg','Hi Sean,

Are you looking to optimize productivity, accelerate change management, and gain better financial visibility in your construction projects? Procore is the leading construction management platform that connects field and office teams to streamline processes and improve project outcomes.   

With Procore, you can:

Get real-time insights into labor costs to avoid overruns.   Reduce administrative burdens and improve change order processes.   Track project budgets and financial data in real time.   Reduce rework with access to up-to-date information and better team collaboration.   Simplify daily reporting and save time on administrative tasks.   

See how Procore can transform your projects. Request a demo today to learn more.',NULL,'ARCHIVE'),
('export:2-ZTIxODQ2ZTQtNWI4MS00MjU4LTlkNjItY2FjZjZkNmU5YmNmXzEwMA==:20250910T00090:4be3e714','2-ZTIxODQ2ZTQtNWI4MS00MjU4LTlkNjItY2FjZjZkNmU5YmNmXzEwMA==','2025-09-10T00:09:00+00','inbound',NULL,'Barbie Adler','Hello, Sean,

Are you selectively single? I''d love to introduce myself and Selective Search. My name is Barbie and I''m the Founder & President of Selective Search, the nation''s leading luxury matchmaking firm.

Our Meet Your Future® process is like executive search for your personal life. Fortune 500 strategies meet over 150 years of matchmaking magic. We''re talking a clear, six-step path to success, proven by over 4,000 couples in our premium membership service. This isn''t about endless dates; it''s about finding someone who matches your stride, in life and love. 

If you are looking for a committed relationship, we''d love to meet you. Just fill out the form and an associate of mine will reach out to connect and tell you more.

Best Regards,

Barbie Adler
Founder & President
Selective Search Matchmaking',NULL,'ARCHIVE'),
('export:2-MjdiNGRlZDQtOWUzMS00YWQ5LWI5NmYtYzA1ZTk4N2Q5MDYyXzEwMA==:20250902T11485:89882a23','2-MjdiNGRlZDQtOWUzMS00YWQ5LWI5NmYtYzA1ZTk4N2Q5MDYyXzEwMA==','2025-09-02T11:48:58+00','inbound',NULL,'Matthew Bjonerud','Hi Sean,

Raising debt capital?

We work with businesses similar to yours as your "fractional Capital Markets team" - focused on helping you with your ongoing capital raise efforts.

Open to doing something for Klein Manufacturing, LLC?',NULL,'ARCHIVE'),
('export:2-NDk3NGUwNDYtMmZhYy00MmNmLTg5MjgtOWI4NWEzNjFjZDZmXzEwMA==:20250825T12503:24ef191f','2-NDk3NGUwNDYtMmZhYy00MmNmLTg5MjgtOWI4NWEzNjFjZDZmXzEwMA==','2025-08-25T12:50:33+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''m Jordan Tyler from JobsOhio – Ohio''s private economic development corporation. I''ve been monitoring your business''s progress, and it seems like you''re poised for growth.  

There''s a reason industry-leading advanced air mobility companies like Anduril Industries and Joby Aviation call Ohio home. They recognize that Ohio''s world-class talent, proximity to supply chains, and miles of testing infrastructure give them a competitive advantage. 

I''m curious, are you looking to expand or develop a new location strategy? If so, as JobsOhio''s Manager of North American Business Development, I''m happy to work with you every step of the way.

Would you like to hear more about Ohio''s sites, financial incentives, and skilled workforce at no cost to you?',NULL,'ARCHIVE'),
('export:2-Y2ViMmJhY2ItOGZmNi00YWY4LTlhMTYtYWY0N2ExMzMxMzRhXzEwMA==:20250819T18172:29061532','2-Y2ViMmJhY2ItOGZmNi00YWY4LTlhMTYtYWY0N2ExMzMxMzRhXzEwMA==','2025-08-19T18:17:23+00','inbound',NULL,'LinkedIn Talent Solutions','Hi Sean,

Hiring when you''ve got a full plate is hard. Unless you''re using LinkedIn Jobs. It''s easy, fast, and cost-effective. And it helps you reach a larger pool of professionals you won''t find anywhere else. Because the key to hiring great talent is having the right tools to reach the right people.

With LinkedIn Jobs you can:

Discover unique talent: Reach active and passive job seekers and access a larger pool of qualified candidatesPost and match effortlessly: Post a job with help from AI and we''ll automatically match it to the right peopleManage your budget with flexibility: Post a job for free or set a budget, edit the spend and close your job anytimeSpeed up the hiring process: Pay to promote your job and get 3x more qualified applicants

Try it out today.',NULL,'ARCHIVE'),
('export:2-YmQyMjE2YzEtNTA5Mi00Zjk3LThiMmItMmE5Njc2MWJkODFhXzEwMA==:20250813T04435:17dbf9a5','2-YmQyMjE2YzEtNTA5Mi00Zjk3LThiMmItMmE5Njc2MWJkODFhXzEwMA==','2025-08-13T04:43:53+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''m Ian Andrew from JobsOhio – Ohio''s private economic development corporation. I''ve been monitoring your business''s progress, and it seems like you''re poised for growth.  

There''s a reason industry-leading advanced air mobility companies like Anduril Industries and Joby Aviation call Ohio home. They recognize that Ohio''s world-class talent, proximity to supply chains, and miles of testing infrastructure give them a competitive advantage. 

I''m curious, are you looking to expand or develop a new location strategy? If so, as JobsOhio''s Senior Manager of North American Business Development, I''m happy to work with you every step of the way.

Would you like to hear more about Ohio''s sites, financial incentives, and skilled workforce at no cost to you?',NULL,'ARCHIVE'),
('export:2-YWVmYzliMTAtNmNmZS00MTkwLTlmNDItMzU1YjE0MGVkMTNjXzEwMA==:20250806T00424:7b8047cc','2-YWVmYzliMTAtNmNmZS00MTkwLTlmNDItMzU1YjE0MGVkMTNjXzEwMA==','2025-08-06T00:42:45+00','inbound',NULL,'LinkedIn Member','Hi %FIRSTNAME%! We can help you find Vietmam suppliers of your products to save tariffs from China and as a Plan B supply chain in Asia.

Do you want to try our free sourcing service?
We will seal NDA before you send your projects.

We thought you''d be interested in downloading our presentation. Interested?',NULL,'ARCHIVE'),
('export:2-MmFiNjEyODAtZDljYy00NGFiLTg2NmEtYTAzMTA3ODU1Nzg4XzEwMA==:20250729T22011:d46a8023','2-MmFiNjEyODAtZDljYy00NGFiLTg2NmEtYTAzMTA3ODU1Nzg4XzEwMA==','2025-07-29T22:01:18+00','inbound',NULL,'LinkedIn Member','Your background matches some of our paid board and advisory positions that we have been retained to do a search for and present candidates to. We would love to have a discussion with you! Please schedule a call at your earliest convenience. See calendar below.

https://calendly.com/boardsi/board-seat-inquiry-l34?month=2025-06',NULL,'ARCHIVE'),
('export:2-NWE5NjgwNGQtYmVkNy00NTY3LWEwOWYtZGE5NGM0OWRiOTI4XzEwMA==:20250722T19544:24ef191f','2-NWE5NjgwNGQtYmVkNy00NTY3LWEwOWYtZGE5NGM0OWRiOTI4XzEwMA==','2025-07-22T19:54:49+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''m Jordan Tyler from JobsOhio – Ohio''s private economic development corporation. I''ve been monitoring your business''s progress, and it seems like you''re poised for growth.  

There''s a reason industry-leading advanced air mobility companies like Anduril Industries and Joby Aviation call Ohio home. They recognize that Ohio''s world-class talent, proximity to supply chains, and miles of testing infrastructure give them a competitive advantage. 

I''m curious, are you looking to expand or develop a new location strategy? If so, as JobsOhio''s Manager of North American Business Development, I''m happy to work with you every step of the way.

Would you like to hear more about Ohio''s sites, financial incentives, and skilled workforce at no cost to you?',NULL,'ARCHIVE');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-OTI5NGFiNWYtMDhlYy00NDc4LWJmN2YtNTI4MDZhMzM3M2EwXzEwMA==:20250715T00164:283682a6','2-OTI5NGFiNWYtMDhlYy00NDc4LWJmN2YtNTI4MDZhMzM3M2EwXzEwMA==','2025-07-15T00:16:44+00','inbound',NULL,'Kristine McCarthy','Hello Sean,

We recently came across your profile and would like to invite you to apply for inclusion in the 2025 edition of Who''s Who in America!

There is no cost or obligation to be included in Who''s Who in America!

This is an Invitation- Only opportunity and inclusion is contingent upon verification and acceptance by the Marquis Submissions Department.

Marquis has been publishing the biographies of the world''s most influential professionals since 1898. Inclusion is considered by many to be the pinnacle of success!

We hope you''ll consider applying to be a part of this 125-year long tradition!',NULL,'ARCHIVE'),
('export:2-OGU3OThlOWEtZWU1OS00NjYyLWIwMWUtNWU0NTE4MDE5ZjMwXzEwMA==:20250707T23403:49bd16bb','2-OGU3OThlOWEtZWU1OS00NjYyLWIwMWUtNWU0NTE4MDE5ZjMwXzEwMA==','2025-07-07T23:40:36+00','inbound',NULL,'LinkedIn Member','Hi %FIRSTNAME% - do you have an interest in working with companies as an advisor or joining a few advisory boards?

My company AdvisoryCloud is working with 100''s of companies that are looking for executives to join their advisory boards - many of which are seeking expertise in the %INDUSTRY% industry.

Would you be interested in seeing a few advisory board roles that align with your expertise?',NULL,'ARCHIVE'),
('export:2-ZWQwMjZjMmQtMjFhMS00NzY1LTk1M2EtYTZlYjQyZTBlNTYzXzEwMA==:20250629T03001:e2f18771','2-ZWQwMjZjMmQtMjFhMS00NzY1LTk1M2EtYTZlYjQyZTBlNTYzXzEwMA==','2025-06-29T03:00:15+00','inbound',NULL,'LinkedIn Member','Hi %FIRSTNAME%! 👋

29 minutes, a $250 Amazon gift card & more importantly, you''ll see how leaders like you at %COMPANYNAME% are expanding into Mexico without the red tape or risk of setting up a legal entity.

I''m the President of Tetakawi, the largest shelter services provider in Mexico. We''ve helped 75+ fast-growing manufacturers reduce costs by 35%, bypass CapEx mistakes, and launch fully compliant plants in under 90 days.

Curious how we do it? Have a quick consultation call with one of our experts, and I''ll send you a $250 Amazon gift card.👇',NULL,'ARCHIVE'),
('export:2-MTY2ZDY4NDYtMjc2YS00M2ZmLWJjNGYtM2IxMDVmM2U2Y2Y5XzEwMA==:20250625T12573:29061532','2-MTY2ZDY4NDYtMjc2YS00M2ZmLWJjNGYtM2IxMDVmM2U2Y2Y5XzEwMA==','2025-06-25T12:57:36+00','inbound',NULL,'LinkedIn Talent Solutions','Hi Sean,

Hiring when you''ve got a full plate is hard. Unless you''re using LinkedIn Jobs. It''s easy, fast, and cost-effective. And it helps you reach a larger pool of professionals you won''t find anywhere else. Because the key to hiring great talent is having the right tools to reach the right people.

With LinkedIn Jobs you can:

Discover unique talent: Reach active and passive job seekers and access a larger pool of qualified candidatesPost and match effortlessly: Post a job with help from AI and we''ll automatically match it to the right peopleManage your budget with flexibility: Post a job for free or set a budget, edit the spend and close your job anytimeSpeed up the hiring process: Pay to promote your job and get 3x more qualified applicants

Try it out today.',NULL,'ARCHIVE'),
('export:2-ZTUzYWU5MGUtNzVjYy00NGJmLWFjZjgtMDJkMmNlMWQ4ZjMxXzEwMA==:20250612T03015:fa92595f','2-ZTUzYWU5MGUtNzVjYy00NGJmLWFjZjgtMDJkMmNlMWQ4ZjMxXzEwMA==','2025-06-12T03:01:59+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''m Charlie Rowell from JobsOhio – Ohio''s private economic development corporation. I''ve been monitoring your business''s progress, and it seems like you''re poised for growth.  

There''s a reason industry-leading advanced air mobility companies like Anduril Industries and Joby Aviation call Ohio home. They recognize that Ohio''s world-class talent, proximity to supply chains, and miles of testing infrastructure give them a competitive advantage. 

I''m curious, are you looking to expand or develop a new location strategy? If so, as JobsOhio''s Senior Director of North American Business Development, I''m happy to work with you every step of the way.

Would you like to hear more about Ohio''s sites, financial incentives, and skilled workforce at no cost to you?',NULL,'ARCHIVE'),
('export:2-OTQxN2YwNWQtNzFkMi00NmVmLWE2ZmEtOTRjMzU2YzIxMDBiXzEwMA==:20250603T02384:05d3c9a7','2-OTQxN2YwNWQtNzFkMi00NmVmLWE2ZmEtOTRjMzU2YzIxMDBiXzEwMA==','2025-06-03T02:38:46+00','inbound',NULL,'LinkedIn Member','Hi %FIRSTNAME%!

The University of Arizona Online offers students an exciting experience that sets them up for future success. After viewing your profile, we think you''d make a great fit for the Eller College of Management''s online Business Administration program. With an emphasis on innovation and a foundation of critical thinking, our degree focuses on instilling our students with the skills they need for success after graduation. Would you like to learn more about the program?',NULL,'ARCHIVE'),
('export:2-YjJjYTNjMGUtM2NlYy00NjdlLWEwZDMtMWNlZWYwZGE2ZWU2XzEwMA==:20250520T02543:8a04ae98','2-YjJjYTNjMGUtM2NlYy00NjdlLWEwZDMtMWNlZWYwZGE2ZWU2XzEwMA==','2025-05-20T02:54:39+00','inbound',NULL,'LinkedIn Member','Hi %FIRSTNAME%,

My name is Adam Witty — I''m the CEO & Founder of Forbes Books. Created from a partnership between Forbes and Advantage-The Authority Company. Forbes Books serves as the exclusive book publisher of Forbes.

We think your achievements and level of success could make you an ideal candidate to publish a book with us.

Are you interested in building your authority by becoming a published author with the world''s largest business brand?',NULL,'ARCHIVE'),
('export:2-OGJhNTI5MGQtODI5Zi00NDUzLWI5NDgtYTM5NmUzNzg4NDk4XzEwMA==:20250512T23031:17dbf9a5','2-OGJhNTI5MGQtODI5Zi00NDUzLWI5NDgtYTM5NmUzNzg4NDk4XzEwMA==','2025-05-12T23:03:19+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''m Ian Andrew from JobsOhio – Ohio''s private economic development corporation. I''ve been monitoring your business''s progress, and it seems like you''re poised for growth.  

There''s a reason industry-leading advanced air mobility companies like Anduril Industries and Joby Aviation call Ohio home. They recognize that Ohio''s world-class talent, proximity to supply chains, and miles of testing infrastructure give them a competitive advantage. 

I''m curious, are you looking to expand or develop a new location strategy? If so, as JobsOhio''s Senior Manager of North American Business Development, I''m happy to work with you every step of the way.

Would you like to hear more about Ohio''s sites, financial incentives, and skilled workforce at no cost to you?',NULL,'ARCHIVE'),
('export:2-MzRhMTU3YjctZGQ4Zi00ZTcyLTgwNmItYzdjOTg0MjJkMGZhXzEwMA==:20250425T04284:271e674f','2-MzRhMTU3YjctZGQ4Zi00ZTcyLTgwNmItYzdjOTg0MjJkMGZhXzEwMA==','2025-04-25T04:28:45+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

We recently came across your profile and would like to invite you to apply for inclusion in the 2025 edition of Who''s Who in America!

There is no cost or obligation to be included in Who''s Who in America!

This is an Invitation- Only opportunity and inclusion is contingent upon verification and acceptance by the Marquis Submissions Department.

Marquis has been publishing the biographies of the world''s most influential professionals since 1898. Inclusion is considered by many to be the pinnacle of success!

I would like to send you an application. Would you be interested in applying?',NULL,'ARCHIVE'),
('export:2-NTI0NTkzMTgtYmU4Ni00Njg0LWE0MmUtNjUyMWNmODEwMDg5XzEwMA==:20250414T18332:f3f9946b','2-NTI0NTkzMTgtYmU4Ni00Njg0LWE0MmUtNjUyMWNmODEwMDg5XzEwMA==','2025-04-14T18:33:24+00','inbound',NULL,'Ellen Trader','Dear Sean,

I''m Ellen Trader, Vice President of Growth at Berkeley Executive Education. As a leader at Klein Manufacturing, LLC, you can gain valuable insights from our Chief Executive Officer (CEO) Program designed to equip senior executives like you with the strategic mindset and leadership skills to drive transformation and lead with confidence in today''s evolving business landscape.

Key highlights of the program include:

Immersive Learning: Participate in live online sessions and two in-person modules at the UC Berkeley campus in California, focusing on strategy, leadership, and innovation.Capstone Strategy Project: Apply program insights to address a real-world leadership challenge.Global Leadership Campus Immersion: Engage with a diverse cohort of executives during a three-day Global Leadership Campus Immersion at UC Berkeley campus in California.Alumni Benefits: Join a global network of 41,000+ Berkeley Haas alumni with access to select exclusive resources.Discover how this program can elevate your leadership by downloading the brochure today.

Best regards,
Ellen Trader

DOWNLOAD BROCHURE',NULL,'ARCHIVE'),
('export:2-MmUwYzM5Y2YtYTNjMi00ODExLWIxMjUtNjU5NjhlMGZmZmFhXzEwMA==:20250403T22265:0089fab5','2-MmUwYzM5Y2YtYTNjMi00ODExLWIxMjUtNjU5NjhlMGZmZmFhXzEwMA==','2025-04-03T22:26:51+00','inbound',NULL,'Nick Baum','Hi Sean,

How does a $100 gift card sound? 😊

Does Klein Manufacturing, LLC send gift cards and other incentives or rewards?

Tremendous is a free rewards platform that helps businesses like Google and Purple Mattress send rewards– quickly, globally, and at no cost!

See how easy it is with a quick demo, and we''ll send you a $100 gift card to try it out!

(Your business should plan to send $10K+ in rewards annually to qualify for the gift card.)
Interested?

Kind regards,
Dana',NULL,'ARCHIVE'),
('export:2-MTBlZTA1MzUtYmExMS00NzY5LTk0MzctNjUwY2M3Yzk2YmY3XzEwMA==:20250320T15102:ff19c367','2-MTBlZTA1MzUtYmExMS00NzY5LTk0MzctNjUwY2M3Yzk2YmY3XzEwMA==','2025-03-20T15:10:21+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

We specialize in assisting companies like yours in expanding their operations by considering Ohio as their next strategic location.

At JobsOhio, we offer a range of services that come at no cost to you, prioritizing confidentiality and aligning with your business objectives. We provide support ranging from market insights to site selection, talent solutions, and incentives. Our commitment at JobsOhio is to ensure the success of your business expansion. Our team of seasoned experts is dedicated to guiding you through every phase of the process, starting from initial planning all the way to seamless implementation.

With our assistance, you can rest assured that your business will flourish in Ohio. To learn more and determine if Ohio is the right choice for your business, please sign up below.',NULL,'ARCHIVE'),
('export:2-MjdhMjY4MTgtMmYxNC00YzIyLWFlNWUtNjEzNGVkZjRlNDgyXzEwMA==:20250311T14483:271e674f','2-MjdhMjY4MTgtMmYxNC00YzIyLWFlNWUtNjEzNGVkZjRlNDgyXzEwMA==','2025-03-11T14:48:35+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

We recently came across your profile and would like to invite you to apply for inclusion in the 2025 edition of Who''s Who in America!

There is no cost or obligation to be included in Who''s Who in America!

This is an Invitation- Only opportunity and inclusion is contingent upon verification and acceptance by the Marquis Submissions Department.

Marquis has been publishing the biographies of the world''s most influential professionals since 1898. Inclusion is considered by many to be the pinnacle of success!

I would like to send you an application. Would you be interested in applying?',NULL,'ARCHIVE'),
('export:2-ZDRjMzM4ZTctMzc1My00ZDZhLTg2MGQtOTVhODQ3YjgyNWUwXzEwMA==:20250228T04064:b0b3bce9','2-ZDRjMzM4ZTctMzc1My00ZDZhLTg2MGQtOTVhODQ3YjgyNWUwXzEwMA==','2025-02-28T04:06:43+00','inbound',NULL,'MIT Professional Education','Hi Sean,

Leading global organizations are on the lookout for business and technology leaders who can employ a strategic perspective to drive business growth with the application of AI and ML.
The "AI and ML: Leading Business Growth" program by MIT Professional Education is a comprehensive 20-weeks program led by MIT faculty. This action-learning-based live online program will not only prepare you to navigate a dynamic marketplace that is driven by AI and ML, but it will also help you ensure continued career progression.

While you explore the critical aspects of AI and ML, the program''s focus is on empowering you, as a business leader, to leverage the knowledge you gain during the program to work on efficiency, solution selection, implementation, risk management, and the impact on driving business growth.

Here are some of the highlights of the program that make it a top choice for mid to senior level managers and leaders across industries;
✅ Action-learning-based live online program
✅ Led by distinguished MIT faculty
✅ Inclusion in the MIT Professional Education network
✅ Peer group of global leaders and practitioners in the field of AI and ML
✅ No-code approach

Program Details:
✅ Duration: 20 weeks
✅ Schedule: April, 2025 - Sept, 2025

We are currently accepting applications for the AI and ML: Leading Business Growth 2025 cohort. We believe that you can benefit significantly from this program and look forward to connecting with you to discuss your career growth further.

Regards,
AI and ML: Leading Business Growth Team',NULL,'ARCHIVE'),
('export:2-ZGE4ZWE1ZDItMDI5Mi00OTQ2LWFiZWQtM2Q2ZTVjZWY3MjkyXzEwMA==:20250212T01510:615fa420','2-ZGE4ZWE1ZDItMDI5Mi00OTQ2LWFiZWQtM2Q2ZTVjZWY3MjkyXzEwMA==','2025-02-12T01:51:03+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''m Ian Andrew, the Manager of North American Business Development for JobsOhio. We specialize in assisting companies like yours in expanding their operations by considering Ohio as their next strategic location.

At JobsOhio, we offer a range of services that come at no cost to you, prioritizing confidentiality and aligning with your business objectives. We provide support ranging from market insights to site selection, talent solutions, and incentives. Our commitment at JobsOhio is to ensure the success of your business expansion. Our team of seasoned experts is dedicated to guiding you through every phase of the process, starting from initial planning all the way to seamless implementation.

With our assistance, you can rest assured that your business will flourish in Ohio. To learn more and determine if Ohio is the right choice for your business, please sign up below.',NULL,'ARCHIVE'),
('export:2-OWY2NWMxMTQtZTFiZS00MzJmLWI1NWItZTA2NjhiYWMxMGQ5XzAxMA==:20250203T20512:0daf5ab3','2-OWY2NWMxMTQtZTFiZS00MzJmLWI1NWItZTA2NjhiYWMxMGQ5XzAxMA==','2025-02-03T20:51:29+00','inbound',NULL,'LinkedIn Member','Dear %FIRSTNAME%,

As a fellow LinkedIn Premium Member, I would like to personally invite you to join our exclusive community by gifting you a 12-Month Complimentary FoundersCard Membership.

With loyalty status upgrades, preferred Member rates, and hundreds of premier travel, business, and lifestyle perks, professionals can elevate their experiences and save resources.

Make sure to take advantage of this offer by the end of February. I look forward to welcoming you to our Community.

Best Wishes,

Eric Kuhn',NULL,'ARCHIVE'),
('export:2-OTgwNWZiZGItYmM5Yi00ZDM3LTgyMmMtZGFhOTViYjA1ZmVlXzAxMA==:20241220T14482:10336310','2-OTgwNWZiZGItYmM5Yi00ZDM3LTgyMmMtZGFhOTViYjA1ZmVlXzAxMA==','2024-12-20T14:48:21+00','inbound',NULL,'LinkedIn Member','Dear %FIRSTNAME%,

As a fellow LinkedIn Premium Member, I would like to personally invite you to join our exclusive community by gifting you a 12-Month Complimentary FoundersCard Membership.

With loyalty status upgrades, preferred Member rates, and hundreds of premier travel, business, and lifestyle perks, professionals can elevate their experiences and save resources.

Make sure to take advantage of this offer by the end of December. I look forward to welcoming you to our Community.

Best Wishes,

Eric Kuhn',NULL,'ARCHIVE'),
('export:2-M2Q1ZjEzMmMtYWI0Zi00ODc3LWIxM2UtYjM3OGIwYWY5ZmIyXzAxMA==:20241211T20322:6079eb06','2-M2Q1ZjEzMmMtYWI0Zi00ODc3LWIxM2UtYjM3OGIwYWY5ZmIyXzAxMA==','2024-12-11T20:32:20+00','inbound',NULL,'LinkedIn Member','Hi %FIRSTNAME% - do you have an interest in working with companies as an advisor or joining a few advisory boards?

My company AdvisoryCloud is working with 100''s of companies that are looking for executives to join their advisory boards - many of which are seeking expertise in the %INDUSTRY% industry.

Can I send over a few opportunities that might align with your expertise?',NULL,'ARCHIVE'),
('export:2-N2M3ZTVmYjItNjM2Ni00ZWRiLWJiMjMtYmQ2MWZlNWU2N2I1XzAxMA==:20241119T21174:116951f6','2-N2M3ZTVmYjItNjM2Ni00ZWRiLWJiMjMtYmQ2MWZlNWU2N2I1XzAxMA==','2024-11-19T21:17:40+00','inbound',NULL,'Aston Martin Lagonda Ltd','Compromise exists no more. The Aston Martin DBX707 melds supreme race car technology with quintessential British luxury.

I invite you to test drive the DBX707 and experience its unique qualities from the drivers seat.

Owning an Aston Martin is now closer than you think, with 2.99% APR financing for 72 months.*

Enquire below to arrange a test drive and discover the latest finance and lease offers.

Sincerely,

Pedro Mota
President of the Americas Aston Martin',NULL,'ARCHIVE'),
('export:2-NWFlNTFlZTctYTk0My00ZTIzLTlkY2QtYzlkNjAyNTNkYTRkXzAxMA==:20241105T13454:676f5735','2-NWFlNTFlZTctYTk0My00ZTIzLTlkY2QtYzlkNjAyNTNkYTRkXzAxMA==','2024-11-05T13:45:43+00','inbound',NULL,'LinkedIn Member','Dear %FIRSTNAME%,

As a fellow LinkedIn Premium Member, I would like to personally invite you to join our exclusive community by gifting you a 12-Month Complimentary FoundersCard Membership.

With loyalty status upgrades, preferred Member rates, and hundreds of premier travel, business, and lifestyle perks, professionals can elevate their experiences and save resources.

Make sure to take advantage of this offer by the end of November. I look forward to welcoming you to our Community.

Best Wishes,

Eric Kuhn',NULL,'ARCHIVE');
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-ZDJmMTVlODktMzdmYi00MWEwLTgzYWItNzNjNWVhODBhNmY0XzAxMg==:20240806T02175:ee732847','2-ZDJmMTVlODktMzdmYi00MWEwLTgzYWItNzNjNWVhODBhNmY0XzAxMg==','2024-08-06T02:17:55+00','inbound',NULL,'American Express Business','Dear Sean:

You''re invited to get the support and tools business leaders in today''s ever-evolving landscape can count on.

With the American Express® Corporate Program, you can:
Help streamline your business operations using customized tools that seamlessly integrate with your existing infrastructureAutomate your payments process with one platform1Access hands-on support and industry expertise every step of the wayWelcome to a better way to do business.',NULL,'ARCHIVE'),
('export:2-ZDdlNmU5ZTktNjYxYi00YzliLWIxZTEtNDdmYTRlMWZmOWYzXzAxMA==:20240702T23175:92fd890e','2-ZDdlNmU5ZTktNjYxYi00YzliLWIxZTEtNDdmYTRlMWZmOWYzXzAxMA==','2024-07-02T23:17:50+00','inbound',NULL,'American Express Business','As a key decision maker in today''s business world, you deserve a Corporate Card experience that delivers. As part of the American Express® family, you receive end-to-end support and access to a suite of customizable digital tools – helping you save valuable time and cost. 

Allow our dedicated team of Corporate Program Specialists to be your hands-on consultative partner – to offer reliable payment solutions, help you improve cash flow management, and ensure you unlock every perk to maximize your rewards.1',NULL,'ARCHIVE'),
('export:2-ZTYxN2QyMGMtOGIyOC00NDlkLTliZGQtZGY1ZDMzM2Y0Nzg5XzAxMA==:20240611T18440:81080c13','2-ZTYxN2QyMGMtOGIyOC00NDlkLTliZGQtZGY1ZDMzM2Y0Nzg5XzAxMA==','2024-06-11T18:44:08+00','inbound',NULL,'LinkedIn Member','Hi there, %FIRSTNAME%, achieve your personal and professional goals with LinkedIn Premium Perks, offering a range of complimentary additional benefits including:
6 months of Audible Plus4 months of Calm3 months of Microsoft 365up to 4 BetterHelp therapy sessionsAll included with your Premium subscriptions. Terms apply.',NULL,'ARCHIVE'),
('export:2-MTFkMGZmZjQtYTE2OS00N2U4LWE1MmEtNDFkNmI3Nzk1NDRlXzAxMA==:20240528T20142:615fa420','2-MTFkMGZmZjQtYTE2OS00N2U4LWE1MmEtNDFkNmI3Nzk1NDRlXzAxMA==','2024-05-28T20:14:27+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''m Ian Andrew, the Manager of North American Business Development for JobsOhio. We specialize in assisting companies like yours in expanding their operations by considering Ohio as their next strategic location.

At JobsOhio, we offer a range of services that come at no cost to you, prioritizing confidentiality and aligning with your business objectives. We provide support ranging from market insights to site selection, talent solutions, and incentives. Our commitment at JobsOhio is to ensure the success of your business expansion. Our team of seasoned experts is dedicated to guiding you through every phase of the process, starting from initial planning all the way to seamless implementation.

With our assistance, you can rest assured that your business will flourish in Ohio. To learn more and determine if Ohio is the right choice for your business, please sign up below.',NULL,'ARCHIVE'),
('export:2-NWQwNjdlMDEtNjFiNy00OTEyLWE0NDctMGZmZjZhZWVhZjQ1XzAxMA==:20240501T21532:7e42f8e9','2-NWQwNjdlMDEtNjFiNy00OTEyLWE0NDctMGZmZjZhZWVhZjQ1XzAxMA==','2024-05-01T21:53:24+00','inbound',NULL,'Marquis Who''s Who','Hello Sean,

We recently came across your profile and would like to invite you to apply for inclusion in the 2024 edition of Who''s Who in America!

There is no cost or obligation to be included in Who''s Who in America!

This is an Invitation- Only opportunity and inclusion is contingent upon verification and acceptance by the Marquis Submissions Department.

Marquis has been publishing the biographies of the world''s most influential professionals since 1898. Inclusion is considered by many to be the pinnacle of success!

We hope you''ll consider applying to be a part of this 125-year long tradition!',NULL,'ARCHIVE'),
('export:2-MzZjMTA1OTgtODZhOC00NzNjLWE5MzktMTFmYzI5YTE3N2RmXzAxMA==:20240415T20193:ca20b169','2-MzZjMTA1OTgtODZhOC00NzNjLWE5MzktMTFmYzI5YTE3N2RmXzAxMA==','2024-04-15T20:19:31+00','inbound',NULL,'Sarah Walz from LinkedIn','Hi Sean,

Businesses around the world are grappling with these challenging times. If hiring is a priority for your business, LinkedIn Jobs can help.

Why should you post a job on LinkedIn?

Our community is active and engaged: On LinkedIn, people are applying to the jobs they need.LinkedIn learns who''s right for your job: As people share and update their experience, skills, and aspirations.Get qualified applicants when you need them: LinkedIn encourages the right people to apply for your job.Post a job for free.

Sincerely,
Sarah from LinkedIn Jobs',NULL,'ARCHIVE'),
('export:2-MTMwYWQ4NDItY2FhYy00M2Y0LWE5OWMtZmRiOTQ1YzJkMjBkXzAxMA==:20240410T19444:0eeac8a3','2-MTMwYWQ4NDItY2FhYy00M2Y0LWE5OWMtZmRiOTQ1YzJkMjBkXzAxMA==','2024-04-10T19:44:43+00','inbound',NULL,'American Express Business','Close your books fast and stay ahead with the American Express® Corporate Program. Take advantage of our suite of automated solutions, such as AP Automation¹, American Express @Work®² and vPayment – that can help increase the speed and efficiency of your month-end close process. The Corporate Program can help your business save valuable time and cost by streamlining the payments reconciliation process, reducing everyday administrative tasks and offering easy payment visibility. Plus, you can choose between rewards³ programs based on your company''s needs. Are you interested in learning more?',NULL,'ARCHIVE'),
('export:2-ZmViYmI1ODQtMTc3Yi00Y2JmLWFlOTItYjBjZTFmMDhhMzBhXzAxMA==:20240326T21172:6348008f','2-ZmViYmI1ODQtMTc3Yi00Y2JmLWFlOTItYjBjZTFmMDhhMzBhXzAxMA==','2024-03-26T21:17:28+00','inbound',NULL,'LinkedIn Member','Hi %FIRSTNAME%!

Do you want to join the high-demand field of Business Analytics? University of the Pacific''s MS in Business Analytics program will get you career-ready in just 9 months.

Our flexible program features hybrid coursework including both online and on-campus classes, and includes an internship for entry level students. The best part is you can apply with a bachelor''s degree in ANY major!

Are you ready to join the future of business with Pacific? Choose an option below to continue.',NULL,'ARCHIVE'),
('export:2-NGRjMjU4OGMtMGI1Zi00OWM0LWFjN2MtY2E4MjJjZGVjNWUxXzAxMA==:20240313T17262:3a0454ab','2-NGRjMjU4OGMtMGI1Zi00OWM0LWFjN2MtY2E4MjJjZGVjNWUxXzAxMA==','2024-03-13T17:26:21+00','inbound',NULL,'LinkedIn Member','Dear %FIRSTNAME%,

I would like to personally invite you to join our exclusive community by activating a 12-Month Complimentary FoundersCard Membership.

FoundersCard has over 100,000 Members-- who access our portfolio of 500+ premier Travel, Business, and Lifestyle benefits to enjoy loyalty status upgrades and preferred Member pricing.

Make sure to take advantage of this offer by the end of March. I look forward to welcoming you to our Community.

Best Wishes,

Eric Kuhn',NULL,'ARCHIVE'),
('export:2-MzdkYzdkY2EtZWE3MS00MDllLTgwMmYtY2Y5M2JmZjU1NTgwXzAxMA==:20240229T21143:796db952','2-MzdkYzdkY2EtZWE3MS00MDllLTgwMmYtY2Y5M2JmZjU1NTgwXzAxMA==','2024-02-29T21:14:38+00','inbound',NULL,'Sarah Walz from LinkedIn','Dear Sean,

When you interview the right people, good things happen. That''s why LinkedIn Jobs helps you start more of those conversations worth having, sooner—with every job you post. 

Find the right people for free.Post a free job and tap into a network of over 770 million professionals. 

Prioritize the most qualified. Simple tools like screening questions and candidate rating help you quickly filter and prioritize who you should be talking to.

Choose who''s right for you.We can get you to the right people, but only you know the right choice for your business.

Post a free job

Sincerely,
Sarah from LinkedIn Jobs',NULL,'ARCHIVE'),
('export:2-N2MwMDMxNTYtMTcyNi00NmUzLThiMzgtYTljNDVlNDY5YWFlXzAxMA==:20240214T01501:6c86b0df','2-N2MwMDMxNTYtMTcyNi00NmUzLThiMzgtYTljNDVlNDY5YWFlXzAxMA==','2024-02-14T01:50:14+00','inbound',NULL,'LinkedIn Member','Dear %FIRSTNAME% %LASTNAME%,

I hope this email finds you well.

My name is Khalid Al Marzooqi, and I am the Vice President - International Business Development, of Khalifa Economic Zones Abu Dhabi (KEZAD). I am writing to you today to introduce the many possibilities that KEZAD offers for Polymers businesses.

KEZAD is the UAE''s largest provider of fully integrated economic zones and value-added business services, offering both mainland and free zone jurisdictions. KEZAD is also a key strategic enabler of Abu Dhabi''s vision for the diversification of its economy.

Here are just a few of the benefits that KEZAD can offer your business:

Access to a large and growing market: The GCC, MENA, and Sub-Saharan Africa are all growing markets with a large demand for Polymers products. KEZAD''s strategic location gives you access to these markets.

Raw material within KEZAD and available in the region : Abu Dhabi''s position as the key crude oil producer and petrochemical hub in the region supports the polymers conversion industry in the UAE. Major raw materials suppliers such as Borouge present in KEZAD offer competitive pricing and better credit terms for clients. This is added to the abundant supply of raw materials by other key providers in the GCC region.

Polymers-centric logistics and infrastructure: Specialised service providers present in KEZAD offer packaging, product handling and intermodal transportation of dry bulk products. KEZAD is also home to Borouge''s largest distribution centre in the MENA region which plays a critical role in improving operational efficiencies, by centralising and integrating the logistics operations.
They cater to the logistics requirements of dry petrochemical and mineral industries across the region and internationally.

Connectivity: Khalifa Port, one of the fastest growing mega ports in the world, and KEZAD jointly form a seamless port and industrial ecosystem. In addition to this, KEZAD also offers easy access to five international airports, and the national rail networks. This gives your business easy reach to markets all over the world.

Government support and incentives: Abu Dhabi is committed to supporting the growth of the Polymers industry. KEZAD offers several incentive programmes and partnerships to help these businesses succeed.

I would be happy to schedule a time to discuss your business goals in more detail and how KEZAD can help you achieve them. Please use the link below to contact us or to setup a time to talk further.

Thank you for your time.

Sincerely,
Khalid Al Marzooqi
Vice President - International Business Development
Khalifa Economic Zones Abu Dhabi - KEZAD Group
www.kezadgroup.com',NULL,'ARCHIVE'),
('export:2-M2IyNTNhYzktZTZjMS00YzFmLThkOGMtYzlmYjFjMDM2NTZlXzAxMA==:20240119T00185:73992f20','2-M2IyNTNhYzktZTZjMS00YzFmLThkOGMtYzlmYjFjMDM2NTZlXzAxMA==','2024-01-19T00:18:51+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

We recently came across your profile and would like to invite you to apply for inclusion in the 2024 edition of Who''s Who in America!

There is no cost or obligation to be included in Who''s Who in America!

This is an Invitation- Only opportunity and inclusion is contingent upon verification and acceptance by the Marquis Submissions Department.

Marquis has been publishing the biographies of the world''s most influential professionals since 1898. Inclusion is considered by many to be the pinnacle of success!

I would like to send you an application. Would you be interested in applying?',NULL,'ARCHIVE'),
('export:2-MTIyODQ0YmUtZWIxOC00NjNiLTg1YmEtZWI4ZTBjNzAwNzY2XzAxMA==:20240113T19212:796db952','2-MTIyODQ0YmUtZWIxOC00NjNiLTg1YmEtZWI4ZTBjNzAwNzY2XzAxMA==','2024-01-13T19:21:23+00','inbound',NULL,'Sarah Walz from LinkedIn','Dear Sean,

When you interview the right people, good things happen. That''s why LinkedIn Jobs helps you start more of those conversations worth having, sooner—with every job you post. 

Find the right people for free.Post a free job and tap into a network of over 770 million professionals. 

Prioritize the most qualified. Simple tools like screening questions and candidate rating help you quickly filter and prioritize who you should be talking to.

Choose who''s right for you.We can get you to the right people, but only you know the right choice for your business.

Post a free job

Sincerely,
Sarah from LinkedIn Jobs',NULL,'ARCHIVE'),
('export:2-OTUwY2NkNzgtN2JjMS00N2Y5LTg0YTAtMWQ5NjU2NTgxZGY3XzAxMA==:20231220T14321:d2245243','2-OTUwY2NkNzgtN2JjMS00N2Y5LTg0YTAtMWQ5NjU2NTgxZGY3XzAxMA==','2023-12-20T14:32:12+00','inbound',NULL,'LinkedIn Member','Hi %FIRSTNAME%, ready to reach your goals? The University of Arizona Global Campus is proud to offer 100% online master''s programs designed for busy professionals like you. Choose from career-relevant graduate degrees in business, health care, human services, IT, psychology, and more.',NULL,'ARCHIVE'),
('export:2-NTRjMmQxYzItNGNjNi00YmE4LTk2OWYtMWIxZmJiNjQyMTZkXzAxMg==:20231212T13231:18d272cb','2-NTRjMmQxYzItNGNjNi00YmE4LTk2OWYtMWIxZmJiNjQyMTZkXzAxMg==','2023-12-12T13:23:15+00','inbound',NULL,'LinkedIn Member','Hello %FIRSTNAME%,

I''m a Vice President of Franchise Development at a $4 billion home service franchise organization, Neighborly®. I''m reaching out because one of our brands, Mosquito Joe®, is expanding into your area. Your professional history is impressive and checks a lot of the boxes that I look for in a top-performing franchise owner—plus, you''re in a key market area for our growth.

Mosquito Joe is an award-winning outdoor pest control franchise. According to research firm IBISWorld, the nationwide outdoor pest control industry is projected to see compound annual growth of 4.6% through 2026 and is expected to top $26 billion—making our recession-resilient business model ideal for entrepreneurs itching to grow their own businesses. As a trusted brand, we help our franchisees stand out in a growing, needs-based industry.

We think you might be a great fit to own a Mosquito Joe franchise, but connect with a franchise advisor and download the free guide to see for yourself!

Pat Hyland, CFE
Vice President of Franchise Development',NULL,'ARCHIVE'),
('export:2-ODAxYWM2NWQtNzlkNS00ZGIzLTkxMTQtZTZlYTI2ZjYzN2Y3XzAxMA==:20231205T03133:b1b2e338','2-ODAxYWM2NWQtNzlkNS00ZGIzLTkxMTQtZTZlYTI2ZjYzN2Y3XzAxMA==','2023-12-05T03:13:32+00','inbound',NULL,'LinkedIn Member','We wanted to get in contact regarding some compensated advisory and formal boards we are recruiting for at the moment. Your background could be a good match for some of these boards. Free to schedule a call? 
See Calendar Below:
http://calendly.com/boardsi/board-seat-inquiry-nl',NULL,'ARCHIVE'),
('export:2-OGFlNmZlMmQtZWU0ZC00Y2Y1LTgwNWQtODNiZGE3MzFmMjJiXzAxMA==:20230905T14214:a8d3fda3','2-OGFlNmZlMmQtZWU0ZC00Y2Y1LTgwNWQtODNiZGE3MzFmMjJiXzAxMA==','2023-09-05T14:21:48+00','inbound',NULL,'LinkedIn Member','Hi there, %FIRSTNAME%! 

Are you exploring new job opportunities? Want to learn more about the job search tools available on LinkedIn?',NULL,'ARCHIVE'),
('export:2-ODY1ODUxNDEtNzM4Zi00OGJmLThlYzYtMzdhY2E5ZjMyNjI0XzAxMA==:20221028T16010:81ab06e0','2-ODY1ODUxNDEtNzM4Zi00OGJmLThlYzYtMzdhY2E5ZjMyNjI0XzAxMA==','2022-10-28T16:01:09+00','inbound',NULL,'LinkedIn Member','Hi %FIRSTNAME%, 
Thanks for being a valued member – we''re so glad you''re here. We''d like to offer you a 1-month free trial of LinkedIn Premium to help you uncover new opportunities.',NULL,'ARCHIVE'),
('export:2-ZDUwMWY4MDAtNTM3Yi01NDRjLTk5Y2MtOWE1NTFlODU1ZTIwXzAxMA==:20200710T21221:1259a44f','2-ZDUwMWY4MDAtNTM3Yi01NDRjLTk5Y2MtOWE1NTFlODU1ZTIwXzAxMA==','2020-07-10T21:22:13+00','inbound',NULL,'Arin from LinkedIn','Hi Sean,
Did you know that building your network gives you a better LinkedIn experience? You can do it one connection at a time - simply start with people you know.
Here are three tips:
First, connect with people from work. Who did you work with in the past? Connecting on LinkedIn helps you stay in touch throughout your career.Second, connect with classmates. Who did you sit with in class? When you connect, you can see what your classmates are talking about on LinkedIn.Third, search for people you know more personally. Who do you see on weekends? Connecting on LinkedIn can expose opportunities they know about.Give connecting a try. You may not realize the doors that someone can open for you.
Cheers,
Arin from LinkedIn',NULL,'ARCHIVE'),
('export:2-YTUzNzRiMTQtMzdjZi00MDRhLWFhNTItMTdlMDk5MTM3OGEyXzAxMw==:20231231T22061:3fe93816','2-YTUzNzRiMTQtMzdjZi00MDRhLWFhNTItMTdlMDk5MTM3OGEyXzAxMw==','2023-12-31T22:06:17+00','inbound','https://www.linkedin.com/in/annachen19851124','Anna Chen','Hello Sean, how are you?',NULL,NULL);
INSERT INTO _import_messages (urn,conversation_id,date_iso,direction,other_url,other_name,body,subject,folder) VALUES
('export:2-NmNkZWM2MzAtNjEzMy00ZTIxLWE2ODAtOGQzYTFkMmI3M2E1XzAxMw==:20231210T11312:09192823','2-NmNkZWM2MzAtNjEzMy00ZTIxLWE2ODAtOGQzYTFkMmI3M2E1XzAxMw==','2023-12-10T11:31:22+00','inbound','https://www.linkedin.com/in/mitch-gold-55338b1a1','Mitch Gold','Hey Sean, sound those trumpets and roll out the red carpet because the webinar of the century is almost here! I invite you to join Eagle Point Fundings free webinar ''Unveiling the Secrets of the DoD.'' There are no bag checks to get into our event just register and you''re all set: https://www.linkedin.com/events/7121806083748167681/comments/',NULL,NULL);

INSERT INTO _import_threads (conversation_id,other_url,other_name,first_date,last_date,msg_count) VALUES
('2-YTIxMDliNDUtMDMxYi00M2Q0LWJkYWItZDIxMDA1NzU0YTY4XzEwMA==',NULL,'Lisa Williams','2026-05-26T05:05:04+00','2026-05-26T05:05:04+00',1),
('2-NjM5ZWM1NjEtZTJhZi00MmEyLWI2MzEtOThiODExZjI0MDU1XzEwMA==','https://www.linkedin.com/in/darryl-best-1ab34b184','Darryl Best','2026-05-24T00:06:04+00','2026-05-24T00:06:04+00',1),
('2-YmNlYjg2ODktNWU0MC00ZjQxLWE5NDUtMGQ5NWI5MGMwOTc1XzEwMA==','https://www.linkedin.com/in/luis-tellez-3913505b','Luis Tellez','2026-03-30T12:18:32+00','2026-05-23T08:50:01+00',3),
('2-NzU5ZTBkODYtZDc0ZC00N2ViLTgyZjMtNzc1NzVhZDBjMWNlXzEwMA==','https://www.linkedin.com/in/skyleroxford','Skyler  Oxford','2026-04-27T03:36:25+00','2026-05-21T02:17:40+00',12),
('2-MGY2NzExYmQtNThhOS00ZjNlLThkMWMtYzEyYjE1YzhhZTcyXzEwMA==','https://www.linkedin.com/in/michele-pelton-216b853b','Michele Pelton','2026-03-25T21:51:35+00','2026-05-21T01:26:45+00',3),
('2-OGFlZTBmNTYtMTFlMS00OWQ0LWI3MTAtODBmZTRlMWQ0MWRmXzEwMA==','https://www.linkedin.com/in/kyle-long-aviation','Kyle Long','2026-03-20T01:51:04+00','2026-05-21T01:26:14+00',3),
('2-ZDhjNDMyZDQtZTkyMC00ZGE2LThlZGMtZTRhYzcwNDA0ZDkyXzEwMA==','https://www.linkedin.com/in/josh-starr-570182283','Josh Starr','2026-03-28T00:22:34+00','2026-05-21T01:25:23+00',3),
('2-YjMzY2YyMGUtY2NjMS00MGMxLWJkMzAtYzdmZDA3YWY0ZmQ2XzEwMA==','https://www.linkedin.com/in/joseph-pisciotta-555436b1','Joseph Pisciotta','2026-03-29T13:22:22+00','2026-05-21T01:24:21+00',3),
('2-MDRhZmRmYmUtNTg0Yi00MzIxLWI5ZjktNmI1YWYwYWEwYjgxXzEwMA==','https://www.linkedin.com/in/jeremiah-kissick','Jeremiah Kissick','2026-03-20T18:35:23+00','2026-05-21T01:23:55+00',3),
('2-ZjQyOWZkYzUtNjM2Ni00Zjg4LThiNTUtZjc2MDFiMTRmNjcyXzEwMA==','https://www.linkedin.com/in/jeff-jackson-9b91373','Jeff Jackson','2026-03-20T12:06:41+00','2026-05-21T01:23:21+00',3),
('2-NzYzMDQyNTktYTNlOC00MTM5LTgxNGQtMWUyMWFjZTdiZmVmXzEwMA==','https://www.linkedin.com/in/jeffrey-kimmey-jr-b4b73678','Jeffrey Kimmey Jr.','2026-05-15T17:42:02+00','2026-05-21T01:21:32+00',2),
('2-MjA2Y2Y1OTItY2RmNi00YzE1LWJiZDktYmRjMTI0NmU4ZDc3XzEwMA==','https://www.linkedin.com/in/samuel-alfrey','Sammy Alfrey','2026-05-11T17:28:09+00','2026-05-21T01:19:37+00',2),
('2-YmU2MTc0ZTQtZGNiMS00NWJlLTgwMTAtNTIzZjVlOWI0ZTZjXzEwMA==','https://www.linkedin.com/in/jack-moore-a7708367','Jack Moore','2026-03-24T20:59:09+00','2026-05-21T01:19:00+00',3),
('2-YWY5MjE4NTQtMDI3NC00YzZjLWI3YTktNzI3MTgxYzY0YTk1XzEwMA==','https://www.linkedin.com/in/david-phillips-02b59a22','David Phillips','2026-03-20T00:04:22+00','2026-05-21T01:18:41+00',3),
('2-NTZjMGI4YjYtNDI3Ni00ZWJhLTgxZWQtNmQwM2VkOTgwMGFjXzEwMA==','https://www.linkedin.com/in/danny-santiago-53b2b093','Danny Santiago','2026-03-20T07:40:41+00','2026-05-21T01:18:21+00',5),
('2-ZDdiYTU1N2ItOTFiNC00ZGRmLWEyZjEtMDQyYzM5NWQ4NzNjXzEwMA==','https://www.linkedin.com/in/cody-morris-34984740','Cody Morris','2026-03-21T13:05:26+00','2026-05-21T01:17:47+00',3),
('2-M2IzZDE0ZTAtZGU2MS00MGJmLWE4MGUtZTMyZTQwODRiMzRiXzEwMA==','https://www.linkedin.com/in/brittney-weaser-bb945318','Brittney Weaser','2026-03-20T18:33:40+00','2026-05-21T01:17:31+00',3),
('2-NmRhYTJkZjMtODA5Mi00MzhiLWE0NmEtMzliNWI3ZjRjZTI4XzEwMA==','https://www.linkedin.com/in/andrew-arcuri-60aa6721b','Andrew Arcuri','2026-03-20T10:58:48+00','2026-05-21T01:17:05+00',3),
('2-ODdhOWE3YWItNDUwMi00MTExLWFhNzgtNzhkOGQyZTIyMjY3XzEwMA==','https://www.linkedin.com/in/scott-apple-55850153','Scott Apple','2026-03-28T02:54:39+00','2026-05-21T01:15:57+00',2),
('2-OGQ3ZTU3ODQtN2Y3My00YzY2LTkxYzctMGJiYzNlYzVhNTY2XzEwMA==','https://www.linkedin.com/in/justin-pynckels-mba-4a085b81','Justin Pynckels, MBA','2026-03-30T15:40:09+00','2026-05-21T01:12:46+00',2),
('2-NTJiM2U3ZGEtMTBkMi00NDczLThlMjEtMDUyOTAyN2Q2ODNiXzEwMA==','https://www.linkedin.com/in/justin-beason-cam-249711177','Justin Beason, CAM','2026-03-28T23:42:28+00','2026-05-21T01:12:05+00',2),
('2-ZjgxOTNlNDktOGFhNC00MzZjLWE3M2ItMGYwMDI1ZGJhNTE5XzEwMA==','https://www.linkedin.com/in/lindsay-parrott-2a923b37a','Lindsay Parrott','2026-05-20T17:39:24+00','2026-05-20T17:39:24+00',1),
('2-YWYwM2Q2YmMtM2UzNC00YThmLWI4NjItYmYzZjk0MTE1NTIzXzEwMA==','https://www.linkedin.com/in/kimberly-sanchez-aviation','Kimberly Kozlov','2026-05-18T13:02:59+00','2026-05-18T13:02:59+00',1),
('2-MjhkMTk5YzUtMTRmMi00MDc5LWI3NGEtNWM1NWQzMjJlZjg1XzEwMA==','https://www.linkedin.com/in/don-meyns-b05435375','Don Meyns','2026-05-16T00:32:57+00','2026-05-16T13:12:01+00',2),
('2-MzI3YTJjN2MtYjdiMS00OTk0LWJhOGUtZTI2OGI1YWJiN2U1XzEwMA==','https://www.linkedin.com/in/brett-bailey-','Brett Bailey','2026-05-16T00:26:50+00','2026-05-16T00:41:56+00',4),
('2-YTgyZTVjZDQtNTRmOC00YjgyLWE2MjItZTM0NjFhZDBmZGVhXzEwMA==','https://www.linkedin.com/in/marty-grier-cam-pmp-7b1a8413','Marty Grier CAM/PMP','2026-03-28T01:51:46+00','2026-05-15T12:03:11+00',3),
('2-YjliNDc0MmUtNWRkOS00MjIxLTkwNmEtMzE3YjRkMjZjNGQ5XzEwMA==','https://www.linkedin.com/in/garen-harout-mazedjian-4454a871','Garen Harout Mazedjian','2026-05-11T04:02:51+00','2026-05-11T04:02:51+00',1),
('2-YmVlZjZjOTAtMTdkNy00ODEwLThlNzYtN2U3MDQxYzRkYzcwXzEwMA==','https://www.linkedin.com/in/anne-marie-zwerg','Anne Marie Zwerg, PhD, MIM','2026-05-10T13:29:51+00','2026-05-10T13:29:51+00',1),
('2-MGY1NWNhYjctYjc5NS00OWRkLWJiODEtYTIyNzlhYjQ4NzQ5XzEwMA==','https://www.linkedin.com/in/chelsea-groves-7551a3a1','Chelsea Groves','2026-05-10T03:14:30+00','2026-05-10T11:48:24+00',2),
('2-NjMyMTFjYzYtM2IyOS00YTZlLTg4NzctYTNmYTZhZjhlMWVkXzEwMA==','https://www.linkedin.com/in/cristian-mansilla-6b6a5890','Cristian Mansilla','2026-05-08T20:18:00+00','2026-05-08T20:18:00+00',1),
('2-ZDRjODc1NzUtZTU3Yy00NWY4LWJiOTUtOTA1ZWQyY2UwNWRiXzEwMA==','https://www.linkedin.com/in/yonathan-garcia-110b9334b','Yonathan Garcia','2026-05-08T08:58:49+00','2026-05-08T08:58:49+00',1),
('2-NTg3NDAxY2QtZmNlYy00Y2U2LWI0YTgtNGIwNDUzZDM5ZjU3XzEwMA==','https://www.linkedin.com/in/eric-moberg-a139ab203','Eric Moberg','2026-03-20T12:13:57+00','2026-05-08T04:09:08+00',43),
('2-NTU0Y2U0M2EtOGMxYS00YjY0LTg3NWItMDZiYjMyNjI4ZjMzXzEwMA==','https://www.linkedin.com/in/joseph-schwartz-09a0a7178','Joseph Schwartz','2026-05-05T04:15:52+00','2026-05-05T04:15:52+00',1),
('2-MzdjNGE4MjItZjdjYy00N2JlLWI3ZjAtZmQwMjAwNzY0OWNjXzEwMA==','https://www.linkedin.com/in/dale-cash-22b064222','Dale Cash','2026-05-04T22:45:02+00','2026-05-04T22:45:02+00',1),
('2-Zjc5MjE1ZGEtYzg5NS00MTU3LTlkYzItM2E4ZTI3ZjU2YjZlXzEwMA==','https://www.linkedin.com/in/christopher-wilkes-cam-b33819131','Christopher Wilkes, CAM','2026-04-29T04:52:02+00','2026-05-04T20:26:25+00',3),
('2-OGZkYTY3NjItYzA5NC00YzY1LTg0NGMtY2U5ZWRkMjkxM2FmXzEwMA==','https://www.linkedin.com/in/andrew-schumpp-85a96bb','Andrew Schumpp','2026-04-23T03:04:22+00','2026-05-04T20:23:40+00',3),
('2-Y2QwNWJjOGEtNzdiNi00NzQzLWJhNWItYWY2MjRiN2M3ODhmXzEwMA==','https://www.linkedin.com/in/kurtwiegers','Kurt Wiegers','2026-05-04T14:53:28+00','2026-05-04T15:11:03+00',3),
('2-NmI0MTU1N2EtZGUxMC00MjhmLTk1OWMtZWI2ZmU0MGY4ZjgzXzEwMA==','https://www.linkedin.com/in/ray-shahifar-7b06212a5','Ray  Shahifar','2026-05-04T14:37:12+00','2026-05-04T14:37:12+00',1),
('2-ZGI5NWFiYzctY2E0NS00YmEzLWFhMDMtYzgwMzI2NGU5Y2M0XzEwMA==','https://www.linkedin.com/in/jim-lufrano-9432368','Jim Lufrano','2026-03-22T19:12:01+00','2026-05-02T22:46:38+00',20),
('2-YTYwMjkwNjMtZTk1ZS00NGQ4LWIzNTYtMDZlZmI2YjRkYjMzXzEwMA==','https://www.linkedin.com/in/jerel-buckley-66539512','Jerel Buckley','2026-05-02T00:06:05+00','2026-05-02T00:06:05+00',1),
('2-MDQ5ZjM2NWUtN2JmNC00ZWY1LWEzNTgtMGZjNDAwODI3OWVlXzEwMA==','https://www.linkedin.com/in/barney-whaley-82868b9b','Barney Whaley','2026-05-01T07:45:18+00','2026-05-01T07:45:18+00',1),
('2-MzQ2NGYwNmUtYTNkMS00ODJhLTgxZTgtMjNmOTlmZGJiODQ1XzEwMA==','https://www.linkedin.com/in/jddulebohn','James Dulebohn','2026-03-30T15:51:37+00','2026-04-30T19:10:23+00',23),
('2-ZTBjM2VkYTQtMmE0Zi00NjhiLTllNGUtYWVjMTEzNmNmMmQ1XzEwMA==','https://www.linkedin.com/in/benjamin-hulshoff-713702269','Benjamin Hulshoff','2026-04-30T03:05:53+00','2026-04-30T03:05:53+00',1),
('2-YTZhN2YxNjgtMDliNi00ODY3LWIzYWQtY2NiMGIwYjhjZjZjXzEwMA==','https://www.linkedin.com/in/preston-griffin-ok','Preston Griffin','2026-04-24T13:07:00+00','2026-04-29T18:14:08+00',5),
('2-YjE5YTA4MzYtMDllYi00NGVkLWJmMWUtY2M0NDhjZWFhMjViXzEwMA==','https://www.linkedin.com/in/ray-filbeck-8742565a','Ray Filbeck','2026-04-28T12:08:28+00','2026-04-28T12:08:28+00',1),
('2-OTBkYTYwMjQtYTA1MC00YmU0LTg3ZDctYmJiNzdhMDIzYWQ4XzEwMA==','https://www.linkedin.com/in/peter-sterling-a430b591','Peter Sterling','2026-04-27T20:23:38+00','2026-04-27T20:42:55+00',3),
('2-N2M5YWFjNmYtZDY0Ni00NGYwLTg5NzgtN2NhYTRmZGZlNTMzXzEwMA==','https://www.linkedin.com/in/david-sepulveda-335a7850','David Sepulveda','2026-04-27T16:13:03+00','2026-04-27T16:13:03+00',1),
('2-MDU4NjJhNDYtNzQ4Ni00NTJhLWJlNzQtNmJiMmVjZWQzOWY5XzEwMA==','https://www.linkedin.com/in/andrew-kiehl-5b07136','Andrew Kiehl','2026-04-27T03:04:23+00','2026-04-27T03:04:23+00',1),
('2-ZTYwMjY3NTgtNjU3ZC00MTc4LWJmNjgtMjI2MzI1ZDFkODU4XzEwMA==','https://www.linkedin.com/in/jones-mitch','Mitch Jones','2026-04-27T02:13:19+00','2026-04-27T02:13:19+00',1),
('2-NDk3ZWY2YWUtNDFjNC00ZmIyLWI0MDQtYjE0Yzc4MGQ5Y2M2XzEwMA==','https://www.linkedin.com/in/darrienpeoples','Darrien Peoples','2026-04-27T01:49:36+00','2026-04-27T01:49:36+00',1),
('2-ZTY3Nzk4MzktMTI5MC00NjU1LTkwZDAtOWM4NDYxOWI1ZGYzXzEwMA==','https://www.linkedin.com/in/bronson-harris-10a29269','Bronson Harris','2026-04-27T00:47:46+00','2026-04-27T00:48:02+00',2),
('2-YmU0YzdjZmEtYzJlZC00OWRhLTlkYTYtNWFjYjFhYzFlY2ZmXzEwMA==','https://www.linkedin.com/in/robriccardo','Robert Riccardo','2026-04-27T00:06:34+00','2026-04-27T00:07:51+00',4),
('2-ZjY1ZDZjMDMtZTEzZC00YmU5LWI3NTctOTJhYzEwMDM5NzFjXzEwMA==','https://www.linkedin.com/in/joe-nemat-2673b0112','Joe Nemat','2026-04-26T23:55:59+00','2026-04-26T23:55:59+00',1),
('2-YzAxYmY2MWQtYjZiMy00NDg5LTg5ZjEtNTgxNjk5NzljMWFhXzEwMA==','https://www.linkedin.com/in/jonah-richie-50a878377','Jonah Richie','2026-03-20T14:50:56+00','2026-04-23T13:24:42+00',17),
('2-NzQ2MzZkOTQtZmFlMi00YTAwLWJiM2EtNmUyOWUwZDVlYWQ1XzEwMA==','https://www.linkedin.com/in/chris-kiefer-4ba5721a7','Chris Kiefer','2026-04-22T11:42:53+00','2026-04-22T11:42:53+00',1),
('2-NzM4MDQyMDEtZTFlYS00ZTFmLTg0MmUtNTI5ZTY4MDVkMjVlXzEwMA==','https://www.linkedin.com/in/uriah-savary-831b393b9','Uriah Savary','2026-04-20T15:36:30+00','2026-04-21T12:41:40+00',3),
('2-YTk2Zjc5N2QtMTEzNi00ZmQ4LWExMjctMWU2YWZkNmFlNDMxXzEwMA==','https://www.linkedin.com/in/sean-donovan-7789858b','Sean Donovan','2026-04-16T15:46:54+00','2026-04-16T15:46:54+00',1),
('2-ZjgyYTQ4ZDYtMDJiNS00NjBlLWJjZTQtOTE5N2YwYWYyOTgzXzEwMA==','https://www.linkedin.com/in/derek-mathews-0b558079','Derek Mathews','2026-03-21T12:12:07+00','2026-04-15T12:25:40+00',3),
('2-ZDU5NmEyMTAtZDY3NS00OTZmLTk3ZmItMjdhNTMwMDgwMjIzXzEwMA==','https://www.linkedin.com/in/samuel-ayala-257a20213','Samuel Ayala','2026-04-14T22:11:32+00','2026-04-14T22:11:32+00',1),
('2-NDIxMDk3NjYtMjM3Yy00ZTQ2LTk2NWItNWY3MmI1YTZlYzBhXzEwMA==','https://www.linkedin.com/in/patrick-brody-mckenna-b034b920a','Patrick "Brody" Mckenna','2026-04-14T15:57:00+00','2026-04-14T15:57:00+00',1),
('2-ZjBiOGFiOGEtMTk3MS00NzFhLTllNGEtY2U0MWVhMTY2NmM1XzEwMA==','https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael Lineaweaver','2026-03-20T02:31:56+00','2026-04-14T01:01:30+00',17),
('2-NzM4OTBhODAtYzQxMS00MjNjLTkwYzEtMDM2OWJlN2MxNzk4XzEwMA==','https://www.linkedin.com/in/luis-osuna-409628120','Luis Osuna','2025-06-24T16:57:07+00','2026-04-05T01:03:26+00',14),
('2-MjBjYTZmMWQtMDFmNS00NzlhLWJjY2YtNGNhNmM0Nzk3ZWVmXzEwMA==','https://www.linkedin.com/in/christopher-botelho-271b13132','Christopher Botelho','2026-04-01T06:36:45+00','2026-04-01T06:36:45+00',1),
('2-MWIxODVmMmItODE3ZC00YmZkLTgwZTQtNjdhOWQyNmVjYjc3XzEwMA==','https://www.linkedin.com/in/bryan-diaz-35171887','Bryan Diaz','2025-07-15T00:36:19+00','2026-04-01T03:41:40+00',12),
('2-ZTA1NWY3OTMtZGQxYS00M2ZjLWIyODAtMDEzMDFjYjEwMjA1XzEwMA==','https://www.linkedin.com/in/joseph-dimatteo','Joseph DiMatteo','2026-03-31T01:10:08+00','2026-03-31T01:10:08+00',1),
('2-MTMwYjUxYjEtZTM4NS00MThmLWEyZDMtNjIyYWE5NDI0YjEwXzEwMA==','https://www.linkedin.com/in/mike-gallas-2a922b5','Mike Gallas','2026-03-25T18:33:13+00','2026-03-30T23:46:09+00',2),
('2-NDk0YzkwMWYtNmZlZC00MDI3LWI5NTUtODEzYmViYTgwNDdkXzEwMA==','https://www.linkedin.com/in/aircraft-service-providers-llc-85667b32a','Aircraft  Service Providers LLC','2026-03-28T14:52:14+00','2026-03-28T14:52:14+00',1),
('2-NTY4Mjk1N2ItYWQ0MS00ZmQzLTgyZTUtNzhlZDkzYmIxZTYzXzEwMA==','https://www.linkedin.com/in/orel-elbaz-564491213','Orel Elbaz','2026-03-23T21:04:42+00','2026-03-27T23:13:21+00',2),
('2-NTNiOThiODktYjg0NS00OTlhLWJlNjgtMTg1MTgxMGIxODQwXzEwMA==','https://www.linkedin.com/in/scott-bjergo-96746695','Scott Bjergo','2026-03-21T03:29:14+00','2026-03-25T14:08:43+00',5),
('2-YjllMzk5MzktZTJkMy00ZGI1LTliYzctNTcyMjczYzhjZTI2XzEwMA==','https://www.linkedin.com/in/todd-cofer-22a4a5304','Todd Cofer','2026-03-25T00:55:11+00','2026-03-25T00:55:11+00',1),
('2-OTQ4NTQxZWEtYjFjNy00YTMyLTg4ODYtM2I1N2E4ZDdjMDJlXzEwMA==','https://www.linkedin.com/in/mike-horan-46704a337','Mike Horan','2026-03-21T00:42:05+00','2026-03-24T23:53:28+00',2),
('2-MjcyY2UxMzgtMTg5NS00MWYxLWIzNzMtNDNkMjg4MTJlOGZjXzEwMA==','https://www.linkedin.com/in/shawn-petersen-6a241b129','Shawn Petersen','2026-03-20T13:15:50+00','2026-03-24T23:53:10+00',2),
('2-Mjg5N2RlZWMtOTNmZC00NmUyLWJkN2YtMGE4M2M5NTQ1ZjQ0XzEwMA==','https://www.linkedin.com/in/vortex-aircraft-services-3a97b5244','Vortex Aircraft Services','2026-03-20T19:21:33+00','2026-03-24T23:52:02+00',2),
('2-MDA0ODQ1YWEtN2Y1OS00N2JkLTgyNDQtMGE4YWI2NjVkZGQ4XzEwMA==','https://www.linkedin.com/in/robert-jacobs-77152539','Robert Jacobs','2026-03-20T22:23:42+00','2026-03-24T23:51:29+00',2),
('2-Y2E5OGFhNmYtMmZjZS00ZWVhLTkyYzQtMGU0Mjk0NmJhYmZlXzEwMA==','https://www.linkedin.com/in/stephanus-ackermann-36831a225','Stephanus Ackermann','2026-03-20T11:04:24+00','2026-03-24T23:50:42+00',2),
('2-ODE1YmNmNjktM2E0YS00NjhhLWIyMDktOWZmM2UwZjVmOTczXzEwMA==','https://www.linkedin.com/in/michael-w-johnson-56bb93381','Michael W. Johnson','2026-03-20T05:19:47+00','2026-03-24T23:45:46+00',2),
('2-ZDMwNTdkODUtN2M5NC00NzdhLWI3MTEtZjQ2NWFhODkzZmNlXzEwMA==','https://www.linkedin.com/in/paul-diaz-a03a30187','Paul Diaz','2026-03-19T22:25:07+00','2026-03-24T23:44:19+00',2),
('2-YWYzZGJiM2ItMTllMi00MmE2LTk0YjYtNWQ3ZTYyZGQ4NWFiXzEwMA==','https://www.linkedin.com/in/christina-richason-5a8b9335','Christina Richason','2026-03-23T12:24:37+00','2026-03-23T12:24:37+00',1),
('2-YTEwZGQ0NTMtZjczZi00MDY0LThkNzEtYmNmOGY1YTVkYWVkXzEwMA==','https://www.linkedin.com/in/joshua-dunn52','Joshua Dunn','2026-03-20T11:19:39+00','2026-03-22T00:03:11+00',5),
('2-NWRjYmZmMTItZTc5Ni00ZjBiLThjZWMtNWU5Njc5NzQ0MzEwXzEwMA==','https://www.linkedin.com/in/maria-de-jesus-0807bb37','MARIA DE JESUS','2026-03-20T08:49:23+00','2026-03-20T15:31:27+00',4);
INSERT INTO _import_threads (conversation_id,other_url,other_name,first_date,last_date,msg_count) VALUES
('2-NGY1YzAwMWItMTQ0Yi00ODUzLTkwNGUtNmNlOWMyM2UxZGZhXzEwMA==','https://www.linkedin.com/in/brian-sprecher-43321979','Brian Sprecher','2026-03-20T13:30:34+00','2026-03-20T14:39:54+00',3),
('2-YzAxMGUzNGUtYjA1Yi00ZDJhLTliNGUtYTUwNWRkMWM0ZTRhXzEwMA==','https://www.linkedin.com/in/christopher-reverski-41074342','Christopher Reverski','2026-03-20T03:42:56+00','2026-03-20T03:42:56+00',1),
('2-ODNmMmI0NDctYmY1ZS00YjI4LTk5MjQtNmVmNjY3NDQ1Y2Y4XzEwMA==','https://www.linkedin.com/in/tetiana-lisina-1b451a144','Tetiana Lisina','2026-03-19T22:08:47+00','2026-03-19T22:08:47+00',1),
('2-YzU2ZjA0NTItODEyNy00NTFmLWE3ODUtYmU3NzJhZDU5MTBlXzEwMA==','https://www.linkedin.com/in/natedietsch','Nate Dietsch','2025-06-25T16:13:24+00','2026-03-19T01:23:29+00',4),
('2-MGRhZWEyZjAtNzk5YS00ZGNiLWJhN2YtODQ5ODhmNzAxNzRmXzEwMA==','https://www.linkedin.com/in/lavonne-cole','Lavonne Cole','2025-11-06T18:11:33+00','2025-11-06T18:11:33+00',1),
('2-ODQ4OGM4YWItYmE1My00Mjc5LTg2NWQtNWY0NzE3OWU2ZWI4XzEwMA==','https://www.linkedin.com/in/tmacadamcatalina','Terry MacAdam','2025-11-02T03:53:01+00','2025-11-02T04:46:30+00',2),
('2-M2YyMDBlNWMtMmZhOS00NzViLTkyMTAtNDA5MzJiMzNiMDVjXzEwMA==','https://www.linkedin.com/in/toby-harper-ab9172133','Toby Harper','2025-11-01T15:09:08+00','2025-11-01T17:56:40+00',4),
('2-NTA0MzE0MGMtNTE0MS00MzJmLTg5MWUtNWRmZGU1NjljNGUyXzEwMA==','https://www.linkedin.com/in/justin-wilmoth-aa5b0332','justin wilmoth','2025-07-19T10:11:41+00','2025-11-01T17:30:16+00',4),
('2-ZjU5MmViMzgtMjYxMy00MTAzLWI3MmYtZDBjOTk4M2U2ZDBhXzAxMA==','https://www.linkedin.com/in/troy-l-mccullum-2235001b0','Troy L. McCullum','2024-01-12T22:46:52+00','2025-11-01T14:50:27+00',3),
('2-NWNjNTgyMmItNDQyNC00YWNmLTljNWQtMTM5ZTVlNzI5OTM2XzEwMA==','https://www.linkedin.com/in/advanced-aircraft-research-a-222689174','Advanced Aircraft Research Aircraft','2025-11-01T14:30:08+00','2025-11-01T14:30:08+00',1),
('2-NmVlMzAzNjQtYmQ2MS00OTUyLTgxMTktOTc1YThmNWJmYmYyXzEwMA==','https://www.linkedin.com/in/chris-s-193081188','Chris Smith','2025-10-24T10:44:55+00','2025-10-24T10:44:55+00',1),
('2-YTdmNTFhOGYtMTQ3MS00ZThkLTljNmYtNGFlMzdlYTEyNzMwXzEwMA==','https://www.linkedin.com/in/christopher-pratt-33471919','Christopher Pratt','2025-07-22T19:15:29+00','2025-10-07T02:56:30+00',17),
('2-YmUxZjIyYjgtZGU4Zi00Y2EzLTk0ZWItNjk0OTM1NmRkNWExXzEwMA==','https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew  Orido','2025-10-07T01:42:24+00','2025-10-07T02:56:01+00',20),
('2-MWNiMWM4MzktZWI2OS00NzhlLThkMjctNmFlMzZhNWMzNDk3XzEwMA==','https://www.linkedin.com/in/jeff-carson-34272b6a','Jeff Carson','2025-09-01T01:42:36+00','2025-09-01T01:42:36+00',1),
('2-ZDhiZmJiMzgtZTdjNC00MzcxLTkwODItZDgyZmJkYTc2OTBjXzEwMA==','https://www.linkedin.com/in/charles-walrod-52610563','Charles Walrod','2025-08-20T15:14:01+00','2025-08-20T15:14:01+00',1),
('2-NWVmMzk3MDMtOTgxYi00MDIzLTg0YWMtMzIwZGNlMDQyOTkwXzEwMA==','https://www.linkedin.com/in/john-simon-405189153','John Simon','2025-08-19T14:37:17+00','2025-08-19T14:37:17+00',1),
('2-ODFiMmEyNmQtZDZjYi00NGIwLTliZjAtZmM2OGQyMjdlZmU4XzEwMA==','https://www.linkedin.com/in/todd-hattaway-aviation-mgmt','Todd Hattaway','2025-08-18T09:39:22+00','2025-08-18T09:39:22+00',1),
('2-YzI4MTNmMDktZGQxMC00M2I2LThjNjQtZDQ5OWRlNjI4YzkxXzEwMA==','https://www.linkedin.com/in/randy-wirkkala-6b037042','Randy Wirkkala','2025-07-06T00:42:20+00','2025-08-07T18:51:48+00',11),
('2-YTBiODNjMTYtZGUyMS00M2UxLWI0ZDEtNGVjZGZjMzk2NGNlXzEwMA==','https://www.linkedin.com/in/scott-coryea','Scott Coryea','2025-08-01T19:59:24+00','2025-08-01T19:59:24+00',1),
('2-YTJhMjFkOGEtZTAxZi00ZGJlLWI1YjktMmViOTA3ZDQzMjI0XzEwMA==','https://www.linkedin.com/in/ernesto-rodriguez-4693a4103','Ernesto Rodriguez','2025-07-30T04:23:14+00','2025-07-30T04:23:14+00',1),
('2-NmNmZWY5NTYtMGJhMC00ODdiLTlmMGUtNDIyMzE4YWM2ZjkxXzEwMA==','https://www.linkedin.com/in/kevinedwardcox','Kevin Cox','2025-07-29T01:15:34+00','2025-07-29T01:15:34+00',1),
('2-Yzk2ZTdhYzMtZTlmOC00MzI0LTgwOTYtYTY4OTllNjI3NjZlXzEwMA==','https://www.linkedin.com/in/erica-hernandez-9bb9b0136','Erica Hernandez','2025-07-25T11:47:48+00','2025-07-25T11:47:48+00',1),
('2-MGRlNDg0MmEtNzgxZC00NTQ5LTgxYTEtNTgxNDQ5ZDEyZGRkXzEwMA==','https://www.linkedin.com/in/rick-tinker-18570a159','Rick Tinker','2025-07-22T13:15:58+00','2025-07-22T13:15:58+00',1),
('2-ZjJkNjc1NmItOGQzMC00ZTdlLTkzNDMtMjlhZGQ0YTdjMTBiXzEwMA==','https://www.linkedin.com/in/gustavo-escobedo-morales-555ab5186','Gustavo Escobedo-Morales','2025-07-17T02:37:59+00','2025-07-17T02:37:59+00',1),
('2-Y2E0MDAwNTUtMWU0Mi00NzhiLTg4ZmUtMDQ2NjJjZGQ3MDRlXzEwMA==','https://www.linkedin.com/in/thomas-barton-35a7976a','Thomas Barton','2025-07-15T14:58:31+00','2025-07-15T14:58:31+00',1),
('2-ZTk5NzI5NDEtNjBjOS00ODQ0LTkyYzktODVkNzgwNmU3YTQzXzEwMA==','https://www.linkedin.com/in/michael-stephenson-326212141','Michael Stephenson','2025-07-15T12:46:24+00','2025-07-15T12:46:24+00',1),
('2-ZDAyODYwNWEtZjllYS00NTc2LThlZjctNjQ4MjViYWMyMDYzXzEwMA==','https://www.linkedin.com/in/lazaro-lopez-834172284','Lazaro Lopez','2025-07-15T12:06:15+00','2025-07-15T12:06:15+00',1),
('2-N2JmNGU2OTAtNmU4NC00ZTdjLThlNDYtMDkxNjUyODhmNDM0XzEwMA==','https://www.linkedin.com/in/aaron-bankston-0574a4179','Aaron Bankston','2025-06-30T20:22:24+00','2025-07-15T00:48:29+00',2),
('2-NTZkZTcwYzgtZDQzMy00ZWFiLWE2MmEtZDcxN2VmZTNmNjM3XzEwMA==','https://www.linkedin.com/in/michael-lavin-01788469','Michael Lavin','2025-07-01T20:03:24+00','2025-07-15T00:48:14+00',2),
('2-ZWQ4YThkMGUtNmJlYy00YmNjLTgzYmUtZjJkNTg1YmJiODVjXzEwMA==','https://www.linkedin.com/in/ruben-vega-murillo-5816832b','Ruben Vega-Murillo','2025-07-04T07:46:32+00','2025-07-15T00:47:50+00',2),
('2-NWMzYTVlMjUtMTkxNy00YzhlLTg0YWEtMWEwMTE5YTM5ODQwXzEwMA==','https://www.linkedin.com/in/philip-rhodes-1b903b8','Philip Rhodes','2025-07-08T02:17:59+00','2025-07-15T00:47:08+00',2),
('2-MDUxMTA2MzUtNDk3Yy00ZDY5LWFhZTAtYmRkNTQ5Zjc0MGQ1XzEwMA==','https://www.linkedin.com/in/bill-denny','Bill Denny','2025-07-13T17:15:25+00','2025-07-15T00:46:41+00',2),
('2-ZTBhNDQ3YTctODU4OC00ZmRjLTk0YWUtMjE1NzkzNjE1MmVmXzEwMA==','https://www.linkedin.com/in/tim-reaid-jr-832a5b2a3','Tim Reaid Jr','2025-07-08T01:06:14+00','2025-07-15T00:42:26+00',3),
('2-YmVkZDhlZTMtMjk1Ni00ZjVhLTg1NzYtNGE4MmRjMjdmMTA2XzEwMA==','https://www.linkedin.com/in/daniel-clark-874231a8','Daniel Clark','2025-07-15T00:27:14+00','2025-07-15T00:27:14+00',1),
('2-MzJiMDJjMTYtOWU1OC00Yzk3LThhNTctZmMwZTk3ODY1YjFmXzEwMA==','https://www.linkedin.com/in/christopher-redding-857772142','Christopher Redding','2025-06-30T16:09:26+00','2025-06-30T16:09:26+00',1),
('2-ZDEwOGQzNmQtYTc2Yy00OGQ3LTlmMzctNjUwMTM4MjhiYjA1XzEwMA==','https://www.linkedin.com/in/alex-talarczyk','Alex Talarczyk','2025-06-30T14:33:22+00','2025-06-30T14:33:22+00',1),
('2-NjRmNjkzOTYtZmEwNC00NDFhLWE3MmYtODcyNTVjODIwYjMwXzEwMA==','https://www.linkedin.com/in/brad-ongna-4b1a9430','Brad Ongna','2025-06-27T16:14:19+00','2025-06-27T16:14:19+00',1),
('2-NDcyYTBlNmItYTEyMS00ZDdkLWE5YzgtMWI5Y2VmODQxM2E3XzEwMA==','https://www.linkedin.com/in/chip-bonner-5a2b662','Chip Bonner','2025-06-25T12:47:00+00','2025-06-25T12:47:00+00',1),
('2-MGVhOTE4ZTYtMGUzYy00OTY4LWE0OTEtZTI4MmRjZmY4ZDU0XzEwMA==','https://www.linkedin.com/in/nick-baker-a481a6a3','Nick Baker','2025-06-24T18:57:49+00','2025-06-24T18:57:49+00',1),
('2-OWEyNjY2ZTUtNjQ3YS00ZGY4LTgwOTktZDQ5ZjQ2NTkzMzM1XzEwMA==','https://www.linkedin.com/in/adam-b-3a7a93247','Adam Barron','2025-06-24T16:30:36+00','2025-06-24T16:30:36+00',1),
('2-YWM3MDMzOWQtNjM0ZS00NWU3LWFjZWEtNWY5YjVlY2ExZDcyXzEwMA==','https://www.linkedin.com/in/carl-yutrzenka','Carl Yutrzenka','2025-06-24T16:28:41+00','2025-06-24T16:28:41+00',1),
('2-NzEzNzYyZGUtNGE1Ny00Yjg0LTk1YmItZWI2NjliNmU2ZDE3XzAxMg==','https://www.linkedin.com/in/calver-gallard-a57b7b191','Calver Gallard','2023-11-26T00:51:13+00','2025-06-03T03:38:07+00',3),
('2-YTI1ODQ4YzctODBiMS00NzZmLTkzMjEtZjI0MTUxZTQ4NjJiXzEwMA==','https://www.linkedin.com/in/richard-kovacs-451051358','Richard Kovacs','2025-05-12T23:05:59+00','2025-06-03T02:59:13+00',5),
('2-ZjZhOWFjZjktNGE5Mi00ZjRiLTlhMDgtZDEyOTdiMGI4MGFiXzEwMA==','https://www.linkedin.com/in/rob-cox-91004a70','Rob Cox','2025-05-15T14:49:30+00','2025-05-15T14:49:30+00',1),
('2-YWZjMWYzMzYtYWEyYi00ODJmLWFmZGItZDJiZDZhYzBkMWQxXzEwMA==','https://www.linkedin.com/in/richard-martínez-b87683171','Richard Martínez','2025-05-14T20:30:26+00','2025-05-14T20:30:26+00',1),
('2-OTcwMTZlOTktZTc5Zi00MTRmLTkxYzMtYzYyYmExMmY2OTgwXzAxMg==','https://www.linkedin.com/in/steve-trent-1ba0b1ba','Steve Trent','2024-01-19T00:23:18+00','2025-05-14T19:41:32+00',2),
('2-ZjhmZmZiODctMmM2OS00OWVhLWFmZDEtOTliNjU1MzQ0ZTEzXzAxMA==','https://www.linkedin.com/in/chris-corrington-b173a920','Chris Corrington','2024-05-01T22:22:26+00','2025-05-13T13:48:30+00',2),
('2-YmM4ZTg0NWItYTMxNi00ZjA0LWJkOWMtZWMwNjY5MzA1MmEzXzAxMA==','https://www.linkedin.com/in/anthony-johnson-32881b227','Anthony Johnson','2024-06-11T18:46:25+00','2025-05-13T02:40:39+00',2),
('2-MWUwMzliZGItZmFjNi00ZjZiLWJhYWUtYjJjMjcyMDEwOTMwXzEwMA==',NULL,NULL,'2025-05-12T23:09:25+00','2025-05-12T23:09:25+00',1),
('2-MjMwMjdmZGUtOGQwMC00MzVkLTk2NWEtMDUyODJhZjU3NTRhXzEwMA==','https://www.linkedin.com/in/michael-miner','Michael Miner','2025-05-12T23:05:05+00','2025-05-12T23:05:05+00',1),
('2-ZDI0YTU1ZGItY2Q2MC00ZmI1LWExYjctYmI2OWU1ZDVhOGIwXzEwMA==','https://www.linkedin.com/in/eric-smith-53228477','Eric Smith','2025-04-24T22:15:23+00','2025-04-24T22:15:23+00',1),
('2-YWFjYjc4YTgtZWFhOS00YmRhLTg5MWMtNmEyODc2MTQ2NGIyXzAxMg==','https://www.linkedin.com/in/harry-hill-093ba445','Harry Hill','2024-01-18T00:18:38+00','2024-11-05T18:52:29+00',14),
('2-YTVhMmY5N2EtYmE0ZS00NDgxLWI3ZDQtMTE1NjAxYzI1ZWMzXzAxMA==','https://www.linkedin.com/in/frank-j-pedersen-jr-b503b42','Frank J. Pedersen, Jr.','2024-07-13T17:48:12+00','2024-08-06T01:27:28+00',2),
('2-ZTNkYzc5ZTItZjRlYy00ZWZjLTkwOTItYTMxNjM0YzA5OWQwXzAxMA==','https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn Cushman','2024-01-12T17:49:54+00','2024-07-02T23:20:37+00',22),
('2-MmFjNmM0OWMtYzk3Yy00MmMxLTgxZTgtMjY2MWE0YTRhZDE1XzAxMA==','https://www.linkedin.com/in/cole-ward-a463b81a5','Cole Ward','2024-05-04T16:51:10+00','2024-05-04T16:51:10+00',1),
('2-NzgwNWQ5NTEtZDQwMy00NGFmLWE0NzctOTVhYzRhNTg3MTI3XzAxMA==','https://www.linkedin.com/in/jason-meynarez-6649165','Jason Meynarez','2024-04-18T14:02:16+00','2024-04-23T13:49:56+00',3),
('2-NDI0ZjU2NWMtNTZhMS00MWVhLTg1NGYtOTFhOGNlYmZhMzM4XzAxMA==','https://www.linkedin.com/in/jonathan-p-a923b5b4','Jonathan Pizarro','2024-04-08T21:01:03+00','2024-04-08T21:01:03+00',1),
('2-MmU2ZGI3OTQtZWYzOC00OTAwLTllNjctOGFiMzk0ZDk0NzFlXzAxMA==','https://www.linkedin.com/in/justin-loyd-69b3a537','Justin Loyd','2024-03-12T15:15:36+00','2024-03-12T15:17:25+00',2),
('2-Zjk5YzM3NzUtMDI4ZS00MjkyLWIzNWYtYjJkYTg4MDU0NDMyXzAxMg==','https://www.linkedin.com/in/gregory-reyes-estevez-8b1642236','Gregory  Reyes Estevez','2024-03-12T14:16:37+00','2024-03-12T14:16:37+00',1),
('2-NTE4ZDUwNTEtYjA0NS00ZWY2LTg2OGEtNWM2MGYxZDk3OTFhXzAxMA==','https://www.linkedin.com/in/brandon-clausen-2044a37a','Brandon Clausen','2024-03-11T16:59:25+00','2024-03-11T16:59:25+00',1),
('2-MzI2NzAyYTUtMWU4MS00NjMxLWI4MmMtMzc3MWZjNWExYjliXzAxMA==','https://www.linkedin.com/in/brian-felt-ba415b117','Brian Felt','2024-03-08T22:30:02+00','2024-03-08T22:30:02+00',1),
('2-ZGQwYTJiOTEtMWRiZS00NzgzLWI1YjAtMDUxMWU3ZTg3NGUzXzAxMg==',NULL,'LinkedIn Member','2024-02-15T16:16:50+00','2024-02-15T16:16:50+00',1),
('2-ZTJmNWRmMzQtMmUxZS00NzBjLWFkZWItNjE0OTA1ZTZmMzNkXzAxMA==','https://www.linkedin.com/in/gilberto-rivera-aa5501166','Gilberto Rivera','2024-02-13T01:33:04+00','2024-02-13T01:33:04+00',1),
('2-YmY4ODFkNzItOGViNS00MWQxLWI4YjUtNzMzYWFjNWZmYmZjXzAxMA==','https://www.linkedin.com/in/kerry-mergler-56a47571','Kerry Mergler','2024-02-10T00:08:25+00','2024-02-10T00:08:25+00',1),
('2-YjI0YTQ1NzEtZTdlZS00NWI3LWJjNjctYWZmZDYyMzE2NjdkXzAxMg==','https://www.linkedin.com/in/joe-dinolfo-25bb4a5','Joe Dinolfo','2024-01-23T16:20:14+00','2024-02-05T14:45:13+00',4),
('2-ZjBhZTk0ZWMtZmViOS00ZDgzLWI4ODUtMDhlMGJiYjYxMjdkXzAxMA==','https://www.linkedin.com/in/gilbert-palos-2a2a36a1','Gilbert Palos','2024-02-03T02:16:51+00','2024-02-03T02:16:51+00',1),
('2-OThhYWY3ODMtMmE3Zi00ZTUxLTg3Y2MtNGM3Yjc5Mzg3YTlmXzAxMA==','https://www.linkedin.com/in/david-jensen-41578140','David Jensen','2024-01-16T17:12:14+00','2024-01-31T19:44:29+00',2),
('2-MDFkNDIxMDMtYWRmYi00ZDMyLWI2NDctOTUxOTFmMDYxYWJlXzAxMg==','https://www.linkedin.com/in/jason-civitano-56840797','Jason Civitano','2023-11-21T05:15:29+00','2024-01-31T18:36:21+00',20),
('2-NzUwZGUzNzctYTExNC00N2ZhLTkzMmQtNjExM2RhYmRhYTAyXzAxMw==','https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur Palacio','2024-01-11T21:32:21+00','2024-01-31T18:32:27+00',14),
('2-ZTM4OGVhYTAtZjk5Yy00ODlkLWExYjItYjYwM2Y5NWI2NDJjXzAxMA==','https://www.linkedin.com/in/brian-woods-25632bb2','Brian Woods','2024-01-30T12:45:46+00','2024-01-30T12:45:46+00',1),
('2-YTYxODgzOGMtNTQwNC00N2Q3LWI0NTYtMDdkNmZkM2NlMGI5XzAxMA==','https://www.linkedin.com/in/al-guerra-77b01754','Al Guerra','2024-01-26T22:17:45+00','2024-01-26T22:17:45+00',1),
('2-YTY4MWQwNDUtOTk1YS00YTY1LWEwYzAtMzY1YjYwZjRlOGQ1XzAxMg==','https://www.linkedin.com/in/jamesbellard','James Bellard','2024-01-26T14:18:31+00','2024-01-26T15:39:14+00',3),
('2-MjNlODdlM2UtNjYyYi00MDhlLTlhOGMtZDhiZjJlZjUwYTQ3XzAxMg==','https://www.linkedin.com/in/juan-alvarez-64510b182','Juan Alvarez','2024-01-22T17:40:38+00','2024-01-22T17:40:38+00',1),
('2-YmVmOWYwNDctZWI3NS00MTJlLWE5YTQtMmE4Njc5MjNlNTA3XzAxMA==','https://www.linkedin.com/in/lauren-palmer-674926291','Lauren Palmer','2024-01-22T14:02:21+00','2024-01-22T14:02:21+00',1),
('2-NjYxYWI0MmQtY2E1OC00YmMzLWFkMzEtYzZjYjgyZjRkNGE1XzAxMg==','https://www.linkedin.com/in/jeffrey-linstra-aa701712','Jeffrey Linstra','2024-01-18T22:23:09+00','2024-01-18T22:23:09+00',1),
('2-NDRkMmE2MDEtNzY4Yi00MzBhLTk2ZWQtYjVmNGI1MTkwNjM1XzAxMg==','https://www.linkedin.com/in/sjms56','Steven Sinski','2024-01-18T18:49:35+00','2024-01-18T19:52:51+00',3),
('2-YzZhOTgwMzAtZDNkYy00MGEyLTllMzMtMjBlODQ5ZGRkYzFmXzAxMA==','https://www.linkedin.com/in/kevin-laird-2b678520','Kevin Laird','2024-01-18T19:12:37+00','2024-01-18T19:12:37+00',1),
('2-ZGZjYTY1NDUtZWNlMy00NTIxLWIwNmEtMDhkMThhOTRmNTQ4XzAxMA==','https://www.linkedin.com/in/aaron-esparza','Aaron Esparza','2024-01-18T13:40:29+00','2024-01-18T13:40:29+00',1),
('2-MzIyYzRjODItNzA0ZS00YjFkLTkzYmYtZjkxNjIyOGY4YTBkXzAxMg==','https://www.linkedin.com/in/alejandro-gomez-453452b6','Alejandro Gomez','2024-01-17T19:43:06+00','2024-01-17T19:43:06+00',1),
('2-NWU0NTkyYjktMTNkYS00ZGE0LTg4YmEtZDAwNmEyMGNlYWM5XzAxMA==','https://www.linkedin.com/in/dale-bomgardner-59ba6614','Dale Bomgardner','2024-01-17T17:26:37+00','2024-01-17T18:34:20+00',7);
INSERT INTO _import_threads (conversation_id,other_url,other_name,first_date,last_date,msg_count) VALUES
('2-NmM2NmNlNTktZjRhNS00ZGM1LTkzODctMTUyZDBlOTA3MjUwXzAxMA==','https://www.linkedin.com/in/denilson-almeida-80683435','Denilson  Almeida','2024-01-11T23:04:57+00','2024-01-17T15:44:49+00',6),
('2-YzA4MTI2MDMtNGU3NS00NzMyLTk4YzQtZTVlOTJkZjMwODNlXzAxMg==','https://www.linkedin.com/in/thomas-wittig-87762944','Thomas Wittig','2024-01-17T12:23:57+00','2024-01-17T12:23:57+00',1),
('2-NDlkOWJlMTYtNjgyYS00YmNmLTg0ZDctYjFjOGUyYzhkYTM2XzAxMA==','https://www.linkedin.com/in/rohit-rameshar-14188287','Rohit Rameshar','2024-01-16T20:39:14+00','2024-01-16T20:39:14+00',1),
('2-ZmQxNWRhODUtY2ZlNS00YTQ5LTliYWItZGVkN2NhODllMzc4XzAxMg==','https://www.linkedin.com/in/steve-betts-13128230','Steve Betts','2023-12-06T04:30:16+00','2024-01-16T19:43:12+00',2),
('2-NjY1ZmYwZWEtNjMzNS00YzQxLWI2ZjgtZTE5NzExN2U0MmM5XzAxMg==','https://www.linkedin.com/in/will-rodrigues-b882191a2','Will Rodrigues','2024-01-16T16:48:15+00','2024-01-16T16:48:15+00',1),
('2-ZWJkNGY1ZWQtMzc0ZC00Y2Q3LTg3ZjktMDZlMmRjMjQ4YjM0XzAxMw==','https://www.linkedin.com/in/rodrigochochelgoncalves','Rodrigo Goncalves','2023-12-21T22:37:35+00','2024-01-16T16:12:51+00',2),
('2-MjNiM2I5MTAtZmEyMi00NzRjLTk2YTEtZDgzMzQxOGIyZjE3XzAxMg==','https://www.linkedin.com/in/dan-muir-589b1a50','Dan Muir','2024-01-16T12:29:02+00','2024-01-16T12:29:02+00',1),
('2-NzExMTA1NWQtOWViYS00NDdhLWJkYjItN2EyZTA4ZGY0ZDBlXzAxMA==','https://www.linkedin.com/in/earl-glover-jr-89827939','Earl Glover jr','2023-12-19T01:34:07+00','2024-01-15T21:35:07+00',5),
('2-MjFmMjM1NjQtZWI4Ny00NWMzLWI3YTktMTM1NDI5MmIyMzc4XzAxMg==','https://www.linkedin.com/in/raul-jr-7534b21a7','Raul Jr','2024-01-15T19:01:01+00','2024-01-15T19:01:01+00',1),
('2-ODY1NWI4ODgtYTUwMC00NGEzLTg5ZmYtMjg3NjE1N2YzNzE0XzAxMg==','https://www.linkedin.com/in/michael-dehm-6317b671','Michael Dehm','2024-01-15T17:05:08+00','2024-01-15T17:05:08+00',1),
('2-ZjhjNWU3M2UtZmZmMy00YjhiLWFkODctODZmMzZlMGMwNzZmXzAxMg==','https://www.linkedin.com/in/joshua-vargas-a26a09251','Joshua Vargas','2024-01-14T04:12:53+00','2024-01-14T04:12:53+00',1),
('2-MzQ3ZjkxYjYtMDhmMC00M2Q1LWJmZGQtYzFiYTE0ZjFkODZkXzAxMA==','https://www.linkedin.com/in/hussein-osman-ab338445','Hussein Osman','2024-01-12T16:45:54+00','2024-01-12T16:45:54+00',1),
('2-MDJhNGE3MzktZGY3My00NTg5LWExMWYtOGE4NWMyMGJhN2Y4XzAxMA==','https://www.linkedin.com/in/leroy-brooks-jr-38b3261b1','Leroy Brooks jr','2024-01-11T22:17:33+00','2024-01-11T22:17:33+00',1),
('2-YTk0NjM3MjUtMWM2Yi00Njc3LTk2YTUtY2RkNjdjMmQ4MjY3XzAxMA==','https://www.linkedin.com/in/taylor-payton-5250b6ba','Taylor Payton','2024-01-11T20:25:41+00','2024-01-11T20:25:41+00',1),
('2-Zjg1MmIxZWUtNTMwZC00NzkwLTg2YjEtOTkzZjJmMGE0NGQzXzAxMA==','https://www.linkedin.com/in/andrew-nelson-65b1a97','Andrew Nelson','2023-12-21T01:30:01+00','2023-12-21T01:30:01+00',1),
('2-ODdiYjM2MTAtODRhMC00YjM5LTk1OGYtMWFmYzY4ZDA3Y2M4XzAxMw==','https://www.linkedin.com/in/kevin-mclaughlin-237b3431','Kevin McLaughlin','2023-12-19T20:45:22+00','2023-12-19T20:46:31+00',2),
('2-Y2EyYmFkMzItNWIxNy00MjBlLWEyMzctOTgzZGM5YTZiNDQzXzAxMA==','https://www.linkedin.com/in/tinablackwelder','Tina Blackwelder','2023-12-18T15:08:04+00','2023-12-18T15:08:04+00',1),
('2-OTQxOGU3NjMtZjNiMC00NjdjLTgzYzAtODZiMjRkMGFkYWE0XzAxMA==','https://www.linkedin.com/in/ben-kazanecki-0287b88a','Ben Kazanecki','2023-12-15T14:42:15+00','2023-12-15T14:42:15+00',1),
('2-OGQ2YWUyZmItN2M3NC00YjRhLThmNDctOWQ4NjE0NGUxMmY0XzAxMA==','https://www.linkedin.com/in/jessica-parsons-5aab72135','Jessica Parsons','2023-12-08T02:37:46+00','2023-12-08T22:05:07+00',4),
('2-MzU3MzczODEtODEwZi00OTI1LWI1ODQtN2Y5NDAyNDczMzA3XzAxMA==','https://www.linkedin.com/in/darryl-stallworth-24520775','darryl stallworth','2023-12-08T15:00:42+00','2023-12-08T15:37:42+00',3),
('2-YmU4MTc5OGYtNmE2MC00ODE0LWEwOWMtZWE3MmY3YTRjMGE4XzAxMA==','https://www.linkedin.com/in/dagmawi-asfaw-159433183','Dagmawi Asfaw','2023-12-07T04:29:36+00','2023-12-07T04:29:36+00',1),
('2-MjUzODc3YjItZjcwZC00ZGU0LTk5YzgtMDUwMTU1ZTRlOWIxXzAxMA==','https://www.linkedin.com/in/jonathan-blaker10','Jonathan  Blaker','2023-12-03T19:26:37+00','2023-12-06T00:00:59+00',2),
('2-OTVlYmI0MTQtNTU4ZC00YWIxLTk2NjAtOTQ4OTFmODFjNGNiXzAxMA==','https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan Dale','2023-11-28T15:39:33+00','2023-12-05T23:40:06+00',12),
('2-MTE5NWExMzMtNGRjOC00ZmY2LWI1MDgtYTI3YjUzODJkYWYwXzAxMg==','https://www.linkedin.com/in/eric-vossler-5a72715a','Eric Vossler','2023-12-05T02:40:37+00','2023-12-05T02:40:37+00',1),
('2-NGJiYzFhYTAtMzZkYy00NDQ3LWEwNDQtN2U3Njk3ODk5YzRhXzAxMA==','https://www.linkedin.com/in/yonar-candelario-67b885113','Yonar Candelario','2023-12-02T21:08:19+00','2023-12-02T21:08:19+00',1),
('2-OTJjZGM5ZjYtYmI2MS00ZjhhLTg5NGEtYTUyY2YxMTM5ODBiXzAxMA==','https://www.linkedin.com/in/mark-reyes-b199911b8','Mark Reyes','2023-12-01T16:02:19+00','2023-12-02T04:08:31+00',2),
('2-YjljMDM2MjItZTk3ZS00MDg3LWEyZDItOTYzMGFlNmIwZjc1XzAxMA==','https://www.linkedin.com/in/eric-willis-27a563141','Eric Willis','2023-12-01T05:54:28+00','2023-12-02T04:06:38+00',2),
('2-NTkxNGVlZTUtOTBiMS00NmIzLTg2ZDYtZDQ1Y2I4NWZiZTlkXzAxMA==','https://www.linkedin.com/in/mark-ward-8a793955','Mark Ward','2023-12-01T11:54:34+00','2023-12-01T11:54:34+00',1),
('2-YTE0ZTk3OWItNDgyMC00Njc4LWI1N2MtNTk2YzY5ZmM0ZmJiXzAxMw==','https://www.linkedin.com/in/nikkolas-bott-henderson-30548367','Nikkolas Bott-Henderson','2023-11-28T22:59:33+00','2023-11-30T21:10:42+00',4),
('2-OTEyOGNhYzktMDZkOC00ZTZiLTlhYzAtY2NhZjJkZTRmZDIzXzAxMg==','https://www.linkedin.com/in/bretdeeb','Bret Deeb','2023-11-28T23:00:34+00','2023-11-29T23:43:35+00',3),
('2-MTZmNzEzYjQtZjIzMi00OGQ5LWFhMGEtMGNmYWI2M2IyNmZkXzAxMA==','https://www.linkedin.com/in/cory-jarvis-7700605a','Cory Jarvis','2023-11-28T16:32:19+00','2023-11-29T19:21:25+00',17),
('2-YWJjMjI3ZjUtZTFlYi00YTc5LWEwYmItNzBmMGQ5OWZkNmJkXzAxMA==','https://www.linkedin.com/in/fabian-g-2732a0119','Fabian Gonzales','2023-11-28T21:32:35+00','2023-11-28T22:29:43+00',3),
('2-NTM4MWFlMDUtMGMxZS00YTY1LTg3MzUtZjNjOTRmN2I2OTM0XzAxMA==','https://www.linkedin.com/in/brandon-holley','Brandon Holley','2023-11-28T18:09:38+00','2023-11-28T18:17:36+00',4),
('2-MjQ1MThhY2UtZDQ5Zi00YzM3LWEzOGItOTViMGU1Y2JlZTg3XzAxMA==','https://www.linkedin.com/in/terrance-walker-319770146','Terrance Walker','2023-11-28T17:16:21+00','2023-11-28T17:37:24+00',5),
('2-NGQwYmE2NjUtZTU2MC00YzA3LTgzZjQtZWVlMjg2NTBjMjZlXzAxMA==','https://www.linkedin.com/in/john-vanderbeck-872602176','John Vanderbeck','2023-11-26T17:20:31+00','2023-11-26T17:20:31+00',1),
('2-ZjY5MGI0NjMtNmVkZS00YWE0LWIyMzMtMmE4MDEzYzcyZDcxXzAxMA==','https://www.linkedin.com/in/eric-swenson-19596b108','Eric Swenson','2023-11-21T16:47:24+00','2023-11-21T16:47:24+00',1),
('2-NWZhYzA3NWYtYjYzYy00ZmJhLTkxN2QtY2NkMTJkNDI5NWY1XzAxMg==','https://www.linkedin.com/in/scott-mccool-b035b815','Scott McCool','2023-11-21T03:40:12+00','2023-11-21T03:40:12+00',1),
('2-MzUzZDNlZjEtZGQwYi00NTM1LThiMDItMzE3Y2VkMzNkN2JjXzEwMA==',NULL,'Sara Molina','2026-05-19T05:04:43+00','2026-05-19T05:04:43+00',1),
('2-NWZkNjMyOTEtNDA5OC00ZDVlLWE3MWEtNmY5OTcwYmZmYjhiXzEwMA==',NULL,'LinkedIn Member','2026-05-11T17:11:40+00','2026-05-11T17:11:40+00',1),
('2-MTI1MjkzZDktYTA5MS00ZTU5LWE5NDMtZGEyMjYyOThhY2JiXzEwMA==',NULL,'Eric Hamberger','2026-05-04T14:31:27+00','2026-05-04T14:31:27+00',1),
('2-ODYyY2FkNmQtZjcyNC00YTVkLTk0ZWItYTQ5YWRlNTVmZTUxXzEwMA==',NULL,'LinkedIn Member','2026-05-01T04:19:35+00','2026-05-01T04:19:35+00',1),
('2-MWMxYzM1YjMtZGE0Ni00NWU0LWFkYWItMTVlMzRiYjhmYjBmXzEwMA==',NULL,'Lisa Williams','2026-04-25T21:14:53+00','2026-04-25T21:14:53+00',1),
('2-ZGViMTc1M2UtNWMyYS00ZWRhLTk2Y2YtODBkZDQyZDcyOTZkXzEwMA==',NULL,'LinkedIn Member','2026-04-18T05:24:18+00','2026-04-18T05:24:18+00',1),
('2-YTYwZWUyMGMtZDljMS00NjRiLWE3YzQtZDRlMmMwMDI5OTM3XzEwMA==',NULL,'Keri Ribardiere','2026-04-10T16:49:57+00','2026-04-10T16:49:57+00',1),
('2-YmMzOWZiZTQtMmI0My00ZTk4LWExMzUtYzNjNGQyYzNkNTY4XzEwMA==',NULL,'LinkedIn Member','2026-04-02T15:40:04+00','2026-04-02T15:40:04+00',1),
('2-Yzg3MmFkYzktMjY4Yy00MjQ0LTgwYjgtZTRkZTA1ZWUwYWVhXzEwMA==',NULL,'LinkedIn Member','2026-03-22T01:24:04+00','2026-03-22T01:24:04+00',1),
('2-ODFmMWIxZjYtZGI3Yy00NDM4LWIzNjgtMGNkNjAxMGVlNmJhXzEwMA==',NULL,'LinkedIn Member','2026-03-19T01:19:58+00','2026-03-19T01:19:58+00',1),
('2-NGMxNzM1ZGItNmM3Ny00NGI5LWIyYzItMTY5NGI2NDAxYTU3XzEwMA==',NULL,'Kristine McCarthy','2026-03-10T21:50:23+00','2026-03-10T21:50:23+00',1),
('2-NTUxZWNhYjktNjkxMy00Y2Y2LWFmYWItYWNjNGE3MTI1NWMyXzEwMA==',NULL,'LinkedIn Member','2026-02-26T13:24:38+00','2026-02-26T13:24:38+00',1),
('2-OTkwNzFmNDQtM2Q5YS00MmVhLTg5NTgtZWQ2NmI5NTUyMjhiXzEwMA==',NULL,'LinkedIn Member','2026-02-10T22:24:02+00','2026-02-10T22:24:02+00',1),
('2-MDU1ZjJhY2MtOWRhMy00ZTgzLTlkODYtNjJlYTczYmI2YjdkXzEwMA==',NULL,'Richard Freishtat, Ph.D.','2026-01-29T18:43:10+00','2026-01-29T18:43:10+00',1),
('2-NGFiOTgyMDgtNTdmZi00ODUzLWIzYTUtOTU4YTY2NGNkNmFiXzEwMA==',NULL,'MIT Professional Education','2026-01-21T21:47:22+00','2026-01-21T21:47:22+00',1),
('2-YTNmNGE2MzEtZDk1ZC00YjVkLTg1MTUtZjgyYzNmNzFiNDkzXzEwMA==',NULL,'Swapnil Shinde','2026-01-13T21:44:33+00','2026-01-13T21:44:33+00',1),
('2-ODJiOTM4NjctMGM3Yy00NzZmLWI5MDQtZmRiYjEzMGI5ZDk0XzEwMA==',NULL,'LinkedIn Member','2026-01-05T18:36:52+00','2026-01-05T18:36:52+00',1),
('2-NGIwZTU3NjMtYmY1OS00MWZkLTlkNmUtMTM1MjE5YjI3OTE3XzEwMA==',NULL,'LinkedIn Member','2025-11-30T17:07:42+00','2025-11-30T17:07:42+00',1),
('2-NDcyZjYxMDQtMmMxOC00NjY1LWEzYWYtZjg3NmY2MDBmOTllXzEwMA==',NULL,'LinkedIn Member','2025-11-01T14:50:06+00','2025-11-01T14:50:06+00',1),
('2-ZTE3YTQ3MDEtYTU5Ni00Y2NmLTkwMGQtZDVjZDg2ZWM0ODJhXzEwMA==',NULL,'LinkedIn Member','2025-10-24T13:15:53+00','2025-10-24T13:15:53+00',1),
('2-OTU5N2M3ODMtMWQwOC00OGI2LTg1NTUtYmNhM2E5MGQ2YzMzXzEwMA==',NULL,'Brad Killaly','2025-10-15T12:10:45+00','2025-10-15T12:10:45+00',1),
('2-YjVjZTk0ZjEtN2U4Mi00Nzk2LThlMTUtZDRmYjA4YTVkYWVmXzEwMA==',NULL,'LinkedIn Member','2025-10-10T02:09:09+00','2025-10-10T02:09:09+00',1),
('2-ZTdhZmM4ZTEtYjFiYy00ZTlmLWFkYzMtNzFlNzM4YTAzNzBjXzEwMA==',NULL,'LinkedIn Member','2025-10-06T14:44:40+00','2025-10-06T14:44:40+00',1),
('2-MDI1M2I1MjEtM2Q1Yy00NDljLTgwNzMtN2QwNThjNGQ0OGI5XzEwMA==',NULL,'Atlassian','2025-09-29T14:23:07+00','2025-09-29T14:23:07+00',1),
('2-OWE2MjBjOTctZjczNS00OTg1LWFkZWMtZGQzYjkzOTAxYmY0XzEwMA==',NULL,'Grace Schenkelberg','2025-09-17T15:20:12+00','2025-09-17T15:20:12+00',1),
('2-ZTIxODQ2ZTQtNWI4MS00MjU4LTlkNjItY2FjZjZkNmU5YmNmXzEwMA==',NULL,'Barbie Adler','2025-09-10T00:09:00+00','2025-09-10T00:09:00+00',1),
('2-MjdiNGRlZDQtOWUzMS00YWQ5LWI5NmYtYzA1ZTk4N2Q5MDYyXzEwMA==',NULL,'Matthew Bjonerud','2025-09-02T11:48:58+00','2025-09-02T11:48:58+00',1),
('2-NDk3NGUwNDYtMmZhYy00MmNmLTg5MjgtOWI4NWEzNjFjZDZmXzEwMA==',NULL,'LinkedIn Member','2025-08-25T12:50:33+00','2025-08-25T12:50:33+00',1),
('2-Y2ViMmJhY2ItOGZmNi00YWY4LTlhMTYtYWY0N2ExMzMxMzRhXzEwMA==',NULL,'LinkedIn Talent Solutions','2025-08-19T18:17:23+00','2025-08-19T18:17:23+00',1),
('2-YmQyMjE2YzEtNTA5Mi00Zjk3LThiMmItMmE5Njc2MWJkODFhXzEwMA==',NULL,'LinkedIn Member','2025-08-13T04:43:53+00','2025-08-13T04:43:53+00',1),
('2-YWVmYzliMTAtNmNmZS00MTkwLTlmNDItMzU1YjE0MGVkMTNjXzEwMA==',NULL,'LinkedIn Member','2025-08-06T00:42:45+00','2025-08-06T00:42:45+00',1),
('2-MmFiNjEyODAtZDljYy00NGFiLTg2NmEtYTAzMTA3ODU1Nzg4XzEwMA==',NULL,'LinkedIn Member','2025-07-29T22:01:18+00','2025-07-29T22:01:18+00',1),
('2-NWE5NjgwNGQtYmVkNy00NTY3LWEwOWYtZGE5NGM0OWRiOTI4XzEwMA==',NULL,'LinkedIn Member','2025-07-22T19:54:49+00','2025-07-22T19:54:49+00',1),
('2-OTI5NGFiNWYtMDhlYy00NDc4LWJmN2YtNTI4MDZhMzM3M2EwXzEwMA==',NULL,'Kristine McCarthy','2025-07-15T00:16:44+00','2025-07-15T00:16:44+00',1),
('2-OGU3OThlOWEtZWU1OS00NjYyLWIwMWUtNWU0NTE4MDE5ZjMwXzEwMA==',NULL,'LinkedIn Member','2025-07-07T23:40:36+00','2025-07-07T23:40:36+00',1),
('2-ZWQwMjZjMmQtMjFhMS00NzY1LTk1M2EtYTZlYjQyZTBlNTYzXzEwMA==',NULL,'LinkedIn Member','2025-06-29T03:00:15+00','2025-06-29T03:00:15+00',1),
('2-MTY2ZDY4NDYtMjc2YS00M2ZmLWJjNGYtM2IxMDVmM2U2Y2Y5XzEwMA==',NULL,'LinkedIn Talent Solutions','2025-06-25T12:57:36+00','2025-06-25T12:57:36+00',1),
('2-ZTUzYWU5MGUtNzVjYy00NGJmLWFjZjgtMDJkMmNlMWQ4ZjMxXzEwMA==',NULL,'LinkedIn Member','2025-06-12T03:01:59+00','2025-06-12T03:01:59+00',1),
('2-OTQxN2YwNWQtNzFkMi00NmVmLWE2ZmEtOTRjMzU2YzIxMDBiXzEwMA==',NULL,'LinkedIn Member','2025-06-03T02:38:46+00','2025-06-03T02:38:46+00',1),
('2-YjJjYTNjMGUtM2NlYy00NjdlLWEwZDMtMWNlZWYwZGE2ZWU2XzEwMA==',NULL,'LinkedIn Member','2025-05-20T02:54:39+00','2025-05-20T02:54:39+00',1),
('2-OGJhNTI5MGQtODI5Zi00NDUzLWI5NDgtYTM5NmUzNzg4NDk4XzEwMA==',NULL,'LinkedIn Member','2025-05-12T23:03:19+00','2025-05-12T23:03:19+00',1),
('2-MzRhMTU3YjctZGQ4Zi00ZTcyLTgwNmItYzdjOTg0MjJkMGZhXzEwMA==',NULL,'LinkedIn Member','2025-04-25T04:28:45+00','2025-04-25T04:28:45+00',1),
('2-NTI0NTkzMTgtYmU4Ni00Njg0LWE0MmUtNjUyMWNmODEwMDg5XzEwMA==',NULL,'Ellen Trader','2025-04-14T18:33:24+00','2025-04-14T18:33:24+00',1);
INSERT INTO _import_threads (conversation_id,other_url,other_name,first_date,last_date,msg_count) VALUES
('2-MmUwYzM5Y2YtYTNjMi00ODExLWIxMjUtNjU5NjhlMGZmZmFhXzEwMA==',NULL,'Nick Baum','2025-04-03T22:26:51+00','2025-04-03T22:26:51+00',1),
('2-MTBlZTA1MzUtYmExMS00NzY5LTk0MzctNjUwY2M3Yzk2YmY3XzEwMA==',NULL,'LinkedIn Member','2025-03-20T15:10:21+00','2025-03-20T15:10:21+00',1),
('2-MjdhMjY4MTgtMmYxNC00YzIyLWFlNWUtNjEzNGVkZjRlNDgyXzEwMA==',NULL,'LinkedIn Member','2025-03-11T14:48:35+00','2025-03-11T14:48:35+00',1),
('2-ZDRjMzM4ZTctMzc1My00ZDZhLTg2MGQtOTVhODQ3YjgyNWUwXzEwMA==',NULL,'MIT Professional Education','2025-02-28T04:06:43+00','2025-02-28T04:06:43+00',1),
('2-ZGE4ZWE1ZDItMDI5Mi00OTQ2LWFiZWQtM2Q2ZTVjZWY3MjkyXzEwMA==',NULL,'LinkedIn Member','2025-02-12T01:51:03+00','2025-02-12T01:51:03+00',1),
('2-OWY2NWMxMTQtZTFiZS00MzJmLWI1NWItZTA2NjhiYWMxMGQ5XzAxMA==',NULL,'LinkedIn Member','2025-02-03T20:51:29+00','2025-02-03T20:51:29+00',1),
('2-OTgwNWZiZGItYmM5Yi00ZDM3LTgyMmMtZGFhOTViYjA1ZmVlXzAxMA==',NULL,'LinkedIn Member','2024-12-20T14:48:21+00','2024-12-20T14:48:21+00',1),
('2-M2Q1ZjEzMmMtYWI0Zi00ODc3LWIxM2UtYjM3OGIwYWY5ZmIyXzAxMA==',NULL,'LinkedIn Member','2024-12-11T20:32:20+00','2024-12-11T20:32:20+00',1),
('2-N2M3ZTVmYjItNjM2Ni00ZWRiLWJiMjMtYmQ2MWZlNWU2N2I1XzAxMA==',NULL,'Aston Martin Lagonda Ltd','2024-11-19T21:17:40+00','2024-11-19T21:17:40+00',1),
('2-NWFlNTFlZTctYTk0My00ZTIzLTlkY2QtYzlkNjAyNTNkYTRkXzAxMA==',NULL,'LinkedIn Member','2024-11-05T13:45:43+00','2024-11-05T13:45:43+00',1),
('2-ZDJmMTVlODktMzdmYi00MWEwLTgzYWItNzNjNWVhODBhNmY0XzAxMg==',NULL,'American Express Business','2024-08-06T02:17:55+00','2024-08-06T02:17:55+00',1),
('2-ZDdlNmU5ZTktNjYxYi00YzliLWIxZTEtNDdmYTRlMWZmOWYzXzAxMA==',NULL,'American Express Business','2024-07-02T23:17:50+00','2024-07-02T23:17:50+00',1),
('2-ZTYxN2QyMGMtOGIyOC00NDlkLTliZGQtZGY1ZDMzM2Y0Nzg5XzAxMA==',NULL,'LinkedIn Member','2024-06-11T18:44:08+00','2024-06-11T18:44:08+00',1),
('2-MTFkMGZmZjQtYTE2OS00N2U4LWE1MmEtNDFkNmI3Nzk1NDRlXzAxMA==',NULL,'LinkedIn Member','2024-05-28T20:14:27+00','2024-05-28T20:14:27+00',1),
('2-NWQwNjdlMDEtNjFiNy00OTEyLWE0NDctMGZmZjZhZWVhZjQ1XzAxMA==',NULL,'Marquis Who''s Who','2024-05-01T21:53:24+00','2024-05-01T21:53:24+00',1),
('2-MzZjMTA1OTgtODZhOC00NzNjLWE5MzktMTFmYzI5YTE3N2RmXzAxMA==',NULL,'Sarah Walz from LinkedIn','2024-04-15T20:19:31+00','2024-04-15T20:19:31+00',1),
('2-MTMwYWQ4NDItY2FhYy00M2Y0LWE5OWMtZmRiOTQ1YzJkMjBkXzAxMA==',NULL,'American Express Business','2024-04-10T19:44:43+00','2024-04-10T19:44:43+00',1),
('2-ZmViYmI1ODQtMTc3Yi00Y2JmLWFlOTItYjBjZTFmMDhhMzBhXzAxMA==',NULL,'LinkedIn Member','2024-03-26T21:17:28+00','2024-03-26T21:17:28+00',1),
('2-NGRjMjU4OGMtMGI1Zi00OWM0LWFjN2MtY2E4MjJjZGVjNWUxXzAxMA==',NULL,'LinkedIn Member','2024-03-13T17:26:21+00','2024-03-13T17:26:21+00',1),
('2-MzdkYzdkY2EtZWE3MS00MDllLTgwMmYtY2Y5M2JmZjU1NTgwXzAxMA==',NULL,'Sarah Walz from LinkedIn','2024-02-29T21:14:38+00','2024-02-29T21:14:38+00',1),
('2-N2MwMDMxNTYtMTcyNi00NmUzLThiMzgtYTljNDVlNDY5YWFlXzAxMA==',NULL,'LinkedIn Member','2024-02-14T01:50:14+00','2024-02-14T01:50:14+00',1),
('2-M2IyNTNhYzktZTZjMS00YzFmLThkOGMtYzlmYjFjMDM2NTZlXzAxMA==',NULL,'LinkedIn Member','2024-01-19T00:18:51+00','2024-01-19T00:18:51+00',1),
('2-MTIyODQ0YmUtZWIxOC00NjNiLTg1YmEtZWI4ZTBjNzAwNzY2XzAxMA==',NULL,'Sarah Walz from LinkedIn','2024-01-13T19:21:23+00','2024-01-13T19:21:23+00',1),
('2-OTUwY2NkNzgtN2JjMS00N2Y5LTg0YTAtMWQ5NjU2NTgxZGY3XzAxMA==',NULL,'LinkedIn Member','2023-12-20T14:32:12+00','2023-12-20T14:32:12+00',1),
('2-NTRjMmQxYzItNGNjNi00YmE4LTk2OWYtMWIxZmJiNjQyMTZkXzAxMg==',NULL,'LinkedIn Member','2023-12-12T13:23:15+00','2023-12-12T13:23:15+00',1),
('2-ODAxYWM2NWQtNzlkNS00ZGIzLTkxMTQtZTZlYTI2ZjYzN2Y3XzAxMA==',NULL,'LinkedIn Member','2023-12-05T03:13:32+00','2023-12-05T03:13:32+00',1),
('2-OGFlNmZlMmQtZWU0ZC00Y2Y1LTgwNWQtODNiZGE3MzFmMjJiXzAxMA==',NULL,'LinkedIn Member','2023-09-05T14:21:48+00','2023-09-05T14:21:48+00',1),
('2-ODY1ODUxNDEtNzM4Zi00OGJmLThlYzYtMzdhY2E5ZjMyNjI0XzAxMA==',NULL,'LinkedIn Member','2022-10-28T16:01:09+00','2022-10-28T16:01:09+00',1),
('2-ZDUwMWY4MDAtNTM3Yi01NDRjLTk5Y2MtOWE1NTFlODU1ZTIwXzAxMA==',NULL,'Arin from LinkedIn','2020-07-10T21:22:13+00','2020-07-10T21:22:13+00',1),
('2-YTUzNzRiMTQtMzdjZi00MDRhLWFhNTItMTdlMDk5MTM3OGEyXzAxMw==','https://www.linkedin.com/in/annachen19851124','Anna Chen','2023-12-31T22:06:17+00','2023-12-31T22:06:17+00',1),
('2-NmNkZWM2MzAtNjEzMy00ZTIxLWE2ODAtOGQzYTFkMmI3M2E1XzAxMw==','https://www.linkedin.com/in/mitch-gold-55338b1a1','Mitch Gold','2023-12-10T11:31:22+00','2023-12-10T11:31:22+00',1);

INSERT INTO _import_connections (url,first_name,last_name,email,company,position,connected_on) VALUES
('https://www.linkedin.com/in/darryl-best-1ab34b184','Darryl','Best',NULL,'Air Canada','Director of Line Maintenance, Toronto','2026-05-24T00:00:00+00'),
('https://www.linkedin.com/in/lindsay-parrott-2a923b37a','Lindsay','Parrott',NULL,'RealClean Aircraft Detailing','Franchise Owner / Operator','2026-05-20T00:00:00+00'),
('https://www.linkedin.com/in/kimberly-sanchez-aviation','Kimberly','Kozlov',NULL,'Spirit Airlines','Director, Maintenance Planning','2026-05-18T00:00:00+00'),
('https://www.linkedin.com/in/don-meyns-b05435375','Don','Meyns',NULL,'Awesome Products Corp','President','2026-05-16T00:00:00+00'),
('https://www.linkedin.com/in/brett-bailey-','Brett','Bailey',NULL,'Leadership In Flight Training Academy','Aircraft Maintenance Technician','2026-05-16T00:00:00+00'),
('https://www.linkedin.com/in/jeffrey-kimmey-jr-b4b73678','Jeffrey','Kimmey Jr.',NULL,'Executive Jet Management','Fleet Maintenance Manager','2026-05-15T00:00:00+00'),
('https://www.linkedin.com/in/samuel-alfrey','Sammy','Alfrey',NULL,'RealClean Aircraft Detailing','Owner/Operator','2026-05-11T00:00:00+00'),
('https://www.linkedin.com/in/garen-harout-mazedjian-4454a871','Garen Harout','Mazedjian',NULL,'Nike','Director of Aviation Maintenance','2026-05-11T00:00:00+00'),
('https://www.linkedin.com/in/anne-marie-zwerg','Anne Marie','Zwerg, PhD, MIM',NULL,'RealClean Aircraft Detailing','Executive Owner','2026-05-10T00:00:00+00'),
('https://www.linkedin.com/in/chelsea-groves-7551a3a1','Chelsea','Groves',NULL,'RealClean Aircraft Detailing','Owner','2026-05-10T00:00:00+00'),
('https://www.linkedin.com/in/cristian-mansilla-6b6a5890','Cristian','Mansilla',NULL,'Xtreme Aviation LLC','Director of line Maintenance','2026-05-08T00:00:00+00'),
('https://www.linkedin.com/in/dale-cash-22b064222','Dale','Cash',NULL,'Republic Airways, Inc.','Director of Maintenance','2026-05-04T00:00:00+00'),
('https://www.linkedin.com/in/kurtwiegers','Kurt','Wiegers',NULL,'RealClean Aircraft Detailing','Owner | RealClean Aircraft Detailing Cape Cod and Rhode Island','2026-05-04T00:00:00+00'),
('https://www.linkedin.com/in/joseph-schwartz-09a0a7178','Joseph','Schwartz',NULL,'Self-employed','Business Owner','2026-05-04T00:00:00+00'),
('https://www.linkedin.com/in/ray-shahifar-7b06212a5','Ray','Shahifar','rshahifar@145procraft.com','FAA Part 145 Accountable Manager/Chief Inspector','Director of maintenance, 145 Repair station Accountable Manager & Chief Inspector','2026-05-04T00:00:00+00'),
('https://www.linkedin.com/in/jerel-buckley-66539512','Jerel','Buckley',NULL,'Coach USA','Maintenance Manager','2026-05-02T00:00:00+00'),
('https://www.linkedin.com/in/barney-whaley-82868b9b','Barney','Whaley',NULL,'National Airlines','Director of Maintenance','2026-05-01T00:00:00+00'),
('https://www.linkedin.com/in/aghr','Antonio','Garcia, SHRM-CP',NULL,'Frontier Airlines','Director, Talent','2026-04-30T00:00:00+00'),
('https://www.linkedin.com/in/benjamin-hulshoff-713702269','Benjamin','Hulshoff',NULL,'Bristow Group','Director of Maintenance','2026-04-30T00:00:00+00'),
('https://www.linkedin.com/in/christopher-wilkes-cam-b33819131','Christopher','Wilkes, CAM',NULL,'West Star Aviation, LLC','Regional Sales Manager - Northeast','2026-04-29T00:00:00+00'),
('https://www.linkedin.com/in/ray-filbeck-8742565a','Ray','Filbeck',NULL,'Appalachian Aero Group','Director of Maintenance','2026-04-28T00:00:00+00'),
('https://www.linkedin.com/in/peter-sterling-a430b591','Peter','Sterling',NULL,'Gulfstream','Service Center Maintenance Supervisor','2026-04-27T00:00:00+00'),
('https://www.linkedin.com/in/david-sepulveda-335a7850','David','Sepulveda',NULL,'RealClean Miami','CEO','2026-04-27T00:00:00+00'),
('https://www.linkedin.com/in/ricky-vongsiprasom','Ricky','Vongsiprasom',NULL,'Stevens Aerospace and Defense Systems, LLC.','AOG Dispatch/Sr. Technician','2026-04-27T00:00:00+00'),
('https://www.linkedin.com/in/skyleroxford','Skyler','Oxford',NULL,'RealClean Aircraft Detailing','Sales And Marketing Specialist','2026-04-27T00:00:00+00'),
('https://www.linkedin.com/in/andrew-kiehl-5b07136','Andrew','Kiehl',NULL,'Executive Jet Management','VP, Fleet Maintenance','2026-04-27T00:00:00+00'),
('https://www.linkedin.com/in/jones-mitch','Mitch','Jones',NULL,'RealClean Aircraft Detailing','Vice President Operations','2026-04-27T00:00:00+00'),
('https://www.linkedin.com/in/darrienpeoples','Darrien','Peoples',NULL,'Honeywell','Senior Aircraft Technician/ Gulfstream G600 Lead Technician','2026-04-27T00:00:00+00'),
('https://www.linkedin.com/in/mchugh-brian','Brian','McHugh',NULL,'Alaska Airlines','Director of Engineering Programs','2026-04-27T00:00:00+00'),
('https://www.linkedin.com/in/bronson-harris-10a29269','Bronson','Harris',NULL,'RealClean Aircraft Detailing','Owner','2026-04-27T00:00:00+00'),
('https://www.linkedin.com/in/robriccardo','Robert','Riccardo',NULL,'RealClean Aircraft Detailing','President of RealClean Aircraft Detailing Palm Beach','2026-04-27T00:00:00+00'),
('https://www.linkedin.com/in/joe-nemat-2673b0112','Joe','Nemat',NULL,'Boeing','Senior Airplane Systems Training Lead','2026-04-26T00:00:00+00'),
('https://www.linkedin.com/in/tina-ho-0044383b8','Tina','Ho',NULL,'RealClean Aircraft Detailing','Owner Operator of Reno-Tahoe','2026-04-26T00:00:00+00'),
('https://www.linkedin.com/in/preston-griffin-ok','Preston','Griffin',NULL,'GP JetWorks','Owner','2026-04-24T00:00:00+00'),
('https://www.linkedin.com/in/mark-w-melby-54464910','Mark W.','Melby',NULL,'Aloft Evermōr','Founder & CEO','2026-04-24T00:00:00+00'),
('https://www.linkedin.com/in/andrew-schumpp-85a96bb','Andrew','Schumpp',NULL,'CBAir LLC','Director Of Maintenance','2026-04-23T00:00:00+00'),
('https://www.linkedin.com/in/chris-kiefer-4ba5721a7','Chris','Kiefer',NULL,'Velocity Maintenance Solutions LLC','Director of Maintenance','2026-04-22T00:00:00+00'),
('https://www.linkedin.com/in/uriah-savary-831b393b9','Uriah','Savary',NULL,'Elyon Integrated Systems','Chief Executive Officer','2026-04-20T00:00:00+00'),
('https://www.linkedin.com/in/sean-donovan-7789858b','Sean','Donovan',NULL,'DHL Technical Services Powered by Kalitta, LLC','Manager of Safety','2026-04-16T00:00:00+00'),
('https://www.linkedin.com/in/samuel-ayala-257a20213','Samuel','Ayala',NULL,'Airshare','Maintenance Coordinator','2026-04-14T00:00:00+00'),
('https://www.linkedin.com/in/patrick-brody-mckenna-b034b920a','Patrick "Brody"','Mckenna',NULL,'Western Aircraft','Director of MRO Operations','2026-04-14T00:00:00+00'),
('https://www.linkedin.com/in/christopher-botelho-271b13132','Christopher','Botelho',NULL,'Vista Aircraft Maintenance Van Nuys, LLC','Lead Aircraft Maintenance Technician','2026-04-01T00:00:00+00'),
('https://www.linkedin.com/in/joseph-dimatteo','Joseph','DiMatteo',NULL,'Lowe''s Companies, Inc.','Maintenance Manager','2026-03-31T00:00:00+00'),
('https://www.linkedin.com/in/jddulebohn','James','Dulebohn',NULL,'RealClean Aircraft Detailing Greenville–Spartanburg','CEO','2026-03-30T00:00:00+00'),
('https://www.linkedin.com/in/justin-pynckels-mba-4a085b81','Justin','Pynckels, MBA',NULL,'UPS','Aircraft Line Maintenance Supervisor','2026-03-30T00:00:00+00'),
('https://www.linkedin.com/in/luis-tellez-3913505b','Luis','Tellez',NULL,'Atlas Air','Maintenance Manager','2026-03-30T00:00:00+00'),
('https://www.linkedin.com/in/joseph-pisciotta-555436b1','Joseph','Pisciotta',NULL,'PSA Airlines, Inc.','Maintenance Manager','2026-03-29T00:00:00+00'),
('https://www.linkedin.com/in/justin-beason-cam-249711177','Justin','Beason, CAM',NULL,'Rheem Manufacturing Company','Aviation Director of Maintenance','2026-03-28T00:00:00+00'),
('https://www.linkedin.com/in/aircraft-service-providers-llc-85667b32a','Aircraft','Service Providers LLC',NULL,NULL,NULL,'2026-03-28T00:00:00+00'),
('https://www.linkedin.com/in/scott-apple-55850153','Scott','Apple',NULL,'Discount Tire','Assistant Director of Aircraft Maintenance','2026-03-28T00:00:00+00'),
('https://www.linkedin.com/in/marty-grier-cam-pmp-7b1a8413','Marty','Grier CAM/PMP',NULL,'The Home Depot','Director, Maintenance Aviation','2026-03-28T00:00:00+00'),
('https://www.linkedin.com/in/josh-starr-570182283','Josh','Starr',NULL,'American Airlines','Supervisor of Aircraft Maintenance','2026-03-28T00:00:00+00'),
('https://www.linkedin.com/in/michele-pelton-216b853b','Michele','Pelton',NULL,'UPS','Director of Materials','2026-03-25T00:00:00+00'),
('https://www.linkedin.com/in/mike-gallas-2a922b5','Mike','Gallas',NULL,'UPS','Director','2026-03-25T00:00:00+00'),
('https://www.linkedin.com/in/todd-cofer-22a4a5304','Todd','Cofer',NULL,'Gulf Coast Aviation Services, LLC','Director of Maintenance','2026-03-25T00:00:00+00'),
('https://www.linkedin.com/in/jack-moore-a7708367','Jack','Moore',NULL,'National Airlines','Heavy Maintenance Materials Coordinator','2026-03-24T00:00:00+00'),
('https://www.linkedin.com/in/orel-elbaz-564491213','Orel','Elbaz',NULL,'Clay Lacy Aviation','Operations Manager; MRO Services','2026-03-23T00:00:00+00'),
('https://www.linkedin.com/in/christina-richason-5a8b9335','Christina','Richason',NULL,'CommuteAir','Director, Material Planning, Repair, and Contracts','2026-03-23T00:00:00+00'),
('https://www.linkedin.com/in/jim-lufrano-9432368','Jim','Lufrano',NULL,'Spirit Airlines','Director of Line Maintenance','2026-03-22T00:00:00+00'),
('https://www.linkedin.com/in/cody-morris-34984740','Cody','Morris',NULL,'Jet Aviation','Director of Maintenance','2026-03-21T00:00:00+00'),
('https://www.linkedin.com/in/derek-mathews-0b558079','Derek','Mathews',NULL,'Federal Aviation Administration','Avionics Maintenance Inspector','2026-03-21T00:00:00+00'),
('https://www.linkedin.com/in/scott-bjergo-96746695','Scott','Bjergo',NULL,'JSX','Director of Line Maintenance','2026-03-21T00:00:00+00'),
('https://www.linkedin.com/in/mike-horan-46704a337','Mike','Horan',NULL,'Thrive Aviation','Director of Maintenance','2026-03-21T00:00:00+00'),
('https://www.linkedin.com/in/robert-jacobs-77152539','Robert','Jacobs',NULL,'Berry Aviation, Inc','Director Of Maintenance','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/vortex-aircraft-services-3a97b5244','Vortex Aircraft','Services',NULL,'Vortex Aircraft Services','Operations','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/jeremiah-kissick','Jeremiah','Kissick',NULL,'DF Aviation','Director of Maintenance','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/brittney-weaser-bb945318','Brittney','Weaser',NULL,'CommuteAir','Aircraft Maintenance Technician','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/jonah-richie-50a878377','Jonah','Richie',NULL,'BODE AVIATION, INC.','Director of Maintenance','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/brian-sprecher-43321979','Brian','Sprecher',NULL,'Sky Aircraft Maintenance','Director of MRO Maintenance Sales, Marketing & Business Development','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/shawn-petersen-6a241b129','Shawn','Petersen',NULL,'Northern Jet','VP of Maintenance','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/eric-moberg-a139ab203','Eric','Moberg',NULL,'Jet Aviation','Director of Maintenance','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/jeff-jackson-9b91373','Jeff','Jackson',NULL,'Southwest Airlines','Senior Buyer','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/stephanus-ackermann-36831a225','Stephanus','Ackermann',NULL,'PSA Airlines, Inc.','Maintenance Operations Supervisor','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/andrew-arcuri-60aa6721b','Andrew','Arcuri',NULL,'Classic Service ll, LLC Flight Operations','Director of Aircraft Maintenance','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/maria-de-jesus-0807bb37','MARIA','DE JESUS',NULL,'Velocity Maintenance Solutions LLC','Structures Manager','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/danny-santiago-53b2b093','Danny','Santiago',NULL,'Banyan Air Service','Director of MRO Sales','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/michael-w-johnson-56bb93381','Michael W.','Johnson',NULL,'Georgia Crown Distributing Co','Director of Aircraft Maintenance','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/christopher-reverski-41074342','Christopher','Reverski',NULL,'Alaska Airlines','Director of Maintenance-SEA','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/michael-lineaweaver-186869243','Michael','Lineaweaver',NULL,'Brainerd Helicopter Service','Assistant Director of Maintenance','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/kyle-long-aviation','Kyle','Long',NULL,'Heritage Aviation','Director of Maintenance','2026-03-20T00:00:00+00');
INSERT INTO _import_connections (url,first_name,last_name,email,company,position,connected_on) VALUES
('https://www.linkedin.com/in/david-phillips-02b59a22','David','Phillips',NULL,'Clay Lacy Aviation','Director of Maintenance G550/Global 7500','2026-03-20T00:00:00+00'),
('https://www.linkedin.com/in/paul-diaz-a03a30187','Paul','Diaz',NULL,'Discovery Jets','Director Of Maintenance','2026-03-19T00:00:00+00'),
('https://www.linkedin.com/in/tetiana-lisina-1b451a144','Tetiana','Lisina',NULL,'MyFAA.com','Co-founder & President at MyFAA.com','2026-03-10T00:00:00+00'),
('https://www.linkedin.com/in/tyler-vanderhoef-b61764230','Tyler','Vanderhoef',NULL,'Makers Air','Captain','2026-01-29T00:00:00+00'),
('https://www.linkedin.com/in/svenspringwald','Sven','Springwald',NULL,'SPARTA Networking','President','2026-01-13T00:00:00+00'),
('https://www.linkedin.com/in/tenille-thomas-08467b357','Tenille','Thomas',NULL,'Spirit Airlines','Team Lead','2026-01-13T00:00:00+00'),
('https://www.linkedin.com/in/500feetaheadllc','Ethan','F.',NULL,'500 Feet Ahead Staffing, LLC','President','2026-01-13T00:00:00+00'),
('https://www.linkedin.com/in/chris-s-193081188','Chris','Smith',NULL,'CAPITAL JETS','Director of Maintenance','2025-10-24T00:00:00+00'),
('https://www.linkedin.com/in/stanford-norwood-a43798120','Stanford','Norwood',NULL,'ST Engineering','Aviation Mechanic','2025-10-07T00:00:00+00'),
('https://www.linkedin.com/in/mark-andrew-orido-494b2341','Mark Andrew','Orido',NULL,'Heatcon Composite Systems','Sales Manager','2025-10-07T00:00:00+00'),
('https://www.linkedin.com/in/jeff-carson-34272b6a','Jeff','Carson',NULL,'Dept of Air Force','AETC 19AF Program Manager','2025-09-01T00:00:00+00'),
('https://www.linkedin.com/in/charles-walrod-52610563','Charles','Walrod',NULL,'flyExclusive','Assitant Director of Maintenance','2025-08-20T00:00:00+00'),
('https://www.linkedin.com/in/john-simon-405189153','John','Simon',NULL,'ELLIOTT AVIATION OF THE QUAD CITIES, INC.','Maintenance Estimator','2025-08-19T00:00:00+00'),
('https://www.linkedin.com/in/todd-hattaway-aviation-mgmt','Todd','Hattaway',NULL,'Vista America','Senior Vice President','2025-08-18T00:00:00+00'),
('https://www.linkedin.com/in/curtisseag','Curtis','Seagondollar',NULL,'Jet Linx','Director Of Maintenance','2025-08-09T00:00:00+00'),
('https://www.linkedin.com/in/scott-coryea','Scott','Coryea',NULL,'Sky River Management LLC','Director of Maintenance','2025-08-01T00:00:00+00'),
('https://www.linkedin.com/in/ernesto-rodriguez-4693a4103','Ernesto','Rodriguez',NULL,'Southwest Airlines','Aircraft Maintenance Supervisor','2025-07-30T00:00:00+00'),
('https://www.linkedin.com/in/kevinedwardcox','Kevin','Cox','kevinedwardcox@gmail.com','Atlantic Aviation','Chief Executive Officer of Vertiports by Atlantic','2025-07-29T00:00:00+00'),
('https://www.linkedin.com/in/erica-hernandez-9bb9b0136','Erica','Hernandez',NULL,'Banyan Air Service','MRO Administrative Manager','2025-07-25T00:00:00+00'),
('https://www.linkedin.com/in/toby-harper-ab9172133','Toby','Harper',NULL,'Business Owner','Independent Researcher','2025-07-24T00:00:00+00'),
('https://www.linkedin.com/in/christopher-pratt-33471919','Christopher','Pratt',NULL,'Alaska Airlines','Director, Maintenance Operations Safety','2025-07-22T00:00:00+00'),
('https://www.linkedin.com/in/rick-tinker-18570a159','Rick','Tinker',NULL,'Priority Jet','Director Of Maintenance','2025-07-22T00:00:00+00'),
('https://www.linkedin.com/in/justin-wilmoth-aa5b0332','justin','wilmoth',NULL,'Allegiant','Maintenance Control supervisor','2025-07-19T00:00:00+00'),
('https://www.linkedin.com/in/jessejhauch','Jesse','Hauch',NULL,'Self-employed','FAA Designated Mechanic Examiner','2025-07-18T00:00:00+00'),
('https://www.linkedin.com/in/susanjohnson5','Susan','Johnson',NULL,'VP Aviation Technical Services','Director of Marketing and Communications','2025-07-17T00:00:00+00'),
('https://www.linkedin.com/in/gustavo-escobedo-morales-555ab5186','Gustavo','Escobedo-Morales',NULL,'Delta Air Lines','Aircraft Maintenance Technician','2025-07-17T00:00:00+00'),
('https://www.linkedin.com/in/thomashagy','Thomas','Hagy',NULL,'flyExclusive','Vice President of Maintenance Operations','2025-07-15T00:00:00+00'),
('https://www.linkedin.com/in/thomas-barton-35a7976a','Thomas','Barton',NULL,'AirResource Group','Director Of Maintenance','2025-07-15T00:00:00+00'),
('https://www.linkedin.com/in/michael-stephenson-326212141','Michael','Stephenson',NULL,'Marathon Petroleum Corporation','Aircraft Maintenance Supervisor','2025-07-15T00:00:00+00'),
('https://www.linkedin.com/in/lazaro-lopez-834172284','Lazaro','Lopez',NULL,'Global Crossing Airlines','Aircraft Maintenance Controller','2025-07-15T00:00:00+00'),
('https://www.linkedin.com/in/bryan-diaz-35171887','Bryan','Diaz',NULL,'American Airlines','Aircraft Maintenance Supervisor','2025-07-15T00:00:00+00'),
('https://www.linkedin.com/in/daniel-clark-874231a8','Daniel','Clark',NULL,'EquityJet','Director of Maintenance','2025-07-14T00:00:00+00'),
('https://www.linkedin.com/in/bill-denny','Bill','Denny',NULL,'Jet Excellence','Director of Maintenance - Red Wing Aviation dba JetExcellence','2025-07-13T00:00:00+00'),
('https://www.linkedin.com/in/philip-rhodes-1b903b8','Philip','Rhodes',NULL,'Clay Lacy Aviation','Director of Maintenance','2025-07-08T00:00:00+00'),
('https://www.linkedin.com/in/tim-reaid-jr-832a5b2a3','Tim','Reaid Jr',NULL,'STS Line Maintenance','Aircraft Maintenance Technician','2025-07-08T00:00:00+00'),
('https://www.linkedin.com/in/randy-wirkkala-6b037042','Randy','Wirkkala',NULL,'Global Aviation Inc.','Director Of Maintenance','2025-07-06T00:00:00+00'),
('https://www.linkedin.com/in/ruben-vega-murillo-5816832b','Ruben','Vega-Murillo',NULL,'Google','Aircraft Maintenance Supervisor','2025-07-04T00:00:00+00'),
('https://www.linkedin.com/in/michael-lavin-01788469','Michael','Lavin',NULL,'Clay Lacy Aviation','Aviation Maintenance  Controller','2025-07-01T00:00:00+00'),
('https://www.linkedin.com/in/aaron-bankston-0574a4179','Aaron','Bankston',NULL,'Reynolds Jet','Lead Aircraft Maintenance Technician','2025-06-30T00:00:00+00'),
('https://www.linkedin.com/in/christopher-redding-857772142','Christopher','Redding',NULL,'Allegiant','Vice President of Maintenance and Engineering','2025-06-30T00:00:00+00'),
('https://www.linkedin.com/in/john-carter-524b1a5a','John','Carter',NULL,'Reynolds Jet','Vice President, Maintenance','2025-06-30T00:00:00+00'),
('https://www.linkedin.com/in/alex-talarczyk','Alex','Talarczyk',NULL,'Jets MRO','Vice President Operations','2025-06-30T00:00:00+00'),
('https://www.linkedin.com/in/douglass-hansen-2416a840','Douglass','Hansen',NULL,'Elizabeth City State University','Director of Aircraft Maintenance','2025-06-29T00:00:00+00'),
('https://www.linkedin.com/in/brad-ongna-4b1a9430','Brad','Ongna',NULL,'Stryker','Director of Maintenance and Ground Operations','2025-06-27T00:00:00+00'),
('https://www.linkedin.com/in/natedietsch','Nate','Dietsch',NULL,'Netflix','Director of Aircraft Maintenance','2025-06-25T00:00:00+00'),
('https://www.linkedin.com/in/chip-bonner-5a2b662','Chip','Bonner',NULL,'Tubreaux Aviation','Director Of Maintenance','2025-06-25T00:00:00+00'),
('https://www.linkedin.com/in/nick-baker-a481a6a3','Nick','Baker',NULL,'Wheels Up','Director of Maintenance','2025-06-24T00:00:00+00'),
('https://www.linkedin.com/in/luis-osuna-409628120','Luis','Osuna',NULL,'Vortex aircraft Services','Director Of Maintenance','2025-06-24T00:00:00+00'),
('https://www.linkedin.com/in/carl-yutrzenka','Carl','Yutrzenka',NULL,'Hallmark University','Aviation Maintenance Technician Instructor','2025-06-22T00:00:00+00'),
('https://www.linkedin.com/in/sean-adams-53a4a1ab','Sean','Adams',NULL,'Kalitta Air','Vice President of Maintenance and Engineering','2025-06-22T00:00:00+00'),
('https://www.linkedin.com/in/heidi-maddock-796a6118b','Heidi','Maddock',NULL,'Aviation Institute of Maintenance','Director of Aviation Maintenance','2025-05-18T00:00:00+00'),
('https://www.linkedin.com/in/rob-cox-91004a70','Rob','Cox',NULL,'Clay Lacy Aviation','Director of Technical Services','2025-05-15T00:00:00+00'),
('https://www.linkedin.com/in/richard-mart%C3%ADnez-b87683171','Richard','Martínez',NULL,'Jet Aviation','Assistant Maintenance Manager','2025-05-14T00:00:00+00'),
('https://www.linkedin.com/in/christopher-mccartney-b38479313','Christopher','McCartney',NULL,'PSA Airlines, Inc.','Chief Operations Officer','2025-05-14T00:00:00+00'),
('https://www.linkedin.com/in/michael-middleton-15861a114','Michael','Middleton',NULL,'NorCal Roofing & Gutters','Commercial Project Manager','2025-05-12T00:00:00+00'),
('https://www.linkedin.com/in/emilee-hatfield-3aa629273','Emilee','Hatfield',NULL,'DAVCOR AVIATION SERVICES INC.','Technical Recruiting Account Manager','2025-05-12T00:00:00+00'),
('https://www.linkedin.com/in/advanced-aircraft-research-a-222689174','Advanced Aircraft Research','Aircraft',NULL,'Advanced Aircraft Research','President','2025-05-12T00:00:00+00'),
('https://www.linkedin.com/in/richard-kovacs-451051358','Richard','Kovacs',NULL,'Contour Aviation','Manager of Maintenance Operations','2025-05-12T00:00:00+00'),
('https://www.linkedin.com/in/michael-miner','Michael','Miner',NULL,'Proserv Aviation','Chief Executive Officer','2025-05-12T00:00:00+00'),
('https://www.linkedin.com/in/eric-smith-53228477','Eric','Smith',NULL,'Banyan Air Service','Avionics Manager','2025-04-24T00:00:00+00'),
('https://www.linkedin.com/in/anthony-johnson-32881b227','Anthony','Johnson',NULL,'National Airlines','Senior Maintenance Manager','2024-06-11T00:00:00+00'),
('https://www.linkedin.com/in/chris-corrington-b173a920','Chris','Corrington',NULL,'Jet Excellence','Executive Vice President, Maintenance','2024-05-01T00:00:00+00'),
('https://www.linkedin.com/in/jason-meynarez-6649165','Jason','Meynarez',NULL,'trmg | The Risk Management Group','Aviation Insurance Product Manager','2024-04-18T00:00:00+00'),
('https://www.linkedin.com/in/jonathan-p-a923b5b4','Jonathan','Pizarro',NULL,'Southwest Airlines','Aircraft Maintenance Technician','2024-04-08T00:00:00+00'),
('https://www.linkedin.com/in/justin-loyd-69b3a537','Justin','Loyd',NULL,'Lufthansa Technik','Aircraft Component Tech / Painter','2024-03-12T00:00:00+00'),
('https://www.linkedin.com/in/gregory-reyes-estevez-8b1642236','Gregory','Reyes Estevez',NULL,'Piedmont Airlines','Aircraft Maintenance Technician','2024-03-12T00:00:00+00'),
('https://www.linkedin.com/in/brandon-clausen-2044a37a','Brandon','Clausen',NULL,'Sun Aicraft Support','Business Owner','2024-03-11T00:00:00+00'),
('https://www.linkedin.com/in/brian-felt-ba415b117','Brian','Felt',NULL,'Sun Air Jets','Director of Maintenance','2024-03-08T00:00:00+00'),
('https://www.linkedin.com/in/christopher-a-lehr','Christopher','Lehr',NULL,'United Airlines','Aircraft Technician','2024-03-06T00:00:00+00'),
('https://www.linkedin.com/in/jeffrey-f-4b0908123','Jeffrey','Foster',NULL,'Hospice of Amador & Calaveras','Human Resources Manager','2024-02-21T00:00:00+00'),
('https://www.linkedin.com/in/gilberto-rivera-aa5501166','Gilberto','Rivera',NULL,'Jet Linx','Base Maintenance Manager','2024-02-13T00:00:00+00'),
('https://www.linkedin.com/in/kerry-mergler-56a47571','Kerry','Mergler',NULL,'US Air Force Reserve','Crew Chief/Plans and Scheduling','2024-02-10T00:00:00+00'),
('https://www.linkedin.com/in/gilbert-palos-2a2a36a1','Gilbert','Palos',NULL,'Northrop Grumman Corporation','Manager Aircraft Maintenance','2024-02-03T00:00:00+00'),
('https://www.linkedin.com/in/brian-woods-25632bb2','Brian','Woods',NULL,'Strategic Technology Institute Inc.','Aircraft Mech III','2024-01-30T00:00:00+00'),
('https://www.linkedin.com/in/al-guerra-77b01754','Al','Guerra',NULL,'Part 91 Private Equities Firm','Director of Maintenance','2024-01-26T00:00:00+00'),
('https://www.linkedin.com/in/jamesbellard','James','Bellard',NULL,'Zenetex','Avionics Technician','2024-01-26T00:00:00+00'),
('https://www.linkedin.com/in/joe-dinolfo-25bb4a5','Joe','Dinolfo',NULL,'Hawk Aircraft Services','Owner','2024-01-23T00:00:00+00'),
('https://www.linkedin.com/in/juan-alvarez-64510b182','Juan','Alvarez',NULL,'Empire Aviation USA','Teterboro Site Supervisor','2024-01-22T00:00:00+00'),
('https://www.linkedin.com/in/lauren-palmer-674926291','Lauren','Palmer',NULL,'UPS','Aircraft Maintenance Router Technician','2024-01-22T00:00:00+00'),
('https://www.linkedin.com/in/steve-trent-1ba0b1ba','Steve','Trent',NULL,'Sky Aircraft Maintenance','VP of MRO Technical Training / Accountable Manager @ Sky Aircraft Maintenance LLC','2024-01-19T00:00:00+00');
INSERT INTO _import_connections (url,first_name,last_name,email,company,position,connected_on) VALUES
('https://www.linkedin.com/in/jeffrey-linstra-aa701712','Jeffrey','Linstra',NULL,'AC Ocean Walk, LLC','Director of Aviation Maintenance','2024-01-18T00:00:00+00'),
('https://www.linkedin.com/in/kevin-laird-2b678520','Kevin','Laird',NULL,'Textron Aviation','Technical Services Manager','2024-01-18T00:00:00+00'),
('https://www.linkedin.com/in/sjms56','Steven','Sinski',NULL,'Freelance','Aircraft Mx Technical Specialist','2024-01-18T00:00:00+00'),
('https://www.linkedin.com/in/aaron-esparza','Aaron','Esparza',NULL,'DV Aviation','Director of Maintenance','2024-01-18T00:00:00+00'),
('https://www.linkedin.com/in/harry-hill-093ba445','Harry','Hill',NULL,'South Florida Aircraft Services, LLC','President','2024-01-18T00:00:00+00'),
('https://www.linkedin.com/in/alejandro-gomez-453452b6','Alejandro','Gomez',NULL,'Self Employed','Aviation Advisor','2024-01-17T00:00:00+00'),
('https://www.linkedin.com/in/dale-bomgardner-59ba6614','Dale','Bomgardner',NULL,'Southwest Airlines','Aircraft Maintenance Technician','2024-01-17T00:00:00+00'),
('https://www.linkedin.com/in/thomas-wittig-87762944','Thomas','Wittig',NULL,'Schubach Aviation','Director of Maintenance','2024-01-17T00:00:00+00'),
('https://www.linkedin.com/in/rohit-rameshar-14188287','Rohit','Rameshar',NULL,'JetBlue','Aircraft Maintenance QC Inspector','2024-01-16T00:00:00+00'),
('https://www.linkedin.com/in/will-rodrigues-b882191a2','Will','Rodrigues',NULL,'Jet East','Aircraft Maintenance Technician','2024-01-16T00:00:00+00'),
('https://www.linkedin.com/in/dan-muir-589b1a50','Dan','Muir',NULL,'MACH 1 AVIATION','MACH1 AOG Technician/ Owner, Elite Aircraft Services, LLC','2024-01-16T00:00:00+00'),
('https://www.linkedin.com/in/raul-jr-7534b21a7','Raul','Jr',NULL,'JetBlue Airways','Aircraft Maintenance Technician','2024-01-15T00:00:00+00'),
('https://www.linkedin.com/in/michael-dehm-6317b671','Michael','Dehm',NULL,'In Line Aviation','Aircraft Maintenance Supervisor','2024-01-15T00:00:00+00'),
('https://www.linkedin.com/in/joshua-vargas-a26a09251','Joshua','Vargas',NULL,'Madison Square Garden Entertainment Corp.','Senior Aircraft Crew Chief','2024-01-14T00:00:00+00'),
('https://www.linkedin.com/in/luciana-izidio-533baa26','Luciana','Izidio',NULL,'United Airlines','Aircraft Maintenance','2024-01-12T00:00:00+00'),
('https://www.linkedin.com/in/troy-l-mccullum-2235001b0','Troy L.','McCullum',NULL,'UPS','President of Aircraft Maintenance and Engineering','2024-01-12T00:00:00+00'),
('https://www.linkedin.com/in/shawn-cushman-bb605a97','Shawn','Cushman',NULL,'Solairus Aviation','Maintenance Supervisor','2024-01-12T00:00:00+00'),
('https://www.linkedin.com/in/hussein-osman-ab338445','Hussein','Osman',NULL,'Boeing','Field Service Representative','2024-01-12T00:00:00+00'),
('https://www.linkedin.com/in/denilson-almeida-80683435','Denilson','Almeida',NULL,'United Airlines','Lead Technician','2024-01-11T00:00:00+00'),
('https://www.linkedin.com/in/leroy-brooks-jr-38b3261b1','Leroy','Brooks jr',NULL,'Western Air','RII Inspector / Aircraft Maintenance Technician','2024-01-11T00:00:00+00'),
('https://www.linkedin.com/in/arthur-palacio-47ba8412b','Arthur','Palacio',NULL,'Apex Flight Support','Owner','2024-01-11T00:00:00+00'),
('https://www.linkedin.com/in/taylor-payton-5250b6ba','Taylor','Payton',NULL,'Sterling Helicopter','Aviation Technician','2024-01-11T00:00:00+00'),
('https://www.linkedin.com/in/adam-b-3a7a93247','Adam','Barron',NULL,'ACI Jet','Director Of Maintenance','2023-12-30T00:00:00+00'),
('https://www.linkedin.com/in/david-jensen-41578140','David','Jensen',NULL,'ACI Jet','Senior Vice President, Aircraft Maintenance','2023-12-29T00:00:00+00'),
('https://www.linkedin.com/in/tawni-kelley-643435185','Tawni','Kelley',NULL,'ACI Jet','Aircraft Maintenance Support Technician','2023-12-29T00:00:00+00'),
('https://www.linkedin.com/in/rodrigochochelgoncalves','Rodrigo','Goncalves',NULL,'RG Aviation Services LLC','Founder','2023-12-21T00:00:00+00'),
('https://www.linkedin.com/in/kerrie-fusco-860568209','Kerrie','Fusco',NULL,'Ric-Ker Enterprises, Inc.','People Operations Business Partner','2023-12-21T00:00:00+00'),
('https://www.linkedin.com/in/andrew-nelson-65b1a97','Andrew','Nelson',NULL,'Private','Aircraft Maintenance Technician','2023-12-21T00:00:00+00'),
('https://www.linkedin.com/in/kevin-mclaughlin-237b3431','Kevin','McLaughlin',NULL,'Draken International','Aircraft Maintenance Technician','2023-12-19T00:00:00+00'),
('https://www.linkedin.com/in/earl-glover-jr-89827939','Earl','Glover jr',NULL,'GAL Aerospace Corp','Aviation Instructor','2023-12-19T00:00:00+00'),
('https://www.linkedin.com/in/tinablackwelder','Tina','Blackwelder',NULL,'Safran','Sales Manager - General Aviation, Americas','2023-12-18T00:00:00+00'),
('https://www.linkedin.com/in/ben-kazanecki-0287b88a','Ben','Kazanecki',NULL,'Envoy Air Inc., formerly American Eagle Airlines','Aircraft Maintenance Base Manager','2023-12-15T00:00:00+00'),
('https://www.linkedin.com/in/darryl-stallworth-24520775','darryl','stallworth',NULL,'Lockheed Martin','Completion Supervisor','2023-12-08T00:00:00+00'),
('https://www.linkedin.com/in/jessica-parsons-5aab72135','Jessica','Parsons','consult4mfg@gmail.com','ShopKeeper Systems','Sales Associate','2023-12-08T00:00:00+00'),
('https://www.linkedin.com/in/dagmawi-asfaw-159433183','Dagmawi','Asfaw',NULL,'Xs Jet FAA CRS','AOG Aircraft Maintenance Technician','2023-12-07T00:00:00+00'),
('https://www.linkedin.com/in/david-cael-1554a914','David','Cael',NULL,'Alaska Airlines','Aircraft Maintenance Technician','2023-12-06T00:00:00+00'),
('https://www.linkedin.com/in/steve-betts-13128230','Steve','Betts',NULL,'Acadian Seaplanes','Director of Maintenance','2023-12-06T00:00:00+00'),
('https://www.linkedin.com/in/eric-vossler-5a72715a','Eric','Vossler',NULL,'United Airlines','Aircraft Maintenance Supervisor','2023-12-05T00:00:00+00'),
('https://www.linkedin.com/in/jonathan-blaker10','Jonathan','Blaker',NULL,'Old Glory Land Management','Business Owner','2023-12-03T00:00:00+00'),
('https://www.linkedin.com/in/yonar-candelario-67b885113','Yonar','Candelario','candelarioyonar@hotmail.com','United Airlines','Aircraft Maintenance Supervisor','2023-12-02T00:00:00+00'),
('https://www.linkedin.com/in/nickolas-cardwell-b0769029a','Nickolas','Cardwell',NULL,'VSP Vision Care','Sales Operations Supervisor','2023-12-01T00:00:00+00'),
('https://www.linkedin.com/in/mark-reyes-b199911b8','Mark','Reyes',NULL,'Empire Aviation USA','President','2023-12-01T00:00:00+00'),
('https://www.linkedin.com/in/mark-ward-8a793955','Mark','Ward',NULL,'United Airlines','Aircraft Maintenance Supervisor','2023-12-01T00:00:00+00'),
('https://www.linkedin.com/in/brandon-bickley-411a5217','Brandon','Bickley',NULL,'AeroTech Mapping, Inc.','Business Development Account Manager','2023-12-01T00:00:00+00'),
('https://www.linkedin.com/in/eric-willis-27a563141','Eric','Willis',NULL,'United Airlines','Aircraft Maintenance Manager','2023-12-01T00:00:00+00'),
('https://www.linkedin.com/in/frank-j-pedersen-jr-b503b42','Frank J.','Pedersen, Jr.',NULL,'3D Technology Services, Inc.','President & Chief Executive Officer','2023-11-30T00:00:00+00'),
('https://www.linkedin.com/in/bretdeeb','Bret','Deeb',NULL,'Flexjet','AOG Technician','2023-11-28T00:00:00+00'),
('https://www.linkedin.com/in/nikkolas-bott-henderson-30548367','Nikkolas','Bott-Henderson',NULL,'Empire Aviation USA','Lead Aircraft Mechanic','2023-11-28T00:00:00+00'),
('https://www.linkedin.com/in/fabian-g-2732a0119','Fabian','Gonzales',NULL,'Lockheed Martin','Senior Logistics Coordinator','2023-11-28T00:00:00+00'),
('https://www.linkedin.com/in/melaniehilson','Melanie','Hilson',NULL,'Mondelēz International','Senior Talent Acquisiton Advisor, Global MSC','2023-11-28T00:00:00+00'),
('https://www.linkedin.com/in/brandon-holley','Brandon','Holley',NULL,'C&W Services','Reliability Engineer','2023-11-28T00:00:00+00'),
('https://www.linkedin.com/in/terrance-walker-319770146','Terrance','Walker',NULL,'United States Air Force','U-2 Dragon Lady APG NCOIC','2023-11-28T00:00:00+00'),
('https://www.linkedin.com/in/cory-jarvis-7700605a','Cory','Jarvis',NULL,'Mission Technologies, a division of HII','Operations Training Manager','2023-11-28T00:00:00+00'),
('https://www.linkedin.com/in/ahsan-dale-b82798137','Ahsan','Dale',NULL,'Zenetex','Aircraft Mechanic','2023-11-28T00:00:00+00'),
('https://www.linkedin.com/in/calver-gallard-a57b7b191','Calver','Gallard',NULL,'UPS','Aircraft Maintenance Supervisor','2023-11-26T00:00:00+00'),
('https://www.linkedin.com/in/john-vanderbeck-872602176','John','Vanderbeck',NULL,'Norfolk Southern Corporation','Manager Aircraft Maintenance','2023-11-25T00:00:00+00'),
('https://www.linkedin.com/in/sean-hartsock-176686206','Sean','Hartsock',NULL,NULL,NULL,'2023-11-22T00:00:00+00'),
('https://www.linkedin.com/in/jay-alexander-a25341232','Jay','Alexander',NULL,NULL,'AFA Board Member / Speaker','2023-11-21T00:00:00+00'),
('https://www.linkedin.com/in/christian-torgerson-165073193','Christian','Torgerson',NULL,'Kaiser Permanente','Construction Estimator','2023-11-21T00:00:00+00'),
('https://www.linkedin.com/in/paul-ferry-83534ba6','Paul','Ferry',NULL,'Forcible Entry, Inc.','Sales Director','2023-11-21T00:00:00+00'),
('https://www.linkedin.com/in/josh-mcgee-ccm-846a31178','Josh','McGee, CCM',NULL,'UNICO Engineering, Inc.','Senior Construction Manager / Inspection Services Area Lead / Safety Officer','2023-11-21T00:00:00+00'),
('https://www.linkedin.com/in/jason-civitano-56840797','Jason','Civitano',NULL,'Nighthawk Aviation Services, LLC','Small Business Owner','2023-11-21T00:00:00+00'),
('https://www.linkedin.com/in/tmacadamcatalina','Terry','MacAdam',NULL,'Catalina Marketing Group','President','2023-11-20T00:00:00+00'),
('https://www.linkedin.com/in/david-clark-4a027a1b8','David','Clark',NULL,'Spoors Heating & Air Conditioning','Director of Commercial HVAC','2023-09-05T00:00:00+00'),
('https://www.linkedin.com/in/kelly-kottmeier-5a4083a7','Kelly','Kottmeier',NULL,'Coast Metal Cutting','President','2023-01-12T00:00:00+00');

INSERT INTO _import_invitations (inviter_url,invitee_url,direction,sent_at,message,from_name,to_name) VALUES
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/jeffrey-kimmey-jr-b4b73678','OUTGOING','2026-05-13T20:51:00+00','Hi Jeffrey I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Jeffrey Kimmey Jr.'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/randy-arnone-89535b9b','OUTGOING','2026-05-13T20:49:00+00','Hi Randy I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Randy Arnone'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/dan-r-744b1199','OUTGOING','2026-05-13T20:17:00+00','Hi Dan, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Dan R.'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/garen-harout-mazedjian-4454a871','OUTGOING','2026-05-09T20:33:00+00','Hi Garen, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Garen Harout Mazedjian'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/lindsay-parrott-2a923b37a','OUTGOING','2026-05-09T20:14:00+00','Hi Lindsay, I own Klein Manufacturing and we make phenolic scrapers used in aircraft maintenance. I''ve recently been connecting with a few other Real Clean franchise owners and sending out some samples for evaluation, so I wanted to introduce myself and connect with you as well.','Sean Klein','Lindsay Parrott'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/samuel-alfrey','OUTGOING','2026-05-09T20:14:00+00','Hi Sammy, I own Klein Manufacturing and we make phenolic scrapers used in aircraft maintenance. I''ve recently been connecting with a few other Real Clean franchise owners and sending out some samples for evaluation, so I wanted to introduce myself and connect with you as well.','Sean Klein','Sammy Alfrey'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/anne-marie-zwerg','OUTGOING','2026-05-09T20:14:00+00','Hi Anne, I own Klein Manufacturing and we make phenolic scrapers used in aircraft maintenance. I''ve recently been connecting with a few other Real Clean franchise owners and sending out some samples for evaluation, so I wanted to introduce myself and connect with you as well.','Sean Klein','Anne Marie Zwerg, PhD, MIM'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/chelsea-groves-7551a3a1','OUTGOING','2026-05-09T20:13:00+00','Hi Chelsea, I own Klein Manufacturing and we make phenolic scrapers used in aircraft maintenance. I''ve recently been connecting with a few other Real Clean franchise owners and sending out some samples for evaluation, so I wanted to introduce myself and connect with you as well.','Sean Klein','Chelsea Groves'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/duwane-smith-33706ba9','OUTGOING','2026-05-07T21:57:00+00','Hi Duwane I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Duwane Smith'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/aghr','OUTGOING','2026-04-30T14:44:00+00',NULL,'Sean Klein','Antonio Garcia, SHRM-CP'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/mchugh-brian','OUTGOING','2026-04-26T18:30:00+00',NULL,'Sean Klein','Brian McHugh'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/benjamin-hulshoff-713702269','OUTGOING','2026-04-26T17:25:00+00','Hi Benjamin, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers for sealant or adhesive removal during maintenance?','Sean Klein','Benjamin Hulshoff'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/andrew-kiehl-5b07136','OUTGOING','2026-04-26T17:24:00+00','Hi Andrew, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Andrew Kiehl'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/laura-scanlan-06192735','OUTGOING','2026-04-26T17:24:00+00','Hi Laura, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Laura Scanlan'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/alan-harman-7152981bb','OUTGOING','2026-04-26T17:24:00+00','Hi Alan, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Alan Harman'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/benjamin-renna-587a611b8','OUTGOING','2026-04-26T17:23:00+00','Hi Benjamin, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers for sealant or adhesive removal during maintenance?','Sean Klein','Benjamin Renna'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/darrienpeoples','OUTGOING','2026-04-26T17:22:00+00','Hi Darrien I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Darrien Peoples'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/jeff-schlickbernd-178bb390','OUTGOING','2026-04-26T17:21:00+00','Hi Jeff I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Jeff Schlickbernd'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/quinten-house-21585536','OUTGOING','2026-04-26T17:21:00+00','Hi Quinten, I''m local in Orangevale and saw you''re over in Mather. Thought I''d reach out and connect. I make phenolic scrapers for aircraft maintenance, curious if your crews use anything like that for sealant or adhesive removal.','Sean Klein','Quinten House'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/colby-q-280300188','OUTGOING','2026-04-26T17:18:00+00','Hi Colby I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Colby Q.'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/rick-lopez-61881330','OUTGOING','2026-04-26T17:17:00+00','Hi Rick I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Rick Lopez'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/tom-rotelli-4758361a','OUTGOING','2026-04-26T17:17:00+00','Hi Tom I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Tom Rotelli'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/robert-archer-95434061','OUTGOING','2026-04-26T17:17:00+00','Hi Robert I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Robert Archer'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/ray-filbeck-8742565a','OUTGOING','2026-04-26T17:16:00+00','Hi Ray I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Ray Filbeck'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/peter-sterling-a430b591','OUTGOING','2026-04-26T17:16:00+00','Hi Peter I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Peter Sterling'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/ricky-vongsiprasom','OUTGOING','2026-04-26T17:15:00+00',NULL,'Sean Klein','Ricky Vongsiprasom'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/jones-mitch','OUTGOING','2026-04-26T17:13:00+00','Hi Mitch, I saw you liked Tina''s post on the scrapers, I appreciate that. Your samples are on the way, looks like they''re still on schedule to be delivered this Wednesday 4/29. Looking forward to hearing what you think once you''ve had a chance to try them out.','Sean Klein','Mitch Jones'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/david-sepulveda-335a7850','OUTGOING','2026-04-26T17:10:00+00','Hi David, I saw you liked Tina''s post on the scrapers, I appreciate that. Let me know if you''d ever like to check out some samples, happy to send a set your way.','Sean Klein','David Sepulveda'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/skyleroxford','OUTGOING','2026-04-26T17:09:00+00','Hi Sky, I saw you liked Tina''s post on the scrapers, I appreciate that. Let me know if you''d ever like to check out some samples, happy to send a set your way.','Sean Klein','Skyler  Oxford'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/bronson-harris-10a29269','OUTGOING','2026-04-26T17:07:00+00','Hi Bronson, I saw you liked Tina''s post on the scrapers, I appreciate that. Let me know if you''d ever like to check out some samples, happy to send a set your way.','Sean Klein','Bronson Harris'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/robriccardo','OUTGOING','2026-04-26T17:04:00+00','Hi Robert, saw you liked Tina''s post on the phenolic scrapers, appreciate that. I''ll have your samples going out tomorrow, looking forward to hearing what you think once you''ve had a chance to try them out.','Sean Klein','Robert Riccardo'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/thomsondrew','OUTGOING','2026-03-30T16:57:00+00','Hi Drew, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Drew Thomson'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/christopher-botelho-271b13132','OUTGOING','2026-03-30T16:56:00+00','Hi Christopher, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Christopher Botelho'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/alexis-villalobos-a78307184','OUTGOING','2026-03-30T16:55:00+00','Hi Alexis I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Alexis Villalobos'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/timothy-cox-3717382a','OUTGOING','2026-03-30T16:54:00+00','Hi Timothy I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Timothy Cox'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/jbuff','OUTGOING','2026-03-30T16:53:00+00','Hi Jamie, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Jamie D. Buff'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/joseph-dimatteo','OUTGOING','2026-03-30T16:52:00+00','Hi Joseph I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Joseph DiMatteo'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/norman-adkins-44830289','OUTGOING','2026-03-30T16:50:00+00','Hi Norman I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Norman Adkins'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/antonio-tavera-b75870234','OUTGOING','2026-03-30T16:49:00+00','Hi Antonio I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','antonio tavera'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/josh-starr-570182283','OUTGOING','2026-03-27T17:14:00+00','Hi Josh, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Josh Starr'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/justin-beason-cam-249711177','OUTGOING','2026-03-27T17:12:00+00','Hi Justin I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Justin Beason, CAM'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/steinmetz-aircraft-maintenance','OUTGOING','2026-03-27T17:11:00+00','Hi Travis I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Travis Steinmetz'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/scott-apple-55850153','OUTGOING','2026-03-27T17:10:00+00','Hi Scott, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Scott Apple'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/jason-pealer-1a588155','OUTGOING','2026-03-27T17:08:00+00','Hi Jason, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Jason Pealer'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/marty-grier-cam-pmp-7b1a8413','OUTGOING','2026-03-27T17:07:00+00','Hi Marty, I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Marty Grier CAM/PMP'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/dale-cash-22b064222','OUTGOING','2026-03-27T17:05:00+00','Hi Dale, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Dale Cash'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/alex-finn-1848684a','OUTGOING','2026-03-23T11:55:00+00','Hi Alex.  I''ve been watching your youtube videos about OpenClaw and just wanted to reach out and connect on LinkedIn.  Thanks for putting out all the content you do!','Sean Klein','Alex Finn'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/geovanny-osorio-64ab63128','OUTGOING','2026-03-22T17:27:00+00','Hi Geovanny, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','geovanny osorio'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/nicole-gelineau-882122243','OUTGOING','2026-03-22T17:26:00+00','Hi Nicole, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Nicole Gelineau'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/jack-moore-a7708367','OUTGOING','2026-03-22T17:25:00+00','Hi Jack, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Jack Moore'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/barney-whaley-82868b9b','OUTGOING','2026-03-22T17:24:00+00','Hi Barney, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Barney Whaley'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/ricardo-martinez-jr-692274158','OUTGOING','2026-03-20T17:18:00+00','Hi Ricardo, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Ricardo Martinez Jr'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/greg-haroutounian-26b42267','OUTGOING','2026-03-20T17:17:00+00','Hi Greg, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Greg Haroutounian'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/orel-elbaz-564491213','OUTGOING','2026-03-20T17:16:00+00','Hi Orel, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Orel Elbaz'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/todd-cofer-22a4a5304','OUTGOING','2026-03-20T17:15:00+00','Hi Todd, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Todd Cofer'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/timothy-moises-a21077163','OUTGOING','2026-03-20T17:12:00+00','Hi Timothy, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Timothy Moises'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/aircraft-service-providers-llc-85667b32a','OUTGOING','2026-03-20T12:46:00+00','Hello, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, safe on aluminum and composite surfaces and built for real-world use.  Do your teams ever have a need for scrapers for adhesive or sealant removal?','Sean Klein','Aircraft  Service Providers LLC'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/brittney-weaser-bb945318','OUTGOING','2026-03-20T09:44:00+00','Hi Brittney, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Brittney Weaser'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/eric-ranges-9a4741164','OUTGOING','2026-03-20T09:43:00+00','Hi Eric, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Eric Ranges'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/christina-richason-5a8b9335','OUTGOING','2026-03-20T09:42:00+00','Hi Christina, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Christina Richason'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/joseph-kirby-mpm-a279335b','OUTGOING','2026-03-20T09:40:00+00','Hi Joseph, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Joseph Kirby MPM'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/k-orie-bratton-93862833','OUTGOING','2026-03-20T09:39:00+00','Hi K''Orie, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','K''Orie Bratton'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/vortex-aircraft-services-3a97b5244','OUTGOING','2026-03-20T09:34:00+00','Hello, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, safe on aluminum and composite surfaces and built for real-world use. Who would be the best person to connect with regarding MRO tools or consumables?','Sean Klein','Vortex Aircraft Services'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/sean-kammerer-9a9a5043','OUTGOING','2026-03-20T09:08:00+00','Hi Sean, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Sean Kammerer'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/laura-spolar-9534901b4','OUTGOING','2026-03-19T19:46:00+00','Hi Laura, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Laura  Spolar'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/thomas-sawicki-6b24861b4','OUTGOING','2026-03-19T19:30:00+00','Hi Thomas, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Thomas Sawicki'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/robert-schmitt-81a0a527','OUTGOING','2026-03-19T19:30:00+00','Hi Robert, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Robert Schmitt'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/douglas-brown-116584a0','OUTGOING','2026-03-19T19:29:00+00','Hi Douglas, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Douglas Brown'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/michael-p-baird-8280b753','OUTGOING','2026-03-19T19:28:00+00','Hi Michael, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','MICHAEL P. BAIRD'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/derek-mathews-0b558079','OUTGOING','2026-03-19T19:27:00+00','Hi Derek, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Derek Mathews'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/seth-martin-047021239','OUTGOING','2026-03-19T19:27:00+00','Hi Seth, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Seth Martin'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/bryan-boen-25012610','OUTGOING','2026-03-19T19:26:00+00','Hi Bryan, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Bryan Boen'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/robert-jacobs-77152539','OUTGOING','2026-03-19T19:26:00+00','Hi Robert, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Robert Jacobs'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/eric-moberg-a139ab203','OUTGOING','2026-03-19T19:26:00+00','Hi Eric, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Eric Moberg'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/darryl-lercel-80794b8','OUTGOING','2026-03-19T19:26:00+00',NULL,'Sean Klein','Darryl Lercel'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/jeremiah-kissick','OUTGOING','2026-03-19T19:23:00+00','Hi Jeremiah, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Jeremiah Kissick'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/michael-lineaweaver-186869243','OUTGOING','2026-03-19T19:23:00+00','Hi Michael, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Michael Lineaweaver'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/darryl-best-1ab34b184','OUTGOING','2026-03-19T19:22:00+00','Hi Darryl, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Darryl Best'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/david-orban-8b673560','OUTGOING','2026-03-19T19:21:00+00','Hi David, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','David Orban'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/kimberly-sanchez-aviation','OUTGOING','2026-03-19T19:21:00+00','Hi Kimberly, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Kimberly Kozlov');
INSERT INTO _import_invitations (inviter_url,invitee_url,direction,sent_at,message,from_name,to_name) VALUES
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/jim-lufrano-9432368','OUTGOING','2026-03-19T19:20:00+00','Hi Jim, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Jim Lufrano'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/sean-donovan-7789858b','OUTGOING','2026-03-19T19:20:00+00','Hi Sean, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Sean Donovan'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/scott-bjergo-96746695','OUTGOING','2026-03-19T19:18:00+00','Hi Scott, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Scott Bjergo'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/christopher-reverski-41074342','OUTGOING','2026-03-19T19:17:00+00','Hi Christopher. I wanted to introduce myself and Klein Manufacturing. We recently supplied phenolic scrapers to your team. I''d be glad to hear any feedback once they''ve had a chance to use them.','Sean Klein','Christopher Reverski'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/andy-boots-4718075b','OUTGOING','2026-03-19T19:06:00+00','Hi Andy, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Andy Boots'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/john-yan-3341937','OUTGOING','2026-03-19T19:05:00+00','Hi John, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','John Yan'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/joel-silverio-b731706','OUTGOING','2026-03-19T19:05:00+00','Hi Joel, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Joel Silverio'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/sam-katz-88a158286','OUTGOING','2026-03-19T19:05:00+00','Hi Sam, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Sam Katz'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/chris-lijesen-66782b79','OUTGOING','2026-03-19T19:05:00+00','Hi Chris, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Chris Lijesen'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/joey-feinstein-2177a46','OUTGOING','2026-03-19T19:04:00+00','Hi Joey, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Joey Feinstein'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/jeff-jackson-9b91373','OUTGOING','2026-03-19T19:04:00+00','Hi Jeff, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Jeff Jackson'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/john-mosher-099326268','OUTGOING','2026-03-19T19:02:00+00','Hi John, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','John Mosher'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/justin-retz','OUTGOING','2026-03-19T19:02:00+00','Hi Justin, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Justin Retz'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/jerel-buckley-66539512','OUTGOING','2026-03-19T17:47:00+00','Hi Jerel, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Jerel Buckley'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/justin-pynckels-mba-4a085b81','OUTGOING','2026-03-19T17:46:00+00','Hi Justin, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Justin Pynckels, MBA'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/ryan-russell-58694579','OUTGOING','2026-03-19T17:46:00+00','Hi Ryan, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Ryan Russell'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/joshua-dunn52','OUTGOING','2026-03-19T17:46:00+00','Hi Joshua, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Joshua Dunn'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/patrick-roberts-b3909aab','OUTGOING','2026-03-19T17:45:00+00','Hi Patrick, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Patrick Roberts'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/jim-demasi-a66148250','OUTGOING','2026-03-19T17:44:00+00','Hi Jim, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Jim DeMasi'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/mike-gallas-2a922b5','OUTGOING','2026-03-19T17:44:00+00','Hi Mike, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Mike Gallas'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/jesse-larkin-60001364','OUTGOING','2026-03-19T17:44:00+00','Hi Jesse, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Jesse Larkin'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/andrea-domeck-247a821a8','OUTGOING','2026-03-19T17:44:00+00','Hi Andrea, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Andrea Domeck'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/william-mittlestat-238506134','OUTGOING','2026-03-19T17:43:00+00','Hi William, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','William Mittlestat'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/michele-pelton-216b853b','OUTGOING','2026-03-19T17:43:00+00','Hi Michele, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Michele Pelton'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/peter-knight-2a89b763','OUTGOING','2026-03-19T17:32:00+00','Hi Peter, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Peter Knight'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/adam-backo-a001112a7','OUTGOING','2026-03-19T17:32:00+00','Hi Adam, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Adam Backo'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/heydrich-fronda-a309a892','OUTGOING','2026-03-19T17:31:00+00','Hi Heydrich, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Heydrich Fronda'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/shawn-petersen-6a241b129','OUTGOING','2026-03-19T17:31:00+00','Hi Shawn, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Shawn Petersen'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/samuel-ayala-257a20213','OUTGOING','2026-03-19T17:30:00+00','Hi Samuel, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Samuel Ayala'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/chance-duvail-b9a049105','OUTGOING','2026-03-19T17:30:00+00','Hi Chance, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Chance Duvail'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/timothy-smith-020266186','OUTGOING','2026-03-19T17:29:00+00','Hi Timothy, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Timothy Smith'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/chuckletizia','OUTGOING','2026-03-19T17:29:00+00','Hi Charles, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Charles  Letizia, MBA'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/steven-frasier-2217305','OUTGOING','2026-03-19T17:28:00+00','Hi Steven, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Steven Frasier'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/james-cerqua-3bb948101','OUTGOING','2026-03-19T17:28:00+00','Hi Anthony, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','James Cerqua'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/nicholas-amunategui-392414142','OUTGOING','2026-03-19T17:27:00+00','Hi Nicholas, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Nicholas Amunategui'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/ecgonzalez','OUTGOING','2026-03-19T17:26:00+00','Hi Elena, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Elena Gonzalez'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/patricia-valdes-33355a138','OUTGOING','2026-03-19T17:26:00+00','Hi Patricia, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Patricia Valdes'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/maria-de-jesus-0807bb37','OUTGOING','2026-03-19T17:25:00+00','Hi Maria, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','MARIA DE JESUS'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/danny-santiago-53b2b093','OUTGOING','2026-03-19T17:21:00+00','Hi Danny, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Danny Santiago'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/anthony-agosta-00307a53','OUTGOING','2026-03-19T17:20:00+00','Hi Anthony, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Anthony Agosta'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/cristian-mansilla-6b6a5890','OUTGOING','2026-03-19T17:19:00+00','Hi Cristian, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Cristian Mansilla'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/luis-tellez-3913505b','OUTGOING','2026-03-19T17:16:00+00','Hi Luis, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Luis Tellez'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/kyle-long-aviation','OUTGOING','2026-03-19T17:14:00+00','Hi Kyle, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Kyle Long'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/andrew-arcuri-60aa6721b','OUTGOING','2026-03-19T17:14:00+00','Hi Andrew, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Andrew Arcuri'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/brian-herbert-9b36908b','OUTGOING','2026-03-19T17:13:00+00','Hi Brian, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Brian Herbert'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/cody-morris-34984740','OUTGOING','2026-03-19T17:13:00+00','Hi Cody, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Cody Morris'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/samantha-richey-4860','OUTGOING','2026-03-19T17:12:00+00','Hi Samantha, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Samantha Richey'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/patrick-brody-mckenna-b034b920a','OUTGOING','2026-03-19T17:12:00+00','Hi Brody, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Patrick "Brody" Mckenna'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/joseph-bonita-018a7a23','OUTGOING','2026-03-19T17:11:00+00','Hi Joseph, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Joseph Bonita'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/dawit-palmer-6b4b3829','OUTGOING','2026-03-19T17:10:00+00','Hi Dawit, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Dawit Palmer'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/mike-horan-46704a337','OUTGOING','2026-03-19T17:09:00+00','Hi Mike, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Mike Horan'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/brian-sprecher-43321979','OUTGOING','2026-03-19T17:09:00+00','Hi Brian, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Brian Sprecher'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/tyler-mcdowell-4a2aab325','OUTGOING','2026-05-13T20:15:00+00','Hi Tyler I''d like to introduce myself and my company Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re used by MRO teams across the industry. Quick question: do your crews use scrapers at all for sealant or adhesive removal during maintenance?','Sean Klein','Tyler McDowell'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/joe-disipio-9a568bb3','OUTGOING','2026-03-19T15:23:00+00','Hi Joe, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Joe DiSipio'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/david-phillips-02b59a22','OUTGOING','2026-03-19T15:22:00+00','Hi David, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','David Phillips'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/andrew-schumpp-85a96bb','OUTGOING','2026-03-19T15:18:00+00','Hi Andrew, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Andrew Schumpp'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/paul-diaz-a03a30187','OUTGOING','2026-03-19T15:18:00+00','Hi Paul, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Paul Diaz'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/nichalos-silva-a5232826a','OUTGOING','2026-03-19T15:17:00+00','Hi Nichalos, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Nichalos Silva'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/chris-kiefer-4ba5721a7','OUTGOING','2026-03-19T15:17:00+00','Hi Chris, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Chris Kiefer'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/michael-w-johnson-56bb93381','OUTGOING','2026-03-19T15:16:00+00','Hi Michael, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Michael W. Johnson'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/jonah-richie-50a878377','OUTGOING','2026-03-19T15:15:00+00','Hi Jonah, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Jonah Richie'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/stephanus-ackermann-36831a225','OUTGOING','2026-03-19T15:15:00+00','Hi Stephanus, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Stephanus Ackermann'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/alex-preidt-2906a8180','OUTGOING','2026-03-19T15:11:00+00','Hi Alex, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Alex Preidt'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/joseph-pisciotta-555436b1','OUTGOING','2026-03-19T15:10:00+00','Hi Joseph, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables?','Sean Klein','Joseph Pisciotta'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/andy-kozak-3b89689','OUTGOING','2026-01-29T11:50:00+00','Hi Andy, I''d like to introduce myself and my company, Klein Manufacturing. We handcraft phenolic scrapers for aircraft maintenance here in the USA, and they''re trusted by MRO teams at major airlines across the industry. Are you involved in sourcing MRO tools or consumables? Would love to connect.','Sean Klein','Andy Kozak'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/tyler-vanderhoef-b61764230','OUTGOING','2026-01-29T10:44:00+00',NULL,'Sean Klein','Tyler Vanderhoef'),
('https://www.linkedin.com/in/sean-klein-5a0b88197','https://www.linkedin.com/in/daniel-l-88847569','OUTGOING','2025-06-24T11:03:00+00','Hi Daniel, I''d like to introduce myself and my company, Klein Manufacturing. We produce USA-made phenolic scrapers commonly used in aircraft maintenance. Are you involved in sourcing MRO tools for your team?','Sean Klein','Daniel L.'),
('https://www.linkedin.com/in/brett-bailey-','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-05-13T15:32:00+00',NULL,'Brett Bailey','Sean Klein'),
('https://www.linkedin.com/in/don-meyns-b05435375','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-05-09T07:00:00+00',NULL,'Don Meyns','Sean Klein'),
('https://www.linkedin.com/in/kurtwiegers','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-05-04T07:47:00+00',NULL,'Kurt Wiegers','Sean Klein'),
('https://www.linkedin.com/in/joseph-schwartz-09a0a7178','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-05-03T20:48:00+00',NULL,'Joseph Schwartz','Sean Klein'),
('https://www.linkedin.com/in/ray-shahifar-7b06212a5','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-05-01T21:19:00+00',NULL,'Ray  Shahifar','Sean Klein'),
('https://www.linkedin.com/in/christopher-wilkes-cam-b33819131','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-04-28T19:42:00+00',NULL,'Christopher Wilkes, CAM','Sean Klein'),
('https://www.linkedin.com/in/joe-nemat-2673b0112','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-04-25T09:30:00+00',NULL,'Joe Nemat','Sean Klein'),
('https://www.linkedin.com/in/tina-ho-0044383b8','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-04-25T06:28:00+00',NULL,'Tina Ho','Sean Klein'),
('https://www.linkedin.com/in/mark-w-melby-54464910','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-04-24T04:35:00+00',NULL,'Mark W. Melby','Sean Klein'),
('https://www.linkedin.com/in/preston-griffin-ok','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-04-19T09:56:00+00',NULL,'Preston Griffin','Sean Klein'),
('https://www.linkedin.com/in/uriah-savary-831b393b9','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-04-15T20:37:00+00',NULL,'Uriah Savary','Sean Klein'),
('https://www.linkedin.com/in/jddulebohn','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-03-30T08:50:00+00','Hey there, you came across my feed and just so happens I''ve been looking for new scraper tools/solutions. Researched your products and now going to get some to test out. Look forward to connecting and following your work. Cheers. -JD','James Dulebohn','Sean Klein'),
('https://www.linkedin.com/in/tetiana-lisina-1b451a144','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-03-10T14:02:00+00',NULL,'Tetiana Lisina','Sean Klein');
INSERT INTO _import_invitations (inviter_url,invitee_url,direction,sent_at,message,from_name,to_name) VALUES
('https://www.linkedin.com/in/terry-johnston-65964038a','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2026-03-10T10:14:00+00',NULL,'Terry Johnston','Sean Klein'),
('https://www.linkedin.com/in/500feetaheadllc','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2025-12-13T08:40:00+00',NULL,'Ethan  F.','Sean Klein'),
('https://www.linkedin.com/in/tenille-thomas-08467b357','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2025-10-29T15:01:00+00',NULL,'Tenille Thomas','Sean Klein'),
('https://www.linkedin.com/in/svenspringwald','https://www.linkedin.com/in/sean-klein-5a0b88197','INCOMING','2025-10-10T07:56:00+00',NULL,'Sven  Springwald','Sean Klein');


-- ============================================================
-- 3. URL normalization (case-insensitive host, no trailing slash)
-- ============================================================
CREATE OR REPLACE FUNCTION pg_temp.norm_li_url(u text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN u IS NULL OR u = '' THEN NULL ELSE
    regexp_replace(
      regexp_replace(
        regexp_replace(u, '\?.*$', ''),
        '/+$', ''
      ),
      '^https?://(www\.)?linkedin\.com', 'https://www.linkedin.com'
    )
  END;
$$;

-- ============================================================
-- 4. Find-or-create companies (from connections)
--    Distinct company name → existing companies.id or new row
-- ============================================================
WITH new_co AS (
  SELECT DISTINCT TRIM(c.company) AS name
  FROM _import_connections c
  WHERE c.company IS NOT NULL AND TRIM(c.company) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM companies co
      WHERE lower(co.name) = lower(TRIM(c.company))
    )
)
INSERT INTO companies (name) SELECT name FROM new_co;

-- ============================================================
-- 5. Create new leads (+contacts) for threads whose URL is not
--    already a lead.
-- ============================================================
WITH thread_target AS (
  -- one row per thread that needs a new lead (has URL, no existing match)
  SELECT t.conversation_id, t.other_url, t.other_name, t.first_date,
         pg_temp.norm_li_url(t.other_url) AS norm_url,
         -- pull conn record for this URL if present
         c.first_name AS c_first, c.last_name AS c_last,
         c.email AS c_email, c.company AS c_company, c.position AS c_position,
         c.connected_on AS c_connected
  FROM _import_threads t
  LEFT JOIN _import_connections c
    ON pg_temp.norm_li_url(c.url) = pg_temp.norm_li_url(t.other_url)
  WHERE t.other_url IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM leads l
      WHERE pg_temp.norm_li_url(l.linkedin_url) = pg_temp.norm_li_url(t.other_url)
    )
),
parsed_names AS (
  SELECT *,
    COALESCE(NULLIF(c_first, ''),
             split_part(COALESCE(other_name, 'Unknown'), ' ', 1),
             'Unknown') AS first_name,
    COALESCE(NULLIF(c_last, ''),
             NULLIF(regexp_replace(COALESCE(other_name, ''), '^[^ ]+\s*', ''), ''),
             '') AS last_name
  FROM thread_target
),
new_contact AS (
  INSERT INTO contacts (first_name, last_name, title, email, linkedin_url, company_id)
  SELECT p.first_name, p.last_name, p.c_position, p.c_email, p.other_url,
         co.id
  FROM parsed_names p
  LEFT JOIN companies co ON co.name IS NOT NULL
                        AND lower(co.name) = lower(TRIM(COALESCE(p.c_company, '')))
                        AND TRIM(COALESCE(p.c_company, '')) <> ''
  RETURNING id AS contact_id, linkedin_url, company_id
),
new_lead AS (
  INSERT INTO leads (contact_id, company_id, status, source, linkedin_url,
                     linkedin_thread_id, connection_accepted_at)
  SELECT nc.contact_id, nc.company_id, 'new', 'linkedin_export',
         nc.linkedin_url, p.conversation_id, p.c_connected
  FROM new_contact nc
  JOIN parsed_names p ON p.other_url = nc.linkedin_url
  RETURNING id, linkedin_url
)
SELECT count(*) AS new_leads_created FROM new_lead;

-- ============================================================
-- 6. Insert activities (one per message)
--    Skip dupes via the partial unique index on linkedin_message_urn.
--    Use a canonical-lead CTE so duplicate-URL leads in the
--    legacy data (216 unique URLs across 244 leads = 28 dupe
--    pairs) don't multiply the INSERT and break the unique index.
--    Canonical = lowest leads.id for that normalized URL.
-- ============================================================
WITH canon_leads AS (
  SELECT DISTINCT ON (pg_temp.norm_li_url(linkedin_url))
         id AS lead_id,
         pg_temp.norm_li_url(linkedin_url) AS norm_url
  FROM leads
  WHERE linkedin_url IS NOT NULL
  ORDER BY pg_temp.norm_li_url(linkedin_url), id
)
INSERT INTO activities (created_at, lead_id, type, direction, source, body, summary, linkedin_message_urn)
SELECT
  m.date_iso,
  cl.lead_id,
  'linkedin_message' AS type,
  m.direction,
  'linkedin_export' AS source,
  m.body,
  LEFT(COALESCE(m.body, ''), 120) AS summary,
  m.urn AS linkedin_message_urn
FROM _import_messages m
JOIN canon_leads cl ON cl.norm_url = pg_temp.norm_li_url(m.other_url)
WHERE m.other_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM activities a WHERE a.linkedin_message_urn = m.urn
  );

-- ============================================================
-- 7. Backfill on existing leads
-- ============================================================
-- linkedin_thread_id (from staged threads)
UPDATE leads l
SET linkedin_thread_id = t.conversation_id
FROM _import_threads t
WHERE l.linkedin_thread_id IS NULL
  AND t.other_url IS NOT NULL
  AND pg_temp.norm_li_url(l.linkedin_url) = pg_temp.norm_li_url(t.other_url);

-- connection_accepted_at (from Connections.csv)
UPDATE leads l
SET connection_accepted_at = c.connected_on
FROM _import_connections c
WHERE l.connection_accepted_at IS NULL
  AND c.connected_on IS NOT NULL
  AND pg_temp.norm_li_url(l.linkedin_url) = pg_temp.norm_li_url(c.url);

-- invited_at (from OUTGOING invitations)
UPDATE leads l
SET invited_at = i.sent_at
FROM _import_invitations i
WHERE l.invited_at IS NULL
  AND i.direction = 'OUTGOING'
  AND i.sent_at IS NOT NULL
  AND pg_temp.norm_li_url(l.linkedin_url) = pg_temp.norm_li_url(i.invitee_url);

-- last_activity_at (so cadence engine sees the new activity)
UPDATE leads l
SET last_activity_at = a.last_at
FROM (
  SELECT lead_id, MAX(created_at) AS last_at
  FROM activities
  WHERE source = 'linkedin_export'
  GROUP BY lead_id
) a
WHERE a.lead_id = l.id
  AND (l.last_activity_at IS NULL OR a.last_at > l.last_activity_at);

-- ============================================================
-- 8. Cleanup
-- ============================================================
DROP TABLE _import_messages;
DROP TABLE _import_threads;
DROP TABLE _import_connections;
DROP TABLE _import_invitations;

COMMIT;

