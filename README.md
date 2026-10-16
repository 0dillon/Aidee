# Aide

Aide gives businesses a voice assistant customers can use on their website or by phone. It is designed to help blind and low vision customers, people who find reading difficult, and anyone who prefers speaking. Businesses connect their own site, action API, verified knowledge, and voice provider.

The product follows the Aide Hackaholics PRD. The team pilot uses Arike as one example integration; Aide is not tied to Arike.

## Current state

- The Aide owner dashboard supports a business name, public website URL, API base URL, and encrypted shared secret. Owners can edit those details, import their own manifest, configure verified knowledge and an order callback, and sync the assistant to Vapi.
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
3. Resolve the Voicebip phone test described in [phone test status](docs/PHONE-CALL-STATUS.md). Confirm real ringing and two-way audio before integrating a replacement phone provider with Aide's actions, events and call records; otherwise connect a suitable carrier number to Vapi.
4. Validate the onboarding and safe verification flows required by the PRD.
5. Run the PRD acceptance flow several times, with Nigerian speakers and blind/low vision users.
6. Publish the external worker and verify callback timing on a hosted business integration.
