# Business context

## STDM Food & Beverages Pvt. Ltd.
- **Where:** Indore, Madhya Pradesh.
  - Unit I: Sehkari Shit Grah, Rau Industrial Zone.
  - Unit II: Kheda Sector 2, Pithampur.
- **What they do:** a B2B supplier of food ingredients:
  - plant proteins: pea, brown rice, chickpea, mung, potato, soya, peanut, lentil, oats, quinoa, hemp, pumpkin
  - lecithins and phosphatidylcholine/serine
  - oligosaccharides (FOS, GOS, IMO, XOS)
  - native and E-number modified starches
  - fibres, dextrins and flours
- **Website:** https://stdmfood.com, a TradeIndia-built catalogue.
- **Mailbox:** `sales@stdmfoods.com`.

Products are **commodities**. Rates change often, so every quotation must use the current rate, and the rate that was quoted is kept (Inquira stores a snapshot on every quotation).

## Lead sources
1. **TradeIndia.** A free inquiry API, plus notification emails. Website inquiries also arrive through TradeIndia, because the website is TradeIndia-built.
2. **IndiaMART.** No API.
   - Direct enquiries arrive by email.
   - A Claude Cowork browser task clicks **Contact Buyer Now** on matching Buy Leads (rules served by Inquira), and the buyer details then arrive by email.
3. **Direct email** to the sales mailbox.
4. **Phone.** Entered manually with **New lead**.

International inquiries (outside India) are detected, stored and parked in their own view. They are not quoted until USD pricing exists.

## Lead lifecycle
`new → contacted → quoted → negotiating → won | lost`, or `not relevant` at any point.
- Creating a quote draft moves `new`/`contacted` to `quoted` automatically.
- Everything else is set by a person or by Claude through MCP. Every change is time-stamped with who made it.

## Quotation rules (observed in STDM's sent mail, 29 Sep 2026)
- **Price:** per kg in INR, **ex-factory**, **GST extra**:
  - 18% for protein and lecithin derivatives
  - 5% for starches, saccharides, fibres, dextrins and flours
- **Pack size:** 20 kg for proteins, 25 kg for the rest (soya flour 25/50 kg).
- **Payment:** 100% advance. **Lead time:** 1–2 days. **MOQ:** usually 100 kg (not in the rates file, so left empty; see QUESTIONS Q-002).
- **Samples:** 100–200 g. A sample request needs the company name, FSSAI, GST certificate, delivery address and a contact number.
- **Negotiation:** "Prices are non-negotiable."
- **Validity:** 3 days by default in Inquira (configurable).
- **Signature:** the Gmail signature carries the units, phones and a disclaimer. It is never duplicated in templates.

## Glossary

| Term | Meaning |
|---|---|
| **COA** | Certificate of Analysis — lab results for a specific production batch. Buyers ask for it before ordering. |
| **TDS** | Technical Data Sheet — the product's specification (protein %, moisture, particle size, …). |
| **MSDS / SDS** | (Material) Safety Data Sheet. |
| **MOQ** | Minimum Order Quantity. |
| **Ex-works / ex-factory** | The price at the factory gate; freight and insurance are the buyer's. |
| **GST** | India's Goods and Services Tax, quoted separately ("GST extra"). |
| **PI** | Proforma invoice — issued before payment when a buyer confirms. |
| **FSSAI** | Food Safety and Standards Authority of India licence number. |
| **Buy Lead (IndiaMART)** | A buyer's public requirement that sellers "unlock" with credits via **Contact Buyer Now**. |
| **Enquiry (IndiaMART)** | A buyer contacting STDM directly from its IndiaMART catalogue (free). |
| **RFI / rfi_id (TradeIndia)** | Request For Information — TradeIndia's inquiry and its ID. |
| **Isolate / concentrate** | Protein purity classes (isolate ≈ 80–90%+, concentrate lower). The website and rates file sometimes disagree (QUESTIONS Q-003). |
| **E-numbers (E1401–E1450)** | EU codes for modified starches. |
