# Klein Manufacturing — Deploy Checklist

## 1. Environment Variables (Vercel Dashboard)

Go to **Vercel → Project → Settings → Environment Variables** and add:

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://your-project.supabase.co` | From Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | From Supabase → Settings → API (anon/public key) |
| `RESEND_API_KEY` | `re_...` | Optional — from resend.com. If not set, form still works but no email notification is sent |

After adding variables, **redeploy** the project (Vercel → Deployments → Redeploy).

---

## 2. Custom Domain — KleinMFGLLC.com

### In Vercel:
1. Go to **Project → Settings → Domains**
2. Add `kleinmfgllc.com`
3. Also add `www.kleinmfgllc.com` (Vercel will auto-redirect)
4. Vercel will show the DNS records you need to set

### In Your Domain Registrar (GoDaddy, Namecheap, etc.):
1. **A Record**: `@` → `76.76.21.21` (Vercel's IP)
2. **CNAME Record**: `www` → `cname.vercel-dns.com`
3. Wait for DNS propagation (usually 5–30 minutes, can take up to 48 hours)
4. Vercel will automatically provision an SSL certificate once DNS is verified

---

## 3. Supabase Setup

1. Go to **supabase.com → Your Project → SQL Editor**
2. Open `supabase/migrations/001_initial_schema.sql` in Notepad
3. Copy all contents and paste into the SQL Editor
4. Click **Run** — this creates all tables, RLS policies, and indexes
5. Verify: go to **Table Editor** and confirm `sample_requests` table exists

---

## 4. Test the Form

1. Visit `https://kleinmfgllc.com/request-samples`
2. Fill out the form with test data and submit
3. Check **Supabase → Table Editor → sample_requests** for the new row
4. If Resend is configured, check `kleinmanufacturing@gmail.com` for the notification email
5. Test the `?product=6inch` and `?product=11inch` URL params pre-fill correctly

---

## 5. Final Pre-Launch Checks

- [ ] All pages load: Home, Products, About, Request Samples
- [ ] Navigation links work on desktop and mobile
- [ ] Mobile hamburger menu opens and closes correctly
- [ ] Product images display correctly on Products page
- [ ] Hero images display on Home page (desktop)
- [ ] Meta tags are correct (check with [metatags.io](https://metatags.io))
- [ ] Form submits successfully and shows confirmation
- [ ] Footer email shows `sales@kleinmfgllc.com`
- [ ] SSL certificate is active (green padlock in browser)
- [ ] Test on mobile device (iPhone / Android)
- [ ] Test on multiple browsers (Chrome, Safari, Firefox)
- [ ] Google Search Console: submit sitemap (if applicable)
