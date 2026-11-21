# EHA — Website + Admin Panel + Leads CRM + Zoho CRM

## Run it
```bash
npm install
cp .env.example .env      # set BASE_URL and ADMIN_PASSWORD
npm start                 # → http://localhost:3000
```
Admin: `/admin` (default `admin@eha.com.au` / `ChangeMe!2026` if ADMIN_PASSWORD is not set — you'll be forced to change it).

## Website (11 pages)
Home · Solutions · Home Designs (filterable) · Why EHA · How It Works · Mission · FAQ (tabbed) · Contact · 5-step Assessment · Privacy · 404
Animations: page-transition curtain, hero text/image reveals, scroll reveals, parallax, tilt cards, magnetic buttons, counters, carousel, marquee, scroll-drawn timeline, repayment calculator.
Lead forms: assessment wizard, contact, callback modal (every page), newsletter (footer). All validated server-side, honeypot + timing + rate-limited. UTM tags are captured.

## Admin panel
- Dashboard: KPIs, 30-day chart, pipeline, source/state breakdown
- Leads: search, filters, sort, paging, bulk status/sync/delete, CSV export
- Lead drawer: pipeline stages, follow-up date, notes, activity log, call/email, Zoho push
- Auto lead scoring (timeframe, deposit, source)
- Team members, password change, 12h sessions, login rate limiting, CSRF header check

## Zoho CRM
1. api-console.zoho.com(.au) → Server-based Application
2. Redirect URI: `BASE_URL/admin/zoho/callback` (shown in the admin)
3. Paste Client ID/Secret in **Admin → Zoho CRM**, Save, click **Connect with Zoho**
4. Test, then turn on auto-sync. Leads are upserted into Zoho **Leads** by email (no duplicates).

## Deploying
Any Node 18+ host (VPS, Render, Railway, cPanel Node app). Use HTTPS, set `BASE_URL=https://yourdomain`, `TRUST_PROXY=1` behind a proxy, and back up the `data/` folder (leads live in `data/db.json`).
