# Altostratus agent (ASI:One)

Altostratus helps a new hire find the right colleague to ask. Describe what you are stuck on and the agent:

1. reads the problem (services, skills, company jargon, sensitive details to keep out) and checks whether a runbook already answers it,
2. ranks who to ask by ownership, history, skills, current ask load and calendar availability, with a reason per person and the fairness rules that fired,
3. drafts the message for the person you pick (short, full context, or a call request),
4. records it when you say you sent it. The agent never sends anything to anyone; you send it yourself.

Example: "The till double charged a shipper after the WH secret rotated yesterday. Who can help?"

Data: a synthetic company (Ferndale Systems). Results are demo mode results from the Altostratus web app.

## Run it

```
cd agents/fetch
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
cp .env.example .env    # AGENT_SEED, ALTOSTRATUS_BASE_URL, AGENT_API_TOKEN
.venv/bin/python agent.py
```

On first start the log prints an Agent Inspector link: open it and choose **Connect > Mailbox** to register the agent on Agentverse. Then find it in ASI:One by name or address.

`.venv/bin/python test_flow.py` plays the whole chat workflow against the app without Agentverse.

## Files

- `agent.py`: the uAgent, Agent Chat Protocol 0.3.0, mailbox, manifest published.
- `conversation.py`: the workflow, the Interactive Cards (review, detail, carousel) and recovery by error code.
- `altostratus_client.py`: calls into the app's API with 3 attempts and backoff on network errors, 429 and 5xx.
