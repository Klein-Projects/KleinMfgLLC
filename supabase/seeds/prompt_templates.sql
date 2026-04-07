-- Klein Manufacturing LLC — Starter Prompt Templates
-- 10 realistic aviation sales templates for Sean's LinkedIn outreach pipeline

INSERT INTO prompt_templates (category, title, body, tags, use_count) VALUES

-- ─── FIRST CONTACT (2) ───

('first_contact', 'LinkedIn — Cold Connect (Airline Maintenance Lead)',
'Hi [Name],

I came across your profile and saw you''re involved in maintenance operations at [Company]. I run Klein Manufacturing — we make aircraft carpet scrapers by hand here in the U.S. that a lot of maintenance shops have been switching to.

They hold up significantly longer than the standard-issue ones and the guys on the floor seem to actually prefer using them. Would be happy to send over a couple samples if you''d like to try them out — no commitment, just want to get your honest take.

Either way, glad to connect.

Sean Klein
Klein Manufacturing, LLC',
ARRAY['airline', 'cold-outreach', 'linkedin', 'first-touch'], 0),

('first_contact', 'LinkedIn — Cold Connect (MRO / Defense)',
'Hi [Name],

I noticed you''re working on the MRO side at [Company] — always good to connect with people in the industry. I own Klein Manufacturing and we build heavy-duty aircraft carpet scrapers here in our shop.

A few MRO facilities have started using them because they last quite a bit longer than what''s typically available. If that''s something your team deals with, I''d be glad to send a couple your way to test out.

No pressure at all — just trying to get these in front of the right people.

Sean',
ARRAY['MRO', 'defense', 'cold-outreach', 'linkedin', 'first-touch'], 0),

-- ─── FOLLOW-UP (2) ───

('follow_up', 'Follow-Up — 1 Week After Connect (General)',
'Hi [Name],

Just wanted to circle back — I sent a note last week about our aircraft carpet scrapers. I know things get busy, so no worries if it slipped through.

Quick version: we make them by hand in the U.S., they last significantly longer than what most shops are using, and I''m happy to send samples so your team can test them firsthand.

If that sounds useful, just let me know the best shipping address and I''ll get a set out to you.

Sean',
ARRAY['follow-up', '1-week', 'general'], 0),

('follow_up', 'Follow-Up — After Initial Interest',
'Hi [Name],

Great connecting with you. Wanted to follow up on our conversation about the scrapers — sounds like your team goes through them pretty regularly.

I can put together a small sample pack (both our 6" and 11" models) so you can see the difference in person. Just need a shipping address and I''ll get them out this week.

Let me know if that works.

Sean',
ARRAY['follow-up', 'warm-lead', 'samples'], 0),

-- ─── NO REPLY (2) ───

('no_reply', 'Gentle Nudge — 2nd Follow-Up',
'Hi [Name],

I know LinkedIn messages can get buried so I wanted to try one more time. I''d mentioned sending over a couple of our aircraft carpet scrapers for your team to try out — still happy to do that if there''s any interest.

If the timing''s off or it''s just not a fit, totally understand. Either way, I appreciate you connecting.

Sean',
ARRAY['no-reply', '2nd-follow-up', 'gentle'], 0),

('no_reply', 'Final Check-In — No Reply',
'Hi [Name],

Last note from me on this — I don''t want to be that guy filling up your inbox. Just wanted to leave the door open in case your team ever needs a better scraper option.

We make ours by hand here in the U.S. and they hold up a lot longer than the typical ones. If the need ever comes up, feel free to reach out anytime.

Wishing you and the team well.

Sean',
ARRAY['no-reply', 'final', 'soft-close'], 0),

-- ─── SAMPLE FOLLOW-UP (2) ───

('sample_followup', 'Check-In — Did Samples Arrive?',
'Hi [Name],

Just checking in — the scraper samples I sent should have arrived by now. Wanted to make sure they got there in one piece.

Once your guys have had a chance to put them to work, I''d love to hear what they think. No rush — just curious if they hold up the way I think they will on your floor.

Thanks,
Sean',
ARRAY['sample-followup', 'delivery-check', 'feedback'], 0),

('sample_followup', 'Follow-Up — After Samples Were Received',
'Hi [Name],

Hope things are going well. Wanted to touch base on the scrapers — have your guys had a chance to use them yet?

Most of the feedback I get is that they notice the difference pretty quickly compared to what they were using before. If your team feels the same way and you want to talk about getting more, I can put together some quantity options for you.

No rush at all — just wanted to check in.

Sean',
ARRAY['sample-followup', 'post-trial', 'reorder'], 0),

-- ─── WON (1) ───

('won', 'Thank You — New Customer + Referral Ask',
'Hi [Name],

Really appreciate you going with Klein Manufacturing on this order. I''ll make sure everything ships out promptly and is exactly what your team needs.

One quick ask — if you know anyone else in the industry who deals with the same scraper headaches, I''d appreciate the introduction. Word of mouth has been huge for us and I''d rather get in front of the right people through a trusted connection than cold outreach.

Thanks again, and don''t hesitate to reach out if you ever need anything.

Sean',
ARRAY['won', 'thank-you', 'referral'], 0),

-- ─── NURTURE (1) ───

('nurture', 'Quarterly Check-In — Staying in Touch',
'Hi [Name],

Just a quick check-in — hope things are going well at [Company]. Wanted to see how the scrapers have been holding up on your end.

We''ve been making some small improvements in the shop based on feedback from a few teams, so the newer batches are even more durable. If you''re getting low or want to try the updated version, let me know and I''ll set something up.

Always good to stay in touch. Hope business is treating you well.

Sean',
ARRAY['nurture', 'quarterly', 'reorder', 'check-in'], 0);
