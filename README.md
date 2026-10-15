# Aide hackathon MVP

Aide gives Arike Pre-order a voice. Customers can call or use the site button to ask questions, create an account, shop and order. Arike sends signed order events to Aide; Aide starts a callback and turns calls into dashboard insights.

This is a **new project folder**. The sibling `aide-sdk` and other existing projects were not changed. The governing specification is `C:\Users\HomePC\Downloads\Aide PRD.md`.

## Current status — 15 October 2026

| PRD area | Status | Evidence / remaining work |
| --- | --- | --- |
| Arike storefront and six actions | Built, locally tested | Three Supabase products render; a browser order saved to `arike_orders`. Manifest imports six actions. |
| Aide business connection | Built, locally tested | Demo Supabase Auth login works; Arike connected, knowledge imported, trigger saved. |
| Signed event path | Built, locally tested | Second browser order `ARI-A567CC21` created an `order.placed` event with `signature_valid=true` and an Aide customer. |
| Vapi tools and webhook | Implemented, not live tested | Need Vapi keys, public Aide URL, assistant sync and live call rehearsal. |
| Web voice surface | Built, visual interaction tested | Opens a motion panel and listens to SDK transcript/tool events. Actual audio call awaits Vapi configuration. |
| Sahara / Intron TTS | Adapter built, direct API smoke tested | Sahara generated audio successfully; Vapi custom voice path still needs a live Vapi call. |
| NIPOST postcode | Server tool built, awaiting key | Set `NIPOST_API_KEY`; test five real codes and spoken variants. |
| Outbound worker and retry | Implemented, not live tested | Needs a public deployment, Vapi phone number able to call Nigeria, then callback/no-answer tests. |
| Dashboard | Built, live Supabase connected | Overview, actions, customers, calls, transcript/tool details, insights and Realtime. Synthetic history script exists but has not been confirmed run. |
| PRD acceptance | **Open** | The required full voice flow has not passed three consecutive live runs. Do not present it as complete. |

The user explicitly chose **Sahara for TTS**. Vapi remains the voice and phone platform. The PRD calls for a **Twilio number imported into Vapi** with Nigeria voice geo permissions.

## Layout

- `apps/aide` — Next.js dashboard, business API, Vapi tool router, webhook and Sahara TTS adapter (port 3000).
- `apps/arike` — Next.js storefront, Aide manifest/action endpoints, signed order event and voice button (port 3001).
- `supabase/schema.sql` — database schema and three Arike products. Already applied to Supabase project `brqqpnbhqzhcxngnvavn`.
- `worker/worker.mjs` — event dispatcher and outbound retry worker.
- `scripts/sahara-smoke.mjs` — direct Sahara TTS check.
- `scripts/seed-demo.mjs` — idempotent, visibly labelled synthetic history (10 customers, 30 calls). Run only after checking whether an interrupted attempt left partial records.

## Local start

```powershell
npm.cmd install --ignore-scripts
npm.cmd run dev:aide
npm.cmd run dev:arike
```

Open `http://localhost:3000` for Aide and `http://localhost:3001` for Arike. The shared demo login is in Supabase Auth. Keep passwords and keys in ignored `.env.local` files. On this machine the local files are already populated for Supabase and Sahara; they are **not in Git**. The Arike environment contains `AIDE_BUSINESS_ID` after connecting Arike in the dashboard. Aide stores the Arike shared secret encrypted in Supabase.

Required Aide server variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AIDE_ENCRYPTION_KEY`, `VAPI_WEBHOOK_SECRET`, `AIDE_WORKER_SECRET`, `AIDE_PUBLIC_URL`, `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `NIPOST_API_KEY`, `INTRON_API_KEY`. Arike requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AIDE_SHARED_SECRET`, `AIDE_BUSINESS_ID`, `AIDE_EVENTS_URL`, `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `NEXT_PUBLIC_VAPI_ASSISTANT_ID`. Keep all private keys server side; only Vapi's designated public key goes to the browser.

## Test and handoff order

1. Confirm `events` contains the signed order above; run the wrong-signature test and confirm HTTP 401 plus `signature_valid=false` record.
2. Check whether `scripts/seed-demo.mjs` partially ran during interruption, then finish seeding PRD history. It marks call transcripts and summaries as **DEMO HISTORY**.
3. Retrieve/create Vapi private and public keys from the signed-in dashboard. Deploy Aide and Arike to public HTTPS URLs, set runtime env vars, update Arike `AIDE_EVENTS_URL` and the Aide business URLs. Sync the assistant. Verify **eight tools** (six Arike actions plus postcode and follow-up).
4. Obtain the NIPOST test key from the team; it is intentionally absent from the PRD. Test real postcode, O/0 variant and invalid code.
5. Import a Twilio number into Vapi; verify Nigeria calling permissions and a short +234 test call. Do not initiate calls to placeholder/demo numbers.
6. Start the worker, run the PRD end-to-end plan in order, then three consecutive full rehearsals and record the backup video. Measure response and tool latency.

Use `npm.cmd run build -w apps/aide` and `npm.cmd run build -w apps/arike` before pushing. The latter passed after the voice surface update. Do not commit `.env.local`, credentials or recordings. Use Git author email `uhumaghodavid@gmail.com` as requested by the user.
