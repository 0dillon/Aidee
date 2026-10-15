# Aide hackathon MVP

Aide gives a business a voice for the customers who struggle most with screens: blind and low-vision people, low-literacy and elderly users. Customers talk to the business's site or phone line; Aide can also call them. The intended calls are **onboarding blind customers** (guided account set-up and a tour of the product) and **fraud and verification calls** of the kind a bank makes to its customers. Every call is recorded as structured data on a business dashboard.

The demo business is **Arike Pre-order**, a small clothing storefront. The governing specification is `Aide PRD.md` (kept outside this repository).

> **Honest status, 15 October 2026.** The browser voice assistant on the Arike site works for simple product questions and can run account and order actions through a language model. It is **not fast** and **not reliably accurate on Nigerian-accented speech**. The onboarding and fraud calls are **not built**. Only the PRD's order-callback script exists, and it has been type-checked but **never run end to end**. The PRD acceptance test (full flow, three live runs in a row) has **not** been passed. Nothing here is production-ready, and it has not been tested with blind users or screen readers.

## What works, what does not

| Area | State | Evidence |
| --- | --- | --- |
| Arike storefront, six actions, signed `order.placed` event | Works locally | Orders saved to Supabase; events stored with valid signatures (earlier session). |
| Aide dashboard (calls, customers, insights) and Supabase schema | Built, local | Seeded with 10 labelled demo customers and 30 `DEMO HISTORY` calls; aggregate metrics include them. |
| Web voice assistant (Arike site) | **Partly works, slow** | Heard a real spoken sentence and answered it once; the typed path with tool use works (product sizes, account policy). Short follow-up replies were being wrongly discarded by an echo filter; fixed but **not re-tested by voice**. |
| Hearing Nigerian accents | **Not solved** | A real utterance was heard as "Thank you, T-shirt" by Whisper; Sahara English gave similar results on a tiny sample; Sahara's code-switched settings (`yo`, `ig`) returned wrong-language text. Not a benchmark. The answering model is told to recover misheard product names, which helps but is not recognition. |
| Speed | **Poor, and uneven** | Same request took 0.8 s to 16.8 s depending on the moment. Sahara voice takes about 8 to 14 s to generate a new sentence; repeated sentences are cached (about 0.06 s). Everything runs on a home connection through no hosted server. |
| Order callback (browser fallback) | Written, **untested** | After an order, Aide opens a call about 15 s later, asks for a 1 to 5 rating, announces the promo, asks interest and offers a reminder. Call, tool calls, follow-up and AI-extracted insights are written to Aide's `calls`, `tool_calls`, `followups` tables. Type-checked only. Whether web calls appear correctly on the dashboard is **unverified**. |
| Onboarding call for blind users | **Not built** | |
| Fraud / verification call (safe phrase, keypad PIN, unusual-activity rules) | **Not built** | PRD "Buildout" item 5. |
| Phone calling (Vapi + Twilio) | **Not working** | No phone number; Vapi's free numbers are US-only. The Vapi assistant was synced and spoke, but in the browser the voice was reported as static (Aide's own generated audio measured clean) and calls hung up, so the web voice no longer uses Vapi. Phone, outbound worker and retry remain untested. |
| NIPOST postcode lookup | **Missing** | `NIPOST_API_KEY` is not available. The browser agent takes a spoken address and marks the order `address_needs_review`. |
| Accessibility | Built, **untested with users** | Skip link, Alt+A shortcut, focus trap, spoken failure messages, text input. A browser accessibility tree check is not a screen-reader or blind-user test. |

## How the web voice works

`apps/arike/src/app/VoiceButton.tsx`

1. The browser records the microphone and a turn detector decides when you stopped speaking.
2. `/api/stt` transcribes it with Groq Whisper (`GROQ_API_KEY`); without that key it falls back to Sahara (`SAHARA_API_KEY`).
3. `/api/voice/chat` sends the conversation to a language model (default DeepSeek) with Arike's actions as tools, streams short sentences back, and logs the call.
4. `/api/voice/tts` speaks each sentence with Sahara in a male English voice; sentences are fetched ahead and cached.

Typing is always available as a fallback. Aide says aloud when it did not catch you or cannot reach the microphone.

## Layout

- `apps/aide`: Next.js dashboard, business API, Vapi tool router and webhook, Sahara voice adapter for Vapi (port 3000).
- `apps/arike`: Next.js storefront, Aide manifest and action endpoints, the browser voice assistant and call logging (port 3001).
- `supabase/schema.sql`: schema, applied to the project.
- `worker/worker.mjs`: event dispatcher and outbound retry worker (not run in recent sessions).
- `scripts/`: Sahara smoke test, idempotent demo seed.

## Run locally

```powershell
npm.cmd install --ignore-scripts
npm.cmd run dev:aide
npm.cmd run dev:arike
```

Aide: `http://localhost:3000`. Arike: `http://localhost:3001`. Use **Chrome-based browser in a foreground tab** for voice; background tabs cannot capture the microphone.

Arike server variables (`apps/arike/.env.local`, never committed): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AIDE_SHARED_SECRET`, `AIDE_BUSINESS_ID`, `AIDE_EVENTS_URL`, `NEXT_PUBLIC_SITE_URL`, `SAHARA_API_KEY`, `SAHARA_TTS_GENDER`, `SAHARA_TTS_ACCENT`, `GROQ_API_KEY`, `VOICE_LLM_API_KEY` (plus optional `VOICE_LLM_BASE_URL`, `VOICE_LLM_MODEL`), `STT_COMPARE=1` only for diagnostics (runs every recognizer on each sentence and spends credits).

Aide server variables are listed in `apps/aide/.env.example`.

## Known problems and risks

- **Credits:** each spoken turn spends a speech-recognition request, a model call and one or more Sahara voice requests. Sahara timed out often during testing.
- **Open endpoints:** the Arike voice endpoints have no sign-in. They check the request origin and apply a simple in-memory rate limit. Do not expose them publicly as they are.
- **Fraud and bank use needs far more:** a bank-grade fraud call needs mutual authentication, safe phrase, keypad PIN capture, consent and recording notices, and audit logs. None exist.
- **Hosting:** the app has only run on a developer laptop. A hosted deployment is the most likely fix for the speed problem and has not been done.
- **Keys:** any key that was pasted into a chat or terminal should be rotated.

## Next steps, in order

1. Run the order-callback end to end in a foreground browser and confirm it appears on the dashboard.
2. Replace the callback script with an **onboarding** script and a **fraud verification** script; define safe phrase and escalation rules.
3. Host Aide and Arike on a fast host, then re-measure speed.
4. Record real, scripted Nigerian-accented sentences with known transcripts and score recognizers on them before choosing one.
5. Obtain a phone number for Vapi (Twilio trial can call only verified numbers) and test the phone path.
6. Test with blind users and screen readers.
