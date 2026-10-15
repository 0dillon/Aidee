# Phone test handoff — 15 October 2026

## Product scope

The original Aide PRD remains the source of truth: a horizontal voice platform, with Arike Pre-order as the first business. Its phone architecture uses Vapi. Twilio is not specified as a requirement. Voicebip is an experimental carrier/agent alternative for the requested no-upfront-payment Nigerian phone demo, not a completed replacement for the PRD implementation.

## Verified account setup

- Aide's Voicebip account is created and email verified. Onboarding is complete and the provider's DPA was accepted during setup.
- A single Aide — Arike agent and a Nigerian geographic number were provisioned. Provisioning left the starter credit unchanged at NGN 2,000.
- The API confirms an active Starter subscription. The dashboard advertises 10 included voice minutes, but its quota counters show overage active and zero included numbers. Do not promise a usable 10-minute quota based on the plan card alone.
- The provider's live voice catalogue includes Nigerian male voices. The test agent uses Tolu via ElevenLabs and a hosted OpenAI model. Sahara is absent from this catalogue; Sahara remains configured for the existing website voice path. No Sahara generation was made during this phone setup.
- API credentials and the generated account password are saved locally outside this repository. No payment card was added and no paid subscription or top-up was purchased.
- Call recording and public agent sharing are disabled.

## First outbound test: not accepted

One outbound connection test was requested to the owner's explicitly provided number. The API initially returned `queued`, then `initiated`. The owner reported **no ringing**.

The provider subsequently reported `completed`, 32 seconds, a nine-turn transcript and NGN 80 deducted from the starter credit. Remaining balance: NGN 1,920. A termination request returned `404 call: not found`; the later read showed the call already completed.

The provider's transcript and completion status conflict with the owner's no-ring report. Until the owner confirms a delayed call or the provider supplies a clear explanation, this is **not evidence of a successful phone demo**. Do not place repeated calls to resolve this by guessing.

The test agent only has verified Arike policy text and connection-test instructions. Its prompt explicitly says it cannot create accounts, place orders or check live stock yet. It has no business tools connected, no Aide webhook, and its provider call record has not been imported into Aide/Supabase. This is not the PRD end-to-end flow.

## Next steps

1. Reconcile the owner's report with the provider's call record. Confirm the intended handset receives ringing and intelligible two-way audio.
2. Confirm actual billing/quota rules and whether the Nigerian number remains free after the initial trial. Do not add a paid plan or top up without authorization.
3. If the phone path works, connect hosted `tool.invocation` requests to Aide's existing tool router. Verify raw-body HMAC signatures and timestamp freshness before dispatch.
4. Add provider-specific call identifiers without mislabeling them as Vapi calls. Persist lifecycle updates, transcripts, structured insights and retry state; preserve signed `order.placed` triggers and confirmed mutations.
5. Rehearse the real PRD inbound/order/outbound flow three consecutive times. No claim of full PRD acceptance until this passes.

## Official references

- [Voicebip outbound calls](https://docs.voicebip.com/guides/voice-calls)
- [Hosted agent tools and webhook payload](https://docs.voicebip.com/use-cases/tool-calling)
- [Agents and supported voice catalogue API](https://docs.voicebip.com/guides/agents)
- [Sandbox limitations](https://docs.voicebip.com/reference/sandbox-mode)

Sandbox calls do not prove a normal phone rang. Provider status alone also does not prove the recipient heard the conversation.
