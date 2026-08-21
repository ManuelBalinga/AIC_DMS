# Deep Agents experiment

A minimal research agent built from LangChain's Deep Agents quickstart, using the
`deepagents-python-quickstart` skill.

**This is an experiment, not part of the platform.** It is Python; the platform is
TypeScript. It has no Supabase client, no access to the documents bucket, and no
route into anything behind row level security. Nothing in `src/` imports it, and
nothing here is on the path to the three-week beta. It exists so the Deep Agents
harness can be evaluated against something real before deciding whether any of it
belongs near AIC documents.

## What it is

`research_agent.py` builds a research agent with `create_deep_agent` and gives it
one tool: Anthropic's server-side web search. Provider-native search rather than
Tavily means no second vendor and no second API key — the search happens inside
the model call.

The harness supplies the rest without configuration. Verified present on the built
graph: `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `delete`,
`execute`, and `task` for spawning subagents. That is the actual argument for Deep
Agents over a hand-written tool loop — you configure the harness rather than
implement it.

## Running it

```bash
cp .env.example .env      # then put a real ANTHROPIC_API_KEY in it
uv venv --python 3.11
uv pip install -r requirements.txt
./.venv/bin/python research_agent.py "What is LangGraph?"
```

## Status

**Built and verified as far as it can be here; never actually run.** The agent
constructs (`CompiledStateGraph`, all harness tools registered) and the no-key path
exits cleanly with a message. It has not answered a single question, because no
`ANTHROPIC_API_KEY` exists in this environment — the same reason the platform's own
Ask page is keyless. Whether the research loop is any good is untested.

## Versions

Installed and verified 21 August 2026: `deepagents` 0.7.8, `langchain` 1.3.16,
`langchain-core` 1.6.0, `langgraph` 1.2.11, `langchain-anthropic` 1.6.1,
`anthropic` 0.125.0.

## Why the API shape came from the skills repo

`docs.langchain.com` is blocked by this environment's egress proxy, so the live
quickstart page could not be fetched. The API shape here came from the
`deep-agents-core` and `langchain-dependencies` skills in
`langchain-ai/langchain-skills`, then checked against the installed package's own
`create_deep_agent` signature rather than taken on trust.
