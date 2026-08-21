"""A minimal Deep Agent, built from the LangChain Deep Agents quickstart.

This is a standalone experiment. It is deliberately not wired into the AIC
document platform: it has no access to Supabase, to the documents bucket, or to
anything behind row level security. It researches public web pages and prints
what it found.

What `create_deep_agent` adds over a plain tool loop is the harness — a planning
tool (`write_todos`), a virtual filesystem the agent can write notes into, and
the ability to spawn subagents. None of that is configured here; the point of
the quickstart is that you get it without asking.

Run:
    ./.venv/bin/python research_agent.py "What is LangGraph?"
"""

from __future__ import annotations

import os
import sys

from deepagents import create_deep_agent
from dotenv import load_dotenv

load_dotenv()

# provider:model — Deep Agents resolves this through LangChain's init_chat_model,
# so switching vendors is this one string plus that vendor's package and key.
MODEL = os.getenv("DEEP_AGENT_MODEL", "anthropic:claude-sonnet-5")

# Anthropic's server-side web search, rather than a separate search vendor:
# the search runs inside the model call, so there is no second API key and no
# second company holding the query log. `web_search_20260318` is also available
# in the installed SDK if you want the newer tool revision.
WEB_SEARCH_TOOL = {
    "type": "web_search_20260209",
    "name": "web_search",
    "max_uses": 5,
}

RESEARCH_PROMPT = """You are a research assistant.

Use web search to answer the question. Search more than once when the first \
results are thin or disagree — a single search is rarely enough for a question \
worth asking.

Report what you found in prose, and name your sources with their URLs. When the \
sources disagree, say so and give both readings rather than silently picking one. \
When you could not find something, say that too: "I could not find a figure for \
X" is a useful answer, an invented figure is not."""


def build_agent():
    """Build the agent without invoking it, so wiring can be tested offline."""
    return create_deep_agent(
        model=MODEL,
        tools=[WEB_SEARCH_TOOL],
        system_prompt=RESEARCH_PROMPT,
    )


def main() -> int:
    question = " ".join(sys.argv[1:]).strip() or "What is LangGraph?"

    if not os.getenv("ANTHROPIC_API_KEY"):
        print(
            "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and put a key "
            "in it, or export the variable, then run this again.",
            file=sys.stderr,
        )
        return 1

    agent = build_agent()

    print(f"Model:    {MODEL}")
    print(f"Question: {question}\n")

    result = agent.invoke({"messages": [{"role": "user", "content": question}]})

    print(result["messages"][-1].content)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
