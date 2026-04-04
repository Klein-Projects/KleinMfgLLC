-- ============================================================
-- Klein Manufacturing LLC — Initial Database Schema
-- Public website + Private sales portal
-- ============================================================

-- =========================
-- TABLE: sample_requests
-- Website form submissions for free sponge samples
-- =========================
CREATE TABLE sample_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz DEFAULT now(),
  name             text NOT NULL,
  company          text,
  job_title        text,
  email            text NOT NULL,
  phone            text,
  quantity_6inch   integer DEFAULT 0,
  quantity_11inch  integer DEFAULT 0,
  shipping_address text,
  notes            text,
  status           text DEFAULT 'new'
    CHECK (status IN ('new', 'reviewed', 'fulfilled')),
  converted_to_lead boolean DEFAULT false
);

-- =========================
-- TABLE: companies
-- Organizations tracked in the sales portal
-- =========================
CREATE TABLE companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz DEFAULT now(),
  name        text NOT NULL,
  industry    text,  -- 'airline','MRO','defense','cargo','other'
  website     text,
  notes       text
);

-- =========================
-- TABLE: contacts
-- People at companies
-- =========================
CREATE TABLE contacts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            timestamptz DEFAULT now(),
  company_id            uuid REFERENCES companies(id) ON DELETE SET NULL,
  first_name            text NOT NULL,
  last_name             text NOT NULL,
  title                 text,
  email                 text,
  phone                 text,
  linkedin_url          text,
  linkedin_profile_text text,  -- raw pasted LinkedIn profile for AI parsing
  notes                 text
);

-- =========================
-- TABLE: leads
-- Sales pipeline tracking
-- =========================
CREATE TABLE leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz DEFAULT now(),
  contact_id        uuid REFERENCES contacts(id) ON DELETE SET NULL,
  company_id        uuid REFERENCES companies(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'new'
    CHECK (status IN (
      'new', 'contacted', 'engaged', 'sample_sent',
      'quoted', 'won', 'lost', 'nurture'
    )),
  source            text DEFAULT 'linkedin'
    CHECK (source IN ('linkedin', 'website', 'referral', 'other')),
  sample_request_id uuid REFERENCES sample_requests(id) ON DELETE SET NULL,
  follow_up_date    date,
  value_estimate    numeric,
  notes             text,
  last_activity_at  timestamptz DEFAULT now()
);

-- =========================
-- TABLE: activities
-- Interaction log per lead
-- =========================
CREATE TABLE activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz DEFAULT now(),
  lead_id     uuid REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  type        text NOT NULL
    CHECK (type IN (
      'linkedin_message', 'email', 'phone', 'note',
      'sample_sent', 'follow_up'
    )),
  summary     text NOT NULL,
  prompt_used text,  -- which template message was used
  outcome     text
);

-- =========================
-- TABLE: prompt_templates
-- Reusable outreach message templates
-- =========================
CREATE TABLE prompt_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz DEFAULT now(),
  category    text NOT NULL
    CHECK (category IN (
      'first_contact', 'follow_up', 'no_reply',
      'sample_followup', 'won', 'nurture'
    )),
  title       text NOT NULL,
  body        text NOT NULL,
  tags        text[],
  use_count   integer DEFAULT 0
);

-- =========================
-- TABLE: shipments
-- Sample shipment tracking
-- =========================
CREATE TABLE shipments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz DEFAULT now(),
  lead_id           uuid REFERENCES leads(id) ON DELETE SET NULL,
  tracking_number   text NOT NULL,
  carrier           text NOT NULL
    CHECK (carrier IN ('usps', 'ups', 'fedex')),
  status            text DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'in_transit', 'out_for_delivery',
      'delivered', 'exception'
    )),
  shipped_at        timestamptz,
  delivered_at      timestamptz,
  follow_up_created boolean DEFAULT false,
  recipient_name    text,
  notes             text
);


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE sample_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments        ENABLE ROW LEVEL SECURITY;

-- Authenticated users can do everything (single-user portal)
CREATE POLICY "Authenticated full access" ON sample_requests
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated full access" ON companies
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated full access" ON contacts
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated full access" ON leads
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated full access" ON activities
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated full access" ON prompt_templates
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated full access" ON shipments
  FOR ALL USING (auth.uid() IS NOT NULL);


-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_leads_status        ON leads(status);
CREATE INDEX idx_leads_follow_up     ON leads(follow_up_date);
CREATE INDEX idx_activities_lead     ON activities(lead_id);
CREATE INDEX idx_shipments_status    ON shipments(status);
