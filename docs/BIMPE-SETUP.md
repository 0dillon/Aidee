# Bimpe phone calling setup

Aide uses Bimpe (api.bimpe.ai) for phone calls. Vapi is only still used by the browser "Talk to Aide" button.

## One-time setup

1. Run `supabase/migrations/2026-10-15-bimpe.sql` in the Supabase SQL editor.
2. Set in `apps/aide/.env.local` and Vercel: `BIMPE_API_KEY` (Bimpe dashboard, API keys), `BIMPE_AGENT_ID` (the Dial agent id), `BIMPE_TOOL_SECRET` (`openssl rand -hex 32`), `AIDE_PUBLIC_URL` (public HTTPS), `TRIGGER_WORKER_SECRET`.
3. In the Aide dashboard click Sync. This creates a custom API integration on the Bimpe agent (one tool per enabled action plus `lookup_postcode`, `schedule_followup`, `get_call_context`, `record_call_outcome`) and pushes the knowledge text as a knowledge base.
4. Bimpe's API cannot set the agent prompt. Paste the prompt below into the agent's workflow in the Bimpe dashboard.
5. Schedule `POST {AIDE_PUBLIC_URL}/api/worker/tick` every minute with `Authorization: Bearer $TRIGGER_WORKER_SECRET` (cron-job.org or similar). It sends due callbacks and imports call status, transcripts and inbound calls from Bimpe.

## Agent prompt

You are Aide, the voice assistant for the business named in your knowledge base. Keep replies to one or two short sentences. Ask one question at a time.
Use only knowledge-base text and tool results for facts. Say "I don't know" otherwise and note the question for `unanswered_questions`. Confirm before any action that changes data. Read back names, sizes, prices and addresses. Never ask for card or bank details.
Outbound calls: call `get_call_context` first. Greet the customer by name, confirm the order in one line, ask for a 1 to 5 rating, announce only the promotion in the knowledge base, ask how interested they are, offer a reminder and call `schedule_followup` only if they agree.
Account: collect and confirm full name and phone, then `create_account`. Checkout: collect product, size and quantity, ask for the postcode, call `lookup_postcode`, read the address in words, get a yes, then `create_order` with `pay_on_delivery`. If the postcode fails twice, take a spoken landmark address and set `address_needs_review`.
Before hanging up always call `record_call_outcome` once.

## Known limits of Bimpe's API

- No per-call overrides: the callback script reaches the agent through `get_call_context`, which returns the most recent active call for the business (last 30 minutes). Do not run two callbacks at once.
- No documented call webhooks: Aide polls on each worker tick, so the dashboard lags by up to a minute.
- Structured insights come from `record_call_outcome`, not post-call analysis. Without that call a call row has no rating or promo interest.
- Calls fail with "You do not have permission to access this agent" until the API key's user is allowed on the Dial agent (Anas owns the team).
