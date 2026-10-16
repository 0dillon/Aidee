# Aide

Aide gives businesses a voice assistant customers can use on their website or by phone. It is designed to help blind and low vision customers, people who find reading difficult, and anyone who prefers speaking. Businesses connect their own site, action API, verified knowledge, and voice provider.

The product follows the Aide Hackaholics PRD. The team pilot uses Arike as one example integration; Aide is not tied to Arike.

## For judges

**Aide makes any website or app voice-native.** Customers talk to the app and the app talks back, so blind, visually impaired and low-literacy people can use services that assume they can see and read. Every call becomes structured data for the business.

**Try it**
- Dashboard: https://aide-voice.vercel.app (the demo login is given to judges by the team, it is not stored in this repo).
- Open **Call a number**, enter a phone number and press **Call now**. Aide rings it and holds the conversation by voice.
- The sample business is **Wear Arike**, a clothing pre-order shop (https://arike-wema-shop.vercel.app). It is connected through its action manifest, so Aide can create accounts, search products, check delivery and place pay-on-delivery orders by voice.
- Open **Customers** and **Calls** to see accounts created and call status and transcripts for each call.

**How it works**
- Phone calls run on Bimpe (api.bimpe.ai). Aide places calls through its API and imports status and transcripts.
- Bimpe calls Aide's tool endpoint, `POST /api/bimpe/tools/{name}`, to run business actions. The endpoint is protected by a bearer secret.
- Any business plugs in by publishing `GET /api/aide/manifest`. Aide imports the actions and gives them to the voice agent as tools.
- The agent prompt is written for listening only: short sentences, amounts in words, numbers one digit at a time, and a clear yes before anything that changes data. For unusual requests it slows down and confirms twice.

**What is verified and what is not**
- Verified live: Aide places a real phone call through Bimpe, the call is answered, and the agent speaks. The business actions are synced and the tool endpoint returns real catalog data.
- Not yet shown end to end: voice onboarding creating an account during a live call. This is the next thing to rehearse.
- Not built: identity verification (BVN, safe phrase, PIN keypad), real payments, and bank connectors. The same manifest approach is how a bank would connect.
- Call logging relies on polling Bimpe about once a minute, so the dashboard can lag. Browser voice on the Arike site still uses Vapi and Sahara.
- Phone minutes are limited, so please do not place long test calls.

## Current state

- The Aide owner dashboard supports a business name, public website URL, API base URL, and encrypted shared secret. Owners can edit those details, import their own manifest, configure verified knowledge and an order callback, and sync the assistant's tools and knowledge to Bimpe (phone) or Vapi (browser voice).
- Dashboard customers, calls, metrics, and charts use persisted business activity only. Generated customer/call history is not shown or seeded; historical insights fill as real calls arrive. Localhost sample businesses are hidden from the owner workspace.
- The dashboard shows the promotion interest split on Overview, weekly promotion interest in Insights, customer order counts, and each call's phone/web channel.
- Supabase schema, authentication, signed business events, action routing, call logging, Vapi webhooks and Sahara TTS adapter are in place.
- The Arike widget now stays visible, describes its controls to screen readers, offers page-aware text prompts without opening the microphone or requesting Sahara audio, and only starts voice after the customer chooses **Talk now**. It announces microphone state and gives one spoken recovery prompt when an explicitly started session hears no speech. Idle visits and text-only help do not spend Sahara credits. Product facts passed to Aide come from the current storefront catalogue.
- Checkout follows the PRD: confirmed product, size, quantity and delivery details; pay on delivery only. No card or bank details are collected.
- Browser voice is still under active integration and must be rehearsed with a real web call before it is presented as working. The PRD uses Vapi for phone calls; Twilio is not a PRD requirement, and this Vapi account currently has no connected phone number. A Voicebip phone test is being evaluated separately; see [phone test status](docs/PHONE-CALL-STATUS.md). Nigerian speech recognition and the complete PRD onboarding and verification flows are not yet accepted.
- Sahara TTS was smoke tested once. Do not run repeated voice tests without a specific need because each call spends credits.

## Connect a business

1. Deploy the business site and its Aide API integration over HTTPS.
2. Publish `GET /api/aide/manifest` at the API base URL. Return JSON with an `actions` array and optional verified `knowledge` text. Each action needs a `name`, `description`, `method` (`GET` or `POST`), `path` beginning with `/`, and a JSON schema in `params_schema`.
3. Set the same strong shared secret in the integration and Aide. The integration uses it to sign event requests and validate action requests. Aide encrypts it at rest and never returns it to the browser.
4. In the dashboard, open **Connect site** and enter the business name, the customer facing website URL, the API base URL, and shared secret. Save the connection, then import actions and add only verified policies and product details.
5. Set the callback trigger if the business wants to call a customer after an order. Sync the assistant after updating actions or knowledge.

The website URL is the link customers visit. The API base URL is the deployed application that serves the manifest and action endpoints. In production, both must use HTTPS. Localhost is only useful for local development and is not reachable by Vapi's cloud services.

## Run locally

From the repository root:

```powershell
npm.cmd install --ignore-scripts
npm.cmd run dev:aide
npm.cmd run dev:arike
```

Aide runs at `http://localhost:3000`; Arike is the sample integration at `http://localhost:3001`.

Keep secrets in ignored `apps/aide/.env.local` and `apps/arike/.env.local` files. Aide's required variables are listed in `apps/aide/.env.example`. Never commit `.env.local`, Vapi private keys, Supabase service keys, Sahara keys, or shared business secrets.

## Architecture

- `apps/aide`: Next.js owner dashboard, Supabase data access, Vapi assistant and tools, webhooks, and Sahara TTS adapter.
- `apps/arike`: sample storefront and Aide manifest/action integration. The Arike team owns the customer facing website.
- `supabase/schema.sql`: database schema.
- `worker/worker.mjs`: event dispatcher and outbound retry worker.

The business manifest format used by the sample integration is defined in `apps/arike/src/lib/manifest.ts`.

## Next work

1. Rehearse the Arike widget with a real microphone and screen reader: permission granted/denied, low-volume speech, silence recovery, interruption, repeat, mute and typing fallback. Do not repeat paid Sahara calls unnecessarily.
2. Finish the Aide browser voice call and confirm transcripts and actions are logged correctly.
3. Phone calling now runs on Bimpe; see [Bimpe setup](docs/BIMPE-SETUP.md) and [demo plan](docs/DEMO-PLAN.md). The older [Voicebip phone test notes](docs/PHONE-CALL-STATUS.md) are kept for history. Rehearse onboarding and the order callback on a real handset before presenting them as working.
4. Validate the onboarding and safe verification flows required by the PRD.
5. Run the PRD acceptance flow several times, with Nigerian speakers and blind/low vision users.
6. Publish the external worker and verify callback timing on a hosted business integration.
