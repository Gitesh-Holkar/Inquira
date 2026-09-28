# TradeIndia inquiry API — what we know

TradeIndia's "My Inquiry API" docs sit behind the seller login (My Profile → Inquiries and Contacts → **My Inquiry API**). This summary combines what could be verified from the build environment on 29 Sep 2026 with the widely used public format. **Confirm the ⚠️ items against the page in your TradeIndia account.**

## Endpoint (verified)
```
GET https://www.tradeindia.com/utils/my_inquiry.html
    ?userid=<User ID>&profile_id=<Profile ID>&key=<API key>
    &from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
    &limit=<page size>&page_no=<1..n>
```
Probes made while building:
- **No parameters** → `429` with `{"status":"error","message":"Sorry! Please provide all the required parameters."}`. This confirms the endpoint and shows it rate-limits even on bad calls.
- **`userid`, `profile_id`, `key`, `from_date`, `to_date` with dummy values** → `403` with `{"success":false,"message":"Sorry! Our service is currently undergoing maintenance…"}`. The required-parameter check passed, but the credentials were rejected; the "maintenance" text looks like a generic error. Inquira treats `403`/`401`, and messages about invalid keys, as `reauth_required`.

## Response (⚠️ inferred from common integrations; not verified with a real key)
A JSON array (Inquira also accepts `{data:[…]}` or `{inquiries:[…]}`) of objects like:
```json
{ "rfi_id": "843281891", "sender_name": "…", "sender_co": "…", "sender_mobile": "+91…", "sender_email": "…",
  "sender_city": "Hyderabad", "sender_state": "Telangana", "sender_country": "India",
  "product_name": "Chickpea Isolate Protein", "subject": "…", "message": "…", "quantity": "100 Kg",
  "generated_date": "2026-09-27", "generated_time": "21:00:13", "inquiry_type": "…", "landline_number": "…" }
```
`src/modules/sources/tradeindia/normalize.ts` reads every field through **alias lists**, for example:
- `rfi_id | inquiry_id | enquiry_id | id`
- `sender_mobile | mobile | …`

A renamed field only needs a one-line change there. The full raw object is always stored in `leads.raw_payload`, so leads can be re-normalised later.

## Limits (⚠️ undocumented publicly)
- The date range per call and the page size limit are unknown. Inquira uses **7-day windows**, `limit=50` and `page_no` paging until a short page, with **1.5 s** between calls.
- The rate limit is unknown; the bare call above got a 429. On `429` Inquira stops the run, records "rate limit", and backs off (10 min, 20 min … up to 6 h). The next cron tick resumes.
- **Schedule:** the first connect backfills 30 days; afterwards every 10 minutes it re-reads (last success − 2 days) → now. The overlap is harmless because upserts are idempotent on `rfi_id`.

## Notification emails vs API (verified from real emails)
- The same inquiry also arrives as an email from `inquiry.paid@rfis.tradeindia.com`.
- The email's "Click here to check inquiry" link carries `ext=<base64>`, which decodes to `rfi_id=<ID>&amp;section=Inbox#myReply`. The HTML read-pixel also carries `rfi_id=<ID>`.
- Inquira extracts this ID, so an **API inquiry and its email become one lead** (`source_ref` = rfi_id).
- "Looking for suppliers of …" (RFI / buy-lead) emails carry the placeholder `__RFI_ID__`. For those, the lead is matched by phone/email + product within 48 hours instead (DECISIONS ADR-009).

## Open questions for your TradeIndia account
1. Does the API return RFI / buy-lead inquiries ("Looking for suppliers of …") or only direct inquiries?
2. What are the maximum date range and page size, and are there daily call limits?
3. Are the field names above correct? After the first real sync, open any TradeIndia lead in Inquira; the raw payload is kept, and a developer can compare it.
