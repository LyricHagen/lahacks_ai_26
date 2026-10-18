# LA Hacks AI Hackathon 2026 — Master Plan

> **Clock:** Today is Sat Oct 17. **Devpost deadline is Sun Oct 18 @ 12:00 PM PDT** (~23h). In-person judging attendance is required.
> **Sources read:** `context/ideas.txt`, `context/company_challenges.txt`, `context/tracks.png`, and all 16 PDFs in `context/tracks/`.
> **Hard constraint from the team:** no custom hardware. Lent devices that only need *software* (Even G2 glasses) are treated as optional and flagged.
> **Open question, ask at the opening session:** is judging a stage demo or table-side, and how long is each slot? Nothing in the docs says. Even's rules ("can a judge put on G2… right now?") suggest one-on-one tables. The answer decides how many surfaces the demo can afford.

---

## TL;DR

**Recommended build: `Lowball`. It's an AI that haggles for you.**

> *"Tell it what you want and your max price. It finds the listings, texts and calls the sellers, haggles honestly, and pays only once you approve."*

- **5-second test:** "An AI that haggles for you." Anyone gets it right away, and it's funny.
- **Judge-involvement demo:** the judge photographs something of their own, sets their *own* secret floor, and texts HAGGLE to Lowball's number. Lowball inspects the photo, pulls live eBay sold comps, and haggles with them by text. Savings are measured against real market comps, not a price we made up. Voice calls and agent-to-agent go in the video (see §3.8).
- **Tracks it can credibly enter:** about 18 (see matrix). About 8 of them are core fits rather than add-ons.
- **Model Learning story:** we RL / rejection-sample fine-tune a small open model into an honest negotiator on Veri, then show eval numbers against the base model and a frontier model.

**Runner-up builds** (written up in full below, so you can pivot):
1. **Subtext**: jargon subtitles for your first weeks at work, shown in Even G2 glasses (Even Realities $3.8k + Workday + Veri + Beyond the Digital). It has the most prize money per competitor, but it needs the loaner glasses.
2. **Plus One**: the friend in your group chat who actually makes plans happen (Photon + CREAO Team Empowerment + Fetch + Browser Use + Visa).
3. **Headroom**: a business card that knows if you can afford it *before* you swipe (Visa + QuickBooks + Veri + Tiger Data).
4. **Altostratus**: a new-hire agent that finds the right person and drafts the ask (Workday-centric).

---

## 1. Track inventory (everything on the table)

### 1a. Main LA Hacks tracks (pick at least one; they're judged on Technical Depth, Product Thinking & Impact, Execution & Polish, Originality & Insight)

| Track | What it wants |
|---|---|
| **Agentverse (Fetch.ai)** | Agents registered on Agentverse, discoverable via ASI:One, that turn intent into outcomes |
| **Model Learning** | Systems that learn, adapt, and improve from data |
| **Beyond the Digital** | Embedded AI, hardware, AR/VR, emerging interfaces |
| **Applied Intelligence** | AI for real-world problems: automation, accessibility, education, healthcare… |

### 1b. Sponsor / company challenges

| Sponsor | Prize (per docs) | Hard requirements | Cost to qualify | Notes |
|---|---|---|---|---|
| **Cognition: Best Use of Devin** | $5,000 (Devin credits per PDF; Devpost says cash) | Build with Devin | **Very low** | Judged on creativity, novelty, polish. Every team gets free credits. Show Devin sessions in the video. |
| **CREAO** (3 sub-tracks) | $2,000 AI-First Disruptor / $1,000 One-Person Company / $500 Team Empowerment + Launchpad | A **CREAO agent does the core work**. Built on agent.creao.ai. README has a share link to an agent run plus the agent ID. Agent shown running in the demo. Select the CREAO track on Devpost. | Low–Med | Use the upgraded-account signup link. "Remove the agent and the product stops working." |
| **Even Realities: Smart Glasses** | 1st: 4× G2 ($2.4k) / 2nd $1k / 3rd $400 | Even Hub app uploaded as a Beta build, runs on a physical G2 at judging (loaners available), name ≤20 chars without "Even", README install steps. **No medical, financial, or emergency-routing apps.** | Med–High | Theme: "Quiet Tech." One thoughtful interaction beats many features. |
| **Fetch.ai: ASI:One Agent Challenge** | $3,000 | Register on agentverse.ai. Implement Agent Chat Protocol. Full primary workflow usable **inside an ASI:One chat** with no custom frontend required. Public repo. Submit through the Submission Agent as well as Devpost. | Med | Bonus: multi-agent, **Payment Protocol with a credible monetization model**, Interactive Cards, error recovery, real-time data, could keep running after the hackathon. |
| **Paper: Best Designed Hack** | $1.5k / $1k / $500 | Judged on design fundamentals, ease of use, personal craft. Code LAHACKS26 gets Pro. | **Low** (if we design for real) | "Differentiate from clearly AI-generated designs." Must actually use Paper (MCP to the canvas). |
| **Visa: Future of Shopping** | $2,000 | Generative-AI commerce experience plus secure, trusted payments | Med | Innovation 25 / UX 25 / Tech 20 / Commerce Impact 15 / **Trust & Responsibility 15** |
| **Workday: Future of Work** | $2,000 + DevRel follow-up | Agent or prototype that helps people *after they join a company* | Med | Agentic logic 30 / New-hire relevance 20 / **Responsible AI 20** / Future of Work 15 / UX 10 / Pitch 5. Synthetic data only. |
| **Base44: Build Something People Want** | $1.5k / $500 | **Built substantially on Base44**, live Base44 app, problem/user/solution write-up, "what we learned or changed" | Med | Wants evidence of user feedback or iteration. |
| **Intuit QuickBooks: System One** | $200 / $100 / $50 gift card per person | Something newly possible because of speed, cost, or specialization, plus a **realistic eval against alternatives** on the provided HF dataset | Med–High | Eval is most of the work. |
| **Veri: Best Open-Source Model** | $800 | Post-train / fine-tune an open model on Veri | Med | **DM @daniung for credits before the first run** (jobs on a $0 balance get killed). They suggest RL ideas. |
| **Sentry** | Guaranteed interview for each member | Sentry plus **≥2 of** Session Replay, Logs, Tracing, Profiling, Uptime, AI-agent monitoring. Show how observability *shaped* the build. | **Low** | Keep a "Sentry diary" of real bugs found. |
| **Photon 2.0** | (TBD) | Messaging or calling agent on Photon 2.0 beta (iMessage, SMS, RCS, WhatsApp, Telegram, email, voice) | Low–Med | Voice runs on an **SMS number** (not iMessage) via SIP to ElevenLabs/Retell/LiveKit/Twilio. |
| **StepFun: Step 5 Preview** | (TBD) | App **must call `step-5-preview`** at runtime. Explain how each model works alongside it. | Low | Judged on task completion, reliability, user understanding and control. Image understanding is called out. |
| **Browser Use** | (TBD) | Agent that turns a goal into web actions | Low–Med | "An agent that pays and completes transactions for you" is explicitly listed. |
| **QNX / Espressif** | $1.5k / hardware | QNX OS + oss.qnx.com AI module / Espressif hardware | High | **Skip.** It's hardware. |
| **MLH: Gemini, ElevenLabs, Snowflake, Vultr, Solana, Tiger Data, GoDaddy domain, Commit Fellowship** | Swag / gadgets / fellowship interview | Use the tech | Low each | GoDaddy = register the domain through MLH's offer. Commit Fellowship = opt in plus a supplemental form. |

> ⚠️ **Verify at the opening session or sponsor booths:** (1) whether Devpost limits how many challenges one project can select, (2) whether StepFun / Browser Use / Sentry / Photon prizes are live (they're on the challenges page but not in the Devpost prize list), (3) whether Base44 and CREAO judges accept a project that *also* uses other stacks.

### 1c. Track categories

- **"Free stack" tracks.** Almost any project qualifies with a small, genuine integration: **Devin, Paper, Sentry, StepFun, GoDaddy, Vultr, Tiger Data, ElevenLabs, Gemini, Commit Fellowship.** Every plan below takes these. They cost little and Devin plus Paper alone is up to $6.5k.
- **"Platform-core" tracks.** These need *their* platform at the center: **Fetch (ASI:One must run the workflow), CREAO (a CREAO agent does the core work), Base44 (built substantially on Base44), Even (runs on G2).** We can stack them because each one owns a *different layer*:
  - ASI:One is the chat surface.
  - CREAO is one core worker agent.
  - Base44 is the web app.
  - G2 is the wearable surface.
  - If a layer would only be a fig leaf, drop that track. Judges spot fake integrations.
- **"Theme" tracks.** The idea has to fit: **Visa (shopping), Workday (new hires), QuickBooks (SMB finance), Even (quiet moments), Photon (messaging), Browser Use (web actions), Veri / Model Learning (training).** **The choice of idea decides which of these we win.**

---

## 2. Idea generation: everything considered

All scored 1–5. **Clarity** = the 5-second test. **Novelty** = how unlike a common hackathon project it is. **Demo** = how well judges can take part. **Tracks** = how many it genuinely fits.

| # | Idea (5-second pitch) | Clarity | Novelty | Demo | Tracks | Verdict |
|---|---|---|---|---|---|---|
| 1 | **Lowball**: an AI that haggles for you | 5 | 4 | 5 | 5 (≈18) | **⭐ Primary** |
| 2 | **Subtext**: jargon subtitles in your glasses for your first weeks at work | 5 | 5 | 5 | 4 (≈13) | ⭐ Runner-up (needs a G2 loaner) |
| 3 | **Plus One**: the friend in the group chat who actually books the plan | 5 | 3 | 5 | 4 (≈13) | ⭐ Alt |
| 4 | **Headroom**: a card that knows if your business can afford it before you swipe | 4 | 4 | 3 | 4 (≈13) | ⭐ Alt (best eval story) |
| 5 | **Altostratus**: tells a new hire exactly who to ask and drafts the message | 4 | 3 | 3 | 3 (≈10) | Alt (Workday-only depth) |
| 6 | Price-drop refunder: gets your money back when prices drop after you buy | 5 | 2 | 3 | 3 | Paribus / Capital One Shopping already exist. Fold into Lowball v2. |
| 7 | Bill negotiator: calls Comcast and gets your bill lowered | 5 | 2 | 4 | 3 | Rocket Money / Trim do it. **Fold into Lowball as "Lowball your bills" in the pitch.** |
| 8 | Snap-your-fridge: photo, then meal plan, then groceries ordered | 5 | 2 | 3 | 4 | Crowded. Weak novelty. |
| 9 | AI grandma that wastes scammers' time | 5 | 1 | 5 | 3 | O2's "Daisy" (2024) did it. |
| 10 | Course cutter: cheapest community-college classes that transfer (ASSIST.org) | 4 | 3 | 2 | 2 | Great for UCLA students, but few sponsor fits. |
| 11 | Apartment optimizer (old idea #1) | 4 | 1 | 2 | 3 | Every hackathon has three of these. |
| 12 | Study-video finder (old #5) | 4 | 2 | 2 | 2 | Thin. |
| 13 | Kid accelerator tutor (old #12) | 4 | 2 | 2 | 2 | Interesting market, wrong sponsors. |
| 14 | Duolingo for FL Studio (old #13) | 4 | 3 | 3 | 1 | Nice niche, no tracks. |
| 15 | AI sovereignty company (old #14) | 1 | 4 | 1 | 1 | Fails the 5-second test. |
| 16 | Receipt texter for small businesses (photo to QuickBooks) | 5 | 1 | 3 | 3 | QuickBooks already does this. |
| 17 | Meeting-cost ticker in glasses | 5 | 3 | 4 | 2 | Gimmick. Even forbids financial apps. |
| 18 | Lecture "what did I miss" glasses | 5 | 3 | 4 | 2 | Subtext covers it better. |
| 19 | Agentic farming / hardware ideas | — | — | — | — | No hardware. |

---

## 3. ⭐ PRIMARY: **Lowball**, an AI that haggles for you

### 3.1 The pitch

> **"You set the max. Lowball does the haggling."**
> You tell Lowball what you want ("a Steelcase Leap chair under $300 near UCLA").
> 1. It searches the marketplaces.
> 2. It *looks at the photos* to find leverage ("scuffed armrest").
> 3. It checks real sold prices.
> 4. It texts or calls sellers and negotiates **honestly** (it never invents fake offers).
> 5. It brings you the best deal to approve.
> 6. It pays with a **one-time card locked to that exact seller and price**.

**Why people want it:** most people hate haggling and leave money on the table. Gen Z rarely makes phone calls. The used market is huge (Marketplace, OfferUp, Craigslist, eBay "Make Offer"). The **v2 line in the pitch:** "Same agent, pointed at your Comcast bill, your car dealer, your mechanic quote."

**Why it's novel (and not just "an AI calls a business"):**
1. **Agent-to-agent commerce.**
   - Sellers can run their *own* Lowball seller agent on Agentverse.
   - Two agents negotiate in milliseconds with no human texting.
   - A human-to-agent channel (SMS/voice) is the fallback.
2. **An honest negotiator trained with RL.**
   - We fine-tune a small open model whose reward *penalizes deception*.
   - It's tough on price and never lies. That's our Model Learning, Veri, and Responsible AI story.
   - **What "honest" means (put this in the README, word for word):** no false statements of fact, no made-up competing offers, and it never volunteers the reservation price. *Declining* to reveal the max is allowed. Making offers below the max is allowed. **Stating a false max is not:** "I can do $200" is fine, but "$200 is my max" (when the max is $300) is a lie. The LLM-judge deception rubric encodes this exact line.
3. **Vision-derived leverage.**
   - Step 5 reads listing photos and turns defects into price arguments.
   - "Photo 3 shows a cracked caster. Comparable chairs sold for $220."
4. **Spend-locked agent payments.**
   - The agent never holds your real card.
   - It gets a single-use credential scoped to seller, amount, and expiry.
   - This is Visa's 15% trust criterion, shown concretely.

### 3.2 User flow

```
User (ASI:One chat OR iMessage to Lowball's number OR web Deal Room)
  "Find me a used Leap V2 under $300 near Westwood, pickup this week."
        │
        ▼
[1] INTAKE / ORCHESTRATOR AGENT (Fetch uAgent, ACP)
    - parses the item, max price, walk-away, location, timing
    - confirms with an ASI:One Interactive Card (form: max $, deal-breakers, "may I call sellers?")
        │
        ▼
[2] SCOUT AGENT (CREAO agent using Browser Use, triggered via API)
    - searches Craigslist / OfferUp / eBay / our demo marketplace
    - returns 5–15 candidate listings (title, price, photos, seller contact channel)
        │
        ▼
[3] INSPECTOR AGENT (StepFun step-5-preview vision + Tiger Data comps)
    - per listing: condition score, defects found in the photos, authenticity flags, scam flags
    - fair-price band from the sold-comps time series (Tiger Data continuous aggregate)
    - outputs a "leverage sheet": the facts the negotiator is allowed to use
        │
        ▼
[4] NEGOTIATOR AGENTS (one per seller, run in parallel)
    - model: our Veri-fine-tuned "Lowball-Haggler" (small Qwen/Gemma), served on Veri or Vultr GPU
    - channel adapters:
        • seller has an Agentverse agent  → agent-to-agent negotiation (Fetch)
        • phone number                    → Photon SMS/iMessage text thread
        • "call me"                       → Photon SMS number → SIP → ElevenLabs voice agent
    - opening line always discloses: "Hi! I'm an AI assistant negotiating on behalf of Alex."
    - hard guardrails (code, not prompt): never above the user's max, never invent facts,
      never claim fake competing offers unless they are real, stop if the seller says stop
        │
        ▼
[5] DEAL DESK (human in the loop)
    - ranks the outcomes. Shows each transcript, savings, and the reason it recommends one.
    - user approves via Interactive Card / iMessage "reply YES" / Deal Room button
        │
        ▼
[6] CHECKOUT (Visa)
    - issues a single-use, merchant- and amount-locked credential (Visa sandbox, else test mode)
    - agent completes payment (online listing via Browser Use, or sends a pay link to the seller)
    - Fetch Payment Protocol: Lowball takes 10% of savings (monetization bonus)
        │
        ▼
[7] POST-PURCHASE
    - pickup reminder via iMessage, receipt, and "you saved $X vs. market comps"
      (no lifetime leaderboard: it implies a user base we don't have)
```

### 3.3 Track-by-track fit (what judges will literally see)

| Track | Fit | Exactly what we show |
|---|---|---|
| **Fetch.ai** ($3k) | **Core** | Orchestrator, Negotiator, and Seller agents registered on Agentverse, all with ACP. The whole flow runs inside an ASI:One chat with Interactive Cards (criteria form, listing carousel, deal review card). Payment Protocol takes 10% of savings. Agent-to-agent haggling is native multi-agent. |
| **Agentverse main track** | Core | Same as above. |
| **Model Learning main track** | Core | Self-play RL / RFT negotiator with eval charts. |
| **Veri** ($800) | **Core** | Fine-tune Qwen3.x-1.7B/4B (or Gemma 4 small) on Veri. Publish weights. Show the eval table. |
| **Visa** ($2k) | **Core** | Covers discovery, decision, checkout, and payments. **Trust:** scoped single-use credential, the user approves every purchase, an audit log of what the agent said, scam detection from Inspector. |
| **Photon** | **Core** | Lowball's own phone number. Texts sellers. Voice calls over Photon SMS-number SIP to ElevenLabs. Users can also *drive* Lowball over iMessage. |
| **ElevenLabs** (MLH) | Core | Conversational voice agent that haggles on the phone. Shown in the demo video (too fragile to run live). |
| **StepFun** | **Core** | `step-5-preview` powers the Inspector (image understanding drives the next action). We document every model's role in the README, as they require. |
| **Browser Use** | **Core** | Scout searches the marketplaces. Checkout completes on the web. |
| **CREAO: AI-First Disruptor** ($2k) | Core-ish | The Scout runs as a CREAO agent (CREAO lists Browser Use and API Trigger as building blocks). Remove it and Lowball has nothing to negotiate. README gets the run share link and agent ID. *Alternative:* enter One-Person Company with an "org chart" of Scout → Inspector → Negotiator → Deal Desk. |
| **Tiger Data** (MLH) | Genuine | Hypertable of listing and sold-price observations. Continuous aggregate for `fair_price(item, region, week)`. The live savings dashboard reads from it. |
| **Sentry** | Genuine | **AI agent monitoring** traces every negotiation turn (LLM spans, tool calls, token cost). **Tracing** spans Scout, Inspector, and Negotiator. **Session Replay** on the Deal Room. **Uptime** on the Agentverse endpoint. Diary: "the trace showed the voice turn latency was 3.8s with the frontier model, so we switched the voice path to our fine-tuned 1.7B and got 600ms." That one story links Sentry, Veri, and System-One-style thinking. |
| **Devin** ($5k) | Genuine | Devin builds the self-play environment, the marketplace scraper adapters, and the demo marketplace in parallel. Screenshots of sessions and PRs go in the video. |
| **Paper** ($3k) | Genuine | Design the Deal Room in Paper: brand, a "haggle meter," transcript bubbles, approval card. Hand-crafted character, not AI slop (see §8). |
| **Base44** ($2k) | Optional | Build the **Deal Room** web app in Base44 (live negotiations, approve/reject, savings history). Requirement: "built substantially on Base44." **Tension with Paper**, see §3.7. |
| **Vultr** (MLH) | Light | Host the orchestrator, webhooks, and model server on Vultr. |
| **GoDaddy** (MLH) | Light | Register e.g. `lowball.<GoDaddy-Registry TLD>` through the MLH offer. Check which TLDs qualify. |
| **Gemini** (MLH) | Light / optional | LLM judge for the self-play eval (deception detector), or a Scout fallback. Skip if it muddies the "which model does what" story. |
| **Commit Fellowship** (MLH) | Light | Opt in and fill out the supplemental form. Lowball is a credible startup. |
| **Solana** (MLH) | Skip/stretch | P2P escrow released on pickup is a real problem, but it confuses the Visa story. Only do it if a team member already knows Anchor. |
| **Even Realities** | ✗ Cut | "Lowball Live" price coaching on G2 is cut. Even bans financial apps, and it splits the brand. |
| **Workday / QuickBooks** | ✗ | Don't force these. |

**Count:** Core ≈ 10 (Fetch, Agentverse, Model Learning, Veri, Visa, Photon, ElevenLabs, StepFun, Browser Use, CREAO). Genuine ≈ 4 (Tiger, Sentry, Devin, Paper). Light ≈ 4 (Vultr, GoDaddy, Gemini, Commit). Optional Base44. **About 18 entries.**

### 3.4 Model Learning: the "Honest Haggler"

**Goal:** a small, fast open model that gets *more savings* than the base model, *matches or beats a frontier model*, has a *near-zero deception rate*, and runs at voice-call latency.

**Environment (Devin builds this while we do other things):**
1. **Seller simulator.** An LLM persona with a hidden **reservation price** (sampled at 60–95% of list price). It also has a personality (firm, chatty, impatient, emotional, lowballer-hater) and item facts (true defects, age).
2. **Buyer policy:** the model being trained. It sees the leverage sheet, the user's max price, and the conversation.
3. **Episode:** at most 8 turns. It ends with a deal, a walk-away, or the seller ending it.
4. **Reward:**
   ```
   r = 1[deal] · (list − price) / (list − reserve)        # share of available surplus captured, 0..1
       − 1.0 · 1[price > user_max]                         # hard violation
       − 0.7 · deception_score                             # LLM-judge: claimed false facts / fake offers
       − 0.2 · rudeness_score                              # LLM-judge
       − 0.02 · turns                                      # be efficient
       + 0.1 · 1[deal]                                     # closing bonus
   ```
5. **Training plan, so we don't get stuck:**
   1. **Hour 0–2, data:** run the frontier model (or StepFun) as the buyer in about 2–5k self-play episodes. Keep the top 20% by reward that also have *zero violations*.
   2. **Hour 2–4, SFT / rejection-sampling fine-tune** on Veri (LoRA on Qwen-small). **This is the guaranteed deliverable.**
   3. **Stretch, GRPO:** online RL against the simulator with the reward above, using Veri's GPUs (H100 if available, else L4 with a 1.7B model).
6. **Eval set:** 200 held-out seller personas (different seeds and item categories). Report the table below.
7. **Human eval (the simulator flatters us).** We sample the reserve, write the personas, and score deception with an LLM judge. LLM sellers also cave far more easily than people, so simulated surplus will be inflated. Run **about 20 human-vs-model episodes** with teammates and strangers in line at the venue (roughly an hour of B's time). Report them as their own row, labeled n=20. That's what makes the table defensible.

| Model | Avg surplus captured | Close rate | Deception rate | Over-budget | p50 latency/turn | $ / 1k turns |
|---|---|---|---|---|---|---|
| Base Qwen-small | | | | | | |
| Frontier (prompted) | | | | | | |
| StepFun step-5-preview (prompted) | | | | | | |
| **Lowball-Haggler (ours)** | | | | | | |
| **Lowball-Haggler vs. humans (n≈20)** | | | | | | |

This table goes on a slide and in the Devpost. It also gives the Veri, Model Learning, and Sentry judges something concrete.

### 3.5 Tech stack (one backend laptop, per the team notes)

- **Language:** Python for the agents, uAgents, Veri, and Browser Use. TypeScript only for the frontend (Base44, or Next.js if we skip Base44).
- **Fetch:** `uagents` plus the Chat Protocol. Orchestrator, Negotiator, and demo Seller agents. Agentverse mailbox. Interactive Cards for the criteria, listings, and deal review.
- **CREAO:** Scout agent on agent.creao.ai, called through its API Trigger from the orchestrator.
- **Browser Use:** cloud API / SDK for marketplace search and checkout pages.
- **StepFun:** `step-5-preview` for Inspector vision plus leverage extraction.
- **Veri:** fine-tune and serve the haggler. Fallback: export LoRA weights and serve with vLLM on a Vultr GPU.
- **Photon 2.0 beta:** the Lowball number. SMS and iMessage channels. Voice profile on the SMS number, SIP to ElevenLabs.
- **ElevenLabs:** Conversational AI agent whose "brain" calls our negotiator endpoint (custom LLM / tool webhook).
- **Tiger Data:** `observations(ts, item_key, region, price, sold bool, source)` hypertable plus a continuous aggregate.
- **Visa:** check the Visa booth and the Visa Developer sandbox for agentic-commerce / tokenization APIs (Visa Intelligent Commerce or Trusted Agent Protocol, if exposed to hackers). **Fallback:** Stripe test mode with Visa test cards and single-use virtual-card semantics we implement (amount cap plus merchant lock plus expiry), clearly labeled "sandbox."
- **Sentry:** Python SDK (tracing plus AI-agent monitoring) and a JS SDK on the Deal Room (Replay). Uptime monitor on the public endpoint.
- **Hosting:** Vultr VM (backend plus webhooks). Domain from GoDaddy.

### 3.6 The demo marketplace (de-risking + ethics)

Real sellers on Craigslist or Marketplace **should not** get automated texts or calls from a hackathon bot. That's consent, TCPA, and platform-ToS risk, and the Workday and Visa judges will ask about it. So:

- **Build "Bruin Bazaar,"** a tiny fake marketplace site we control (Devin can build it in an hour). It has 10–15 real-looking listings, photos with real defects (take them on campus!), and seller phone numbers that are **ours, our friends', or the judges' (with consent)**.
- **Browser Use searches Bruin Bazaar live.** We also show a read-only search on a real site (Craigslist) to prove it generalizes, but **never contact real sellers.**
- **Fair price comes from real data, not from us.** Pull **eBay sold listings** (read-only, low volume) into Tiger Data as the comps. The hero metric is **price vs. market comps**, never "vs. list price," because we write the list prices on Bruin Bazaar. Cache comps for the demo items in case eBay blocks the scraper.
- **Show Lowball walking away from at least one listing.** A bot that sometimes fails is the only kind that looks real.
- **Product answer to "isn't this spammy?":**
  - Lowball always discloses that it's AI.
  - It only contacts sellers through the platform's messaging or sellers who opted in.
  - The scalable path is **sellers running their own agent** (agent-to-agent), which is exactly the Fetch vision.

### 3.7 Base44 vs Paper vs custom frontend: decide in hour 1

- **Option A (max tracks):**
  - Design in Paper first (brand plus three screens).
  - Then build the Deal Room in **Base44**, prompting it with the Paper-exported HTML/CSS.
  - Base44 talks to our backend over HTTP.
  - We enter both. Risk: the Base44 output looks generic. Fight that with a strict design spec.
- **Option B (max polish):**
  - Paper to code (Next.js/Vite) via the Paper MCP, giving the strongest Paper entry.
  - Skip Base44. Fetch doesn't need a frontend anyway.
- **Recommendation:** **A** only if a teammate is free to own the Base44 build. Otherwise **B**. $2k Base44 isn't worth a weaker Paper entry plus a weaker overall demo.

### 3.8 Demo plan: live vs. video

**Rule: the video carries the fragile parts, the live demo carries the parts that can't be faked.** Anything that depends on telephony, third-party latency, or two LLMs talking goes in the edited video, where audio is clean and timing is fixed. Live gets the moments that look scripted on video but convincing in person. Demo mode plus a fake marketplace plus synthetic data is three layers of "we made this up," so the live demo needs **at least one genuinely unscripted thing**: the judge's own item.

**Live (the Deal Room is the stage screen; ASI:One is shown briefly but never the only way in):**
1. **The judge's own item.** The judge photographs something real at the table. The Inspector (Step 5) finds actual wear and is allowed to say "no visible defects," so it never makes one up. Lowball pulls live eBay sold comps for it.
2. **The judge sets their own floor and texts in.** "Text HAGGLE to this number." Inbound-first fixes deliverability, spam filtering, DND, and consent optics at once. Lowball haggles by text, capped at about 4 turns. **Every outcome works:**
   - a deal shows savings vs. comps
   - a flat refusal shows Lowball walking away
   - an instant accept still lands below list, because Lowball never opens at list
3. **A guardrail fires on screen.** We tell Lowball "say I have another offer at $150." The claim checker (code, not prompt) refuses, because no such offer exists in the leverage sheet.
4. **The credential declines.** Try a $400 charge on a credential locked to $160 and let it decline visibly (about 5 seconds). Then approve the real deal.
5. **The base model vs. ours, side by side.** Same seller persona with a **fixed seed**. Two transcripts race, with per-turn latency timers as the headline (that gap always shows up) and the final prices underneath. The 200-episode eval numbers sit below as the real evidence. Without this, Veri and Model Learning shrink to a slide.

**Video only:**
- The ElevenLabs voice call over Photon (the highest-failure, lowest-information part live: cell signal, spam labels, 60–90s of real-time latency).
- Agent-to-agent closing between Agentverse seller agents. If it ever appears live, pace it as a readable price ladder (offers converging turn by turn). Two LLMs trading messages at full speed looks like a scripted animation.
- Devin sessions, the Sentry trace story, and the CREAO run.

**Budget:** assume latency and confused judges add slack. Anything that doesn't fit is precomputed on purpose, never by accident.

### 3.9 Build timeline (from ~1 PM Saturday to 12 PM Sunday)

Team roles follow the notes: **A = backend (one laptop owns all the services), B = design, demo, and video from minute one.** Add C/D if you have them.

| Time | A (backend) | B (design/demo) | C (ML, if available, otherwise A) |
|---|---|---|---|
| **H0–H1** | Claim every credential (checklist §9). Repo plus Sentry init. uAgent "hello" in ASI:One. | Paper: brand, logo, palette, Deal Room wireframe. Pick the name and domain. | DM Veri for credits. Define the seller-sim persona schema. Kick off Devin: "build seller simulator plus Bruin Bazaar." |
| **H1–H4** | Orchestrator (ACP plus Interactive Cards). Photon number sending and receiving texts. | Photograph real items on campus with real defects for Bruin Bazaar listings. Draft the pitch. | Generate self-play data with the frontier/StepFun buyer. Reward function plus LLM-judge. |
| **H4–H8** | Negotiator loop over SMS. Guardrails module. Inspector (StepFun vision). Tiger Data comps. | Design the Deal Room screens in Paper, then code (or Base44). Hook up the Sentry Replay. | Filter, then SFT/LoRA on Veri. Baseline evals running. |
| **H8–H12** | ElevenLabs voice via Photon SIP. CREAO Scout with Browser Use. Agent-to-agent seller agents. | Deal Room live from backend events (WebSocket/SSE). Savings meter animation. | Serve the fine-tuned model. Plug it into the negotiator. Eval table v1. GRPO stretch kicks off. |
| **H12–H15 (sleep in shifts)** | Visa checkout (sandbox or fallback). Payment Protocol. | 2-hour nap. | 2-hour nap. GRPO runs overnight. |
| **H15–H19** | End-to-end runs × 20. Fix what Sentry shows. Uptime monitors. | Record the demo video (2–3 min). Through-the-screen captures. | Final eval table. Push weights. README model card. |
| **H19–H22** | Freeze features. README, CREAO run link plus agent ID, Fetch Submission Agent. | Devpost write-up per track (§9). Slides. | Help with QA. |
| **H22–H23** | **Submit by 11:30 AM.** Rehearse the live demo three times with a stranger playing the seller. | | |

**Already cut:** live voice (video only), live agent-to-agent (video or price ladder), the leaderboard, and Lowball Live on G2. **These cuts pay for the new work:** eBay comps, the credential decline, the claim-checker guardrail, the side-by-side race UI, and the human evals.

**Cut order if behind:** GRPO, then Base44, then the CREAO Scout (use Browser Use directly), then voice in the video, then live eBay scraping (use cached comps). **Never cut:** the judge photographs their own item and texts in, the honesty definition plus the visible guardrail refusal, the credential decline, the base-vs-ours race, the eval table with the human row, and Paper-quality UI.

---

## 4. ⭐ RUNNER-UP: **Subtext**, jargon subtitles for your first weeks at work (Even G2)

### 4.1 Pitch

> **"Your first week at a new job, everyone talks in acronyms. Subtext quietly shows you what they mean, in your glasses, only when you don't know."**

- **5-second test:** "Subtitles for corporate jargon, in your glasses." ✔
- **Quiet Tech fit (Even's whole theme):**
  - The display stays **blank** almost all the time.
  - When someone says "Let's sync on the Q3 OKRs before the PRD review with GTM," a single faint line appears for about 4 seconds: `OKR · quarterly goals` → `GTM · go-to-market (sales+marketing)`.
  - Then it disappears. You keep eye contact and stay in the conversation.

### 4.2 Why it wins

- **Even Realities ($3.8k, the biggest single cash-equivalent prize).** It's a new moment ("first-week meetings"), quiet by design, and a judge can wear it right away.
- **Workday ($2k).** A literal match for ramping into a new role and finding trusted information. Strong responsible-AI story:
  - No audio is stored.
  - No names or faces.
  - It only defines terms.
  - The new hire controls it.
  - Managers see only *aggregate, opt-in* "top confusing terms" to fix the onboarding docs.
- **Veri / Model Learning.** Fine-tune a small model for *"is this term jargon this user doesn't know?"* (token classification plus personalization). It learns from your "I know this" taps, so it **adapts**. Latency matters on glasses: small model, fast.
- **Beyond the Digital.** AR glasses are explicitly listed.
- **The demo is perfect.** A judge puts on the G2. A teammate role-plays an overly-jargony manager. The definitions float in. Then the teammate switches to normal speech and the display goes silent. **The silence is the feature.**

### 4.3 Architecture

```
G2 mic → Even Hub app (phone) ──audio──► streaming STT (ElevenLabs Scribe realtime)
                                             │ text stream
                                             ▼
                              Jargon spotter (Veri fine-tuned small model)
                              - span detection + "unknown-to-this-user" score
                              - user knowledge profile (taps: "I know this" / "explain more")
                                             │ candidate terms
                                             ▼
                      Company glossary RAG (onboarding docs; synthetic "Acme Corp")
                      + StepFun step-5-preview for a ≤6-word definition when not in glossary
                                             │
                                             ▼
                     Display policy (Quiet rules): max 1 line, ≤4s, no repeats,
                     cooldown 20s, suppress while the wearer is speaking
                                             │
                                             ▼
                                       G2 HUD line
```

**Companion surfaces:**
- **"Pre-brief" agent on ASI:One (Fetch).** Paste tomorrow's meeting agenda. It pre-loads the terms you'll likely hear and gives a 30-second primer. After the meeting it gives "5 terms you saw today" as spaced-repetition cards.
- **Admin web app (Base44 or Paper-designed).** HR uploads onboarding docs to build the glossary. The opt-in aggregate heatmap shows confusing terms.
- **Sentry:** latency traces (speech → HUD p95 is *the* metric), logs, replay on the web app.

### 4.4 Tracks

**Core:** Even, Workday, Veri, Model Learning, Beyond the Digital.
**Genuine:** StepFun, ElevenLabs (Scribe STT), Sentry (latency tracing is the main metric), Paper, Devin.
**Light/optional:** Fetch (Pre-brief agent), Base44 (admin app), CREAO (Team Empowerment: the glossary agent "connects new hires to team knowledge"), Tiger Data (term-frequency time series), Vultr, GoDaddy, Commit.

**About 13–17 entries.**

### 4.5 Model Learning detail

- **Data:**
  - Synthetic meeting transcripts in 6 industries (tech, finance-ops, healthcare admin, consulting, retail, gov). Generate them with a frontier LLM and label jargon spans.
  - Plus public glossaries (Wikipedia lists of business, tech, and industry acronyms).
  - Hold out one industry as a zero-shot test.
- **Model:** a small open LM (or ModernBERT-style encoder if Veri supports it) with LoRA, doing span tagging plus a "difficulty" score.
- **Personalization:** a per-user logistic layer on top. Features are the model's term embedding and the user's tap history. It updates online.
- **Eval:**
  - Precision and recall of the terms shown versus gold labels.
  - **"Interruptions per minute"** (lower is better: quiet!).
  - Latency.
  - Compare against prompting a frontier LLM on every utterance (slower, more expensive, noisier).

### 4.6 Risks

- **The Even Hub SDK is unfamiliar.** Read the starter pack at https://evenrealities-lahacks.vercel.app/starterpack in **hour 0** and get "hello world" on the simulator before committing.
- **Loaner availability.** Go to the Even table *immediately*.
- **Venue noise breaks STT.** Use the G2 mic if the SDK exposes it, with the phone mic as fallback. Demo in a quieter corner.
- **The team said "no hardware."** No hardware is *built*. It's a software app on a lent device. The video can use the simulator.
- **Demo problems (from the critique):**
  - Only the wearer sees anything, and mirroring the display to a screen undercuts the "quiet" pitch. This matters less if Even judges try it on one at a time.
  - **Success and failure look the same**: a blank display could mean "you knew that word" or "speech-to-text failed." Add a small "heard it, skipped it" indicator.
  - Fitting the glasses costs 30–60 seconds per judge, and prescription wearers may not be able to wear them.
  - A teammate reciting jargon reads as theatre. Have the judge read a card or play a recorded clip instead.

---

## 5. ⭐ ALT: **Plus One**, the friend in your group chat who actually makes plans happen

### 5.1 Pitch

> **"Add Plus One to your group chat. Say 'we should get dinner Friday.' It polls everyone, books the table, and splits the bill."**

- **Who it's for:** every friend group where "we should hang out!!" dies in the chat.
- **5-second test:** ✔

### 5.2 Flow

1. **Photon iMessage/SMS group.** It listens only when @mentioned or when it detects plan intent.
2. **Poll.** It sends a native poll with times, then nudges people who haven't answered.
3. **Find options.** Browser Use searches Resy, OpenTable, and Eventbrite, filtered by group constraints it learned from the chat (vegetarian, budget, "no more than 20 min from Westwood").
4. **Book.** Browser Use books. If there's no online booking, an ElevenLabs voice agent *calls the restaurant* through Photon voice.
5. **Pay and split.**
   - One person approves the deposit with a Visa scoped credential.
   - Plus One sends everyone their share and tracks who paid.
6. **Reminders** on the day, plus "running 10 late?" coordination.

### 5.3 Tracks

**Core:** Photon, CREAO **Team Empowerment** (literally "agents as connective tissue between people… without replacing anyone"), Fetch (Plus One on ASI:One plus per-person preference agents negotiating times = multi-agent), Browser Use, Visa (group checkout and split pay).
**Genuine:** ElevenLabs (restaurant call), StepFun (reads screenshots people drop in the chat, like a flyer or a menu), Sentry, Devin, Paper.
**Light:** Base44 (event page), Tiger Data, Vultr, GoDaddy, Gemini, Commit.
**Model Learning (optional):** fine-tune a small "should I speak now?" classifier on Veri, trained on synthetic group chats. When to stay quiet is the hard problem for group-chat agents.

**About 15 entries.**

### 5.4 Demo

Judges scan a QR code that adds them to a live iMessage group with Plus One. Someone types "dinner tmrw?" and the judges vote on their own phones. **Weakness:** group-chat agents are becoming common at hackathons, so novelty is only medium. The "should I speak" model and the voice booking are the differentiators.

**Risks:**
- It depends on people more than any other option. It needs 3+ strangers to join with real numbers and answer a poll live, and one non-responder stalls the demo.
- **Never call a real restaurant.** That ties up a real business's phone line and may book a table nobody shows up for. A teammate or our second number plays the restaurant.

---

## 6. ⭐ ALT: **Headroom**, a card that knows if your business can afford it before you swipe

### 6.1 Pitch

> **"Before an employee's card purchase goes through, Headroom checks the company's books in 100 milliseconds. 'This $4,200 laptop drops you below payroll on Nov 1. Approve anyway?'"**

- **5-second test:** "A company card that knows if you can afford it." ✔ (a little more B2B)

### 6.2 Why it's a genuine System-One unlock (QuickBooks)

- Card authorization windows are about **100ms–1s**. A frontier-LLM cash-flow analysis takes **5–30s** and costs cents per call. That's impossible at authorization time.
- A **small specialized model** (fine-tuned on Veri) and a fast cash-flow forecaster over QuickBooks data can do it *inside the auth window*. That unlocks a new class of experience: **real-time financial guardrails at the point of sale.** That's exactly the QuickBooks brief: "dramatically faster inference makes real-time analysis possible."

### 6.3 Flow

1. **Ingest** the QuickBooks HF synthetic dataset (multiple companies) into Tiger Data: transactions, invoices, AP/AR, payroll. Disclose any modifications, as the challenge requires.
2. **Forecast.** A 30/60/90-day cash forecast is computed continuously. Continuous aggregates keep it fresh.
3. **Authorize** (simulated Visa auth webhook). The small model classifies the purchase into categories, checks it against the forecast, budgets, vendor history, and duplicate detection, and returns approve, soft-flag, or hold, with a one-sentence reason.
4. **Escalate.** Holds and soft-flags text the owner through Photon: "Reply YES to approve." This is the human-in-the-loop moment.
5. **Agent chat.** The owner asks ASI:One "can I afford to hire someone in December?" and gets a scenario forecast (Fetch).

### 6.4 Tracks

**Core:** Visa (payments, trust), QuickBooks, Veri, Model Learning, Tiger Data (time-series is the core).
**Genuine:** Photon, Fetch, Sentry (**tracing proves the latency claim** in the eval), StepFun (reads receipt photos for policy checks), Snowflake (alternate data warehouse, pick one of Snowflake or Tiger), Devin, Paper.
**Light:** CREAO, Vultr, GoDaddy, Commit.

**About 14 entries.**

### 6.5 Eval (QuickBooks requires this)

- **Labeled purchases.** Inject 1,000 purchase events into the synthetic company timelines. Label them good, risky, or duplicate/fraudulent from future cash outcomes.
- **Compare:**
  - Rules engine (classical)
  - XGBoost on handcrafted features (classical ML)
  - Frontier LLM with full context (conventional GenAI)
  - **Ours**
- **Metrics:** decision accuracy / F1, **p99 latency**, $ per 1k decisions, and how many would have caused an overdraft.

### 6.6 Weakness

- The demo is less visceral, since judges don't get to be part of it the same way. **Better fix: demo the latency, not the decision.** Run the two paths side by side with visible timers: a frontier LLM with full context vs. our small model, same purchase. That's a five-second visual that proves the whole System One thesis. A hold text buzzing one phone doesn't.
- The QuickBooks prizes are small (gift cards).

---

## 7. ALT: **Altostratus**, new-hire "who do I ask?" agent (Workday-focused)

**Pitch:** "New at work and stuck? Tell Altostratus your problem. It finds the right person, checks if they're free, and drafts the perfect ask. You hit send."

**Flow:**
1. **Synthetic "Acme Corp"** with ~200 employees (using Workday's suggested fields: department, job title, skills, mentor profiles, open projects, onboarding tasks).
2. **Ranking.** The agent ranks helpers by skill match, availability, and *load-balancing*, so it doesn't send every new hire to the same senior engineer. That's the fairness point.
3. **Explain.** It explains why: "Priya owns the billing service and mentored two new grads last quarter. Free Thu 2pm."
4. **Draft.** It drafts the message with context and what you already tried. **The human always sends it.**
5. **Weekly ramp plan.** Skills gaps lead to internal learning and stretch projects (career pathing).

**Tracks:** Workday (core), Fetch, CREAO Team Empowerment, Photon (delivers drafts over iMessage), Veri (fine-tune the ranker or drafter), Sentry, Devin, Paper, Base44. **About 10.**

**Why it's not first:** it's solid but familiar ("enterprise RAG plus people search"). It shows less originality, and there's no Visa or Even money.

---

## 8. Cross-cutting playbook (applies to whichever idea we pick)

### 8.1 Design (Paper track, and polish for every judge)
- **Hour 0:** in Paper, generate three style directions. Pick one *with character*.
  - For Lowball: a bold, scrappy "flea-market" brand. Warm off-white paper texture, one loud accent color (safety orange), a chunky grotesk for numbers, handwritten-style annotations on deal cards.
  - Avoid the default AI look (purple gradients, glassmorphism, generic Inter-on-white cards).
- **Hierarchy:** the single most important number on the screen is **$ saved**. Make it huge.
- **Consistency:** one radius, one shadow, an 8-pt spacing grid, two type weights.
- **Paper judges want personal craft.** Hand-draw the logo or mascot, then vectorize it.

### 8.2 Sentry diary (start at hour 0)
Keep `SENTRY_LOG.md`. Each entry gets a screenshot plus "what we saw, what we changed." Aim for 5–8 real entries. Examples:
- A slow span in a trace
- A replay of a confused click
- A log that pinpointed an Agentverse mailbox drop
- An uptime alert at 3am

This *is* the Sentry submission.

### 8.3 Devin usage (make it visible)
- Give Devin well-scoped, parallel tasks: the seller simulator, Bruin Bazaar, marketplace adapters, the eval harness, and the README.
- Keep a `DEVIN.md` with session links, and screenshot one PR it opened.
- Cognition judges on creativity, novelty, and polish, so the *product* still has to be great.

### 8.4 Agent architecture hygiene (the "3–5 agents" note)
- **Three to five agents, each with one job,** and a visible org chart. This helps CREAO One-Person Company, Fetch multi-agent, and Workday "agentic logic."
- **Deterministic guardrails in code** (budget caps, consent, disclosure), **never only in prompts.** Say this out loud to judges.
- **Retry and recovery on every tool call.** Fetch awards bonus points for error handling.

### 8.5 "Which model does what" (StepFun requires this; it also helps every judge)
For Lowball:
- **step-5-preview:** vision inspection, leverage extraction, deal summaries.
- **Lowball-Haggler** (our Veri fine-tune): live negotiation turns, on text and voice.
- **ElevenLabs:** speech in and out on calls.
- **Frontier or Gemini model:** offline only, as the self-play teacher and LLM judge for evals.

### 8.6 Responsible AI checklist (Visa 15%, Workday 20%, plus everyone asks)
- [ ] Discloses that it's AI in the first message to any human
- [ ] Explicit user consent before contacting anyone
- [ ] Hard caps in code, with the human approving every payment or send
- [ ] Shows reasoning: "why this deal," plus full transcripts
- [ ] Deception penalty in training, plus a deception-rate metric
- [ ] Written definition of "honest" in the README (§3.1: no false facts, no made-up offers, never volunteer the reservation price, never state a false max)
- [ ] **Every guardrail fires visibly at least once in the demo.** A constraint that never triggers is just a slide.
- [ ] Inbound-first contact: people text Lowball before it texts them
- [ ] Minimal data: no storing seller numbers after the deal, synthetic data in the demo
- [ ] States what it *won't* do (lie, exceed the budget, contact people who said stop)
- [ ] Handles uncertainty: if the Inspector isn't sure about condition, it asks the user instead of guessing

---

## 9. Submission checklist

### Pre-flight credentials (do these in the first hour, in parallel)
- [ ] **Veri:** DM @daniung on Discord for credits. Redeem at veri.studio/settings/billing **before** the first job. Install the SKILL.md into `.claude/skills/veri/`.
- [ ] **CREAO:** sign up via the hackathon link (upgraded account).
- [ ] **Paper:** download the desktop app, redeem `LAHACKS26`, connect the MCP, invite teammates. Note the cancel-by date.
- [ ] **Photon:** photon.co/beta, then create a project, iMessage line, and SMS number with a voice profile.
- [ ] **Fetch:** Agentverse account. Read the hackpack and the Submission Agent doc.
- [ ] **StepFun:** API key for `step-5-preview`.
- [ ] **ElevenLabs, Sentry, Tiger Data, Vultr, Browser Use, Devin:** accounts and credits.
- [ ] **GoDaddy Registry** domain through the MLH offer.
- [ ] **Visa:** visit the booth and ask which sandbox / agentic-payments API they want used.
- [ ] **Even** (only if Subtext): grab a loaner G2 and get simulator hello-world working.

### Devpost (due 12:00 PM Sunday; submit by 11:30)
- [ ] Project description: problem, user, solution, **main track(s)**, and **one paragraph per company challenge** explaining the fit (the rules require this).
- [ ] Public GitHub repo with a solid README, setup steps, and architecture diagram.
- [ ] 2–3 min demo video.
- [ ] Select every challenge we genuinely fit.
- [ ] **Fetch:** agent addresses, ASI:One chat share links, and submission through the **Submission Agent**.
- [ ] **CREAO:** agent run share link plus agent ID in the README. The agent is shown in the video.
- [ ] **Base44** (if entered): live app URL plus a "what we learned or changed" section.
- [ ] **Veri:** model card, weights link, and eval table.
- [ ] **Sentry:** link to `SENTRY_LOG.md` with screenshots.
- [ ] **StepFun:** a "which model does what" section.
- [ ] **Even** (if entered): Even Hub beta build uploaded, app name ≤20 chars without "Even", install README.
- [ ] **QuickBooks** (if entered): eval methodology plus a disclosure of dataset modifications.
- [ ] **MLH Commit Fellowship:** opt in plus the supplemental form.
- [ ] Be **physically present** at judging.

---

## 10. Final recommendation

1. **Build Lowball.**
   - It has the widest genuine track coverage (about 18).
   - It passes the 5-second test best ("an AI that haggles for you").
   - It has the most memorable judge-participation demo (the judge photographs their own item, sets their own floor, and an AI haggles with them by text).
   - It has a real Model Learning story (an honest negotiator trained with RL, with an eval table).
2. **If someone on the team is excited about the glasses and the Even table has loaners, consider Subtext instead.** It goes after fewer but bigger and less-crowded prizes (Even $3.8k plus Workday $2k), and its demo is just as strong.
3. **Don't try both.** If Lowball is on track by H12, a 2-hour "Lowball Live" G2 stretch is the only cross-over worth trying. Check with Even first that it isn't treated as a "financial" app.

**Name ideas:**
- Lowball (#1). **Known cost:** a "lowballer" is the villain of marketplace culture, so the name advertises the behavior the Responsible AI story disclaims. We keep it for the 5-second clarity and the humor, and own the joke: "Lowball, but it never lies." If a clearly better name turns up within 10 minutes, switch. "Talk Me Down" is the strongest alternative.
- Haggle
- Dealbreaker
- Talk Me Down
- Subtext (for the glasses idea)
- Plus One

From the old name list, only "Avalon" or "Ridgecrest" would work as a company or brand umbrella. Product names should *say what they do*.
