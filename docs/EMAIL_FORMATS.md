# Email formats observed in STDM's mailbox

Collected in Phase A (29 Sep 2026) using the read-only Gmail connector. I looked at about 60 recent threads. Anonymised copies are in `fixtures/emails/`, and every fixture has an `expected` block that the parser tests assert against.

> **Rule:** fixtures never contain real names, phone numbers, emails or company names. The connected mailbox is represented as `sales@seller.example`, and the salesperson as "Ravi Kumar".

## Volume snapshot (last 180 days, Gmail estimate)
- IndiaMART (`*@indiamart.com`): about 200+ threads.
- TradeIndia (`*@rfis.tradeindia.com`): about 200+ threads.
- Direct inquiries, replies, POs and proforma requests: several a day.
- Noise: newsletters, bank payment advices, vendor pitches.

## IndiaMART

| Format id | Sender | Subject pattern | Notes |
|---|---|---|---|
| `indiamart.enquiry` (phone) | `buyershelp+enq@indiamart.com` | `<Product> Enquiry by Phone on DD-MON-YYYY at HH:MM AM/PM` | The plain-text part is usable. Fields sit on separate lines as `Label` / `:` / `value`. The buyer block follows `Regards,` (name, company, `Click to call:` phone, `Email:` or "Not Provided", then location). |
| `indiamart.enquiry` (direct) | `buyershelp+enq@indiamart.com` | `Enquiry for <Product> from <FirstName> via IndiaMART` | ⚠️ **The text/plain part is often a broken template** (`Dear%20%7B%7B.toname%7D%7D…`). The parser must fall back to the HTML part: product is in `<b>` after "I am looking for", the requirements are in a 3-cell table (label, ":", value), and the buyer block comes after "Regards,". The company line may carry "(GST verified by IndiaMART)". |
| `indiamart.enquiry` (export) | `buyershelp+enq@indiamart.com` | `Export Enquiry for <Product> from <FirstName>, <Country> via IndiaMART` | Classified as **international**. The country is in the subject and on the last line of the buyer block. |
| `indiamart.buylead` | `buyleads@indiamart.com` | `Buyer Details for <Product>` | Arrives after **"Contact Buyer Now"** on a Buy Lead (the Cowork flow, §7.2b). The block after `Buyer's Contact Details:` holds verification ticks (`Phone ✓ Email ✓ GST ✓`), then `<Name> [<Company>] [<City> - <PIN>, <ST>]`, then `+91-XXXXXXXXXX`, then optionally `E-mail: …`. Next come `Buylead Details: <Product>` and a single line of `Key : Value` pairs (Quantity, Packaging Size, Protein Content %, Probable Order Value, …). The state is a 2-letter code (NL, MH, TN, GA, TS, MP). |
| `indiamart.reply` | `buyershelp+reply@indiamart.com` | `<Seller>, N new messages for <Product> enquiry from <Buyer> via IndiaMART` or `Re: <original subject>` | A **conversation** on an existing IndiaMART lead, e.g. "Please send COA report" or "Any negotiation". Linked to the existing lead by buyer email or phone. It does not create a new lead unless no lead matches, in which case it goes to `needs_review`. |

There is no stable IndiaMART enquiry ID in these emails, so `source_ref` for IndiaMART email leads is the **Gmail message id** (`gmail:<messageId>`). Dedup across emails then falls back to contact + product + a 48h window (ADR-009).

## TradeIndia

All TradeIndia emails come from `inquiry.paid@rfis.tradeindia.com` and share one layout: a bullet list with `Sender Name:`, `Product Details:`, `Requirement Details:` and `Buyer Details:`.

| Format | Subject pattern | Notes |
|---|---|---|
| Product inquiry | `<PRODUCT> Inquiry from <Name> through tradeindia.com` | `Buyer Details: Name - … Email - … Mobile - … city - … state - … country - IN`. The email is often the placeholder `noreply@noreply.tradeindia.com`, which is treated as *no email*. |
| WhatsApp inquiry | `<Product> Inquiry from <Name> through TI Whatsapp` | Same body as above. |
| Buy-lead / RFI | `Looking for suppliers of <Product>` | `Buyer Details` may omit the name, and the RFI id is the literal placeholder `__RFI_ID__`. |
| Catalog-website inquiry | `Inquiry from <digits> through tradeindia.com` | **HTML only** (the text part is `.`). "Requirement Details" contains a free-text message plus a `Details of the sender` block with `Name :`, `Company :`, `Email :` (may list several), `Mobile No. :` (may list several), `City :`, `State :` and `IP/Country :`. **STDM's own website (stdmfood.com) is a TradeIndia catalog, so website leads arrive in this format.** The subject "digits" are not a real phone number. |

**Inquiry ID.** The "Click here to check inquiry" link has an `ext=` query parameter. It is base64 for `rfi_id=<ID>&amp;section=Inbox#myReply`. In HTML the read-tracking pixel also carries `rfi_id=<ID>`. This ID is TradeIndia's inquiry ID. It lets an email be matched **exactly** to the same inquiry fetched through the TradeIndia API (ADR-009). The placeholder `__RFI_ID__` means there is no ID.

## Direct inquiries (no portal)
Free-form mail, e.g. "Requirement for Rice fiber powder, 700kg — send best price, COA, composition", "Quotation Required", "Price", or an RFQ. They are often from company domains with phone numbers in the signature. Code can't reliably extract product and quantity from these, so they go to **`needs_review`**. Claude then classifies them through MCP (`submit_email_classification`), and a person reviews low-confidence results.

International direct mail (e.g. an Indonesian importer) is detected later by Claude or by the country in the extracted fields. Code only adds an *international hint* when the text names a non-Indian country, and it never auto-drops these messages.

## Conversations
Replies in a thread already linked to a lead (e.g. "Any negotiation?", "Kindly share COA", "Please send proforma invoice") are classified as `conversation`. Handling conversations is on the roadmap.

## Noise (ignored)
- Newsletters: a `List-Unsubscribe` header or no-reply digest senders.
- Bank advices: "Payee Advice", "NEFT", "UTR".
- OTPs: "OTP" or "one time password".
- **STDM's own sent mail**: sender = the connected mailbox, or the `SENT` label.

Everything ignored is still stored in `email_messages` with a reason. Nothing is skipped silently.

Vendor pitches (packaging suppliers etc.) are **not** auto-ignored. They go to `needs_review`, and a person can turn the sender domain into an "always ignore" rule.

## STDM reply style (used for default templates)
Observed in about 15 sent quotations:

- **Greeting:** "Dear Sir," / "Dear Sir/Madam," / "Dear <FirstName>,".
- **Opening:**
  - Portal buy-lead replies: "Thank you for showing your interest in STDM Food & Beverages products. As per your requirement we are able to provide you "<Product>"."
  - Direct replies: "Thank you for your inquiry. Please find below the commercial details for <Product>:" or "Kindly find the details and pricing for … below:".
- **Body:** a short bulleted list:
  - `Price: Rs. <rate>/kg (Ex-Factory)`
  - `Pack Size: 20 kg` (proteins) or `25 kg` (starch, fibre, saccharides, lecithin)
  - `GST: 18% extra` or `5% extra`
  - `MOQ: 100 kg`
  - `Lead Time: 1–2 days`
  - `Payment Terms: 100% Advance`

  Several products are numbered (1., 2.), each with its own bullet list.
- **Extras:** "Please note that we provide samples of 100 grams…", "The Certificate of Analysis (COA) is attached for your reference."
- **Close:** "Please let us know if you have any questions or would like to place an order." / "Kindly feel free to contact us for any further queries."
- **Signature:** "With Regards", company name, both unit addresses, phones, emails, website and a legal disclaimer. **This lives in Gmail's send-as signature and is never written into templates.** Inquira fetches it at draft time (§7.5).
- **Negotiation replies:** "Prices are non negotiable." / "our quoted rates are fixed and non-negotiable as we offer our best ex-factory prices directly".
- **Samples:** "we are only able to provide 100–200 grams for sample requests". Sample requests ask for company name, FSSAI, GST certificate, delivery address and contact number.

Rates in the sent mail match `seed/rates.json` exactly, with GST quoted as extra. This is the evidence behind the GST-exclusive import (ADR-006, Q-001).
