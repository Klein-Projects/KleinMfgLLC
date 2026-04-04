// Klein Manufacturing LLC — Database Types
// These interfaces match supabase/migrations/001_initial_schema.sql

export interface SampleRequest {
  id: string;
  created_at: string;
  name: string;
  company: string | null;
  job_title: string | null;
  email: string;
  phone: string | null;
  quantity_6inch: number;
  quantity_11inch: number;
  shipping_address: string | null;
  notes: string | null;
  status: 'new' | 'reviewed' | 'fulfilled';
  converted_to_lead: boolean;
}

export interface Company {
  id: string;
  created_at: string;
  name: string;
  industry: 'airline' | 'MRO' | 'defense' | 'cargo' | 'other' | null;
  website: string | null;
  notes: string | null;
}

export interface Contact {
  id: string;
  created_at: string;
  company_id: string | null;
  first_name: string;
  last_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  linkedin_profile_text: string | null;
  notes: string | null;
}

export interface Lead {
  id: string;
  created_at: string;
  contact_id: string | null;
  company_id: string | null;
  status:
    | 'new'
    | 'contacted'
    | 'engaged'
    | 'sample_sent'
    | 'quoted'
    | 'won'
    | 'lost'
    | 'nurture';
  source: 'linkedin' | 'website' | 'referral' | 'other';
  sample_request_id: string | null;
  follow_up_date: string | null;
  value_estimate: number | null;
  notes: string | null;
  last_activity_at: string;
}

export interface Activity {
  id: string;
  created_at: string;
  lead_id: string;
  type:
    | 'linkedin_message'
    | 'email'
    | 'phone'
    | 'note'
    | 'sample_sent'
    | 'follow_up';
  summary: string;
  prompt_used: string | null;
  outcome: string | null;
}

export interface PromptTemplate {
  id: string;
  created_at: string;
  category:
    | 'first_contact'
    | 'follow_up'
    | 'no_reply'
    | 'sample_followup'
    | 'won'
    | 'nurture';
  title: string;
  body: string;
  tags: string[] | null;
  use_count: number;
}

export interface Shipment {
  id: string;
  created_at: string;
  lead_id: string | null;
  tracking_number: string;
  carrier: 'usps' | 'ups' | 'fedex';
  status:
    | 'pending'
    | 'in_transit'
    | 'out_for_delivery'
    | 'delivered'
    | 'exception';
  shipped_at: string | null;
  delivered_at: string | null;
  follow_up_created: boolean;
  recipient_name: string | null;
  notes: string | null;
}

// Insert types (omit server-generated fields)
export type SampleRequestInsert = Omit<SampleRequest, 'id' | 'created_at'> &
  Partial<Pick<SampleRequest, 'id' | 'created_at'>>;

export type CompanyInsert = Omit<Company, 'id' | 'created_at'> &
  Partial<Pick<Company, 'id' | 'created_at'>>;

export type ContactInsert = Omit<Contact, 'id' | 'created_at'> &
  Partial<Pick<Contact, 'id' | 'created_at'>>;

export type LeadInsert = Omit<Lead, 'id' | 'created_at'> &
  Partial<Pick<Lead, 'id' | 'created_at'>>;

export type ActivityInsert = Omit<Activity, 'id' | 'created_at'> &
  Partial<Pick<Activity, 'id' | 'created_at'>>;

export type PromptTemplateInsert = Omit<PromptTemplate, 'id' | 'created_at'> &
  Partial<Pick<PromptTemplate, 'id' | 'created_at'>>;

export type ShipmentInsert = Omit<Shipment, 'id' | 'created_at'> &
  Partial<Pick<Shipment, 'id' | 'created_at'>>;
