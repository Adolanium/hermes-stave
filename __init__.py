"""Stave: describe a piece of music and Hermes writes it as sheet music.

The Desktop page (desktop/plugin.js) is where people read, play and change a piece. This package
gives the agent the same craft from any chat:

- the ``stave:compose`` skill: Stave's notation rules and how to write a good short piece;
- ``stave_check``: the page's bar-length, range and syntax checks, so the agent fixes its own bars;
- ``stave_open``: puts a checked piece on the Stave page (refused while it has problems);
- the ``stave`` auxiliary task: which model the page uses to compose and revise, picked in Settings.
"""

from pathlib import Path

_SKILL = Path(__file__).resolve().parent / "skills" / "compose" / "SKILL.md"


def register(ctx):
    from .tools import register_tools

    register_tools(ctx)
    ctx.register_skill(
        "compose",
        _SKILL,
        description="Write a short piece of music as Stave ABC: plan the form, write bars that add up, "
                    "check them with stave_check, and open the piece on the Stave page with stave_open.",
    )
    # Reasoning off by default: measured on a reasoning model, an 8-bar section took 2-8 s instead of
    # 21-29 s, and the page's checker repairs the occasional bar that does not add up. Set
    # auxiliary.stave.reasoning_effort to turn thinking back on.
    ctx.register_auxiliary_task(
        "stave",
        display_name="Stave composer",
        description="Writes and revises the music on the Stave page. Reasoning is off by default so "
                    "pieces and edits arrive in seconds; turn it on for more considered music.",
        defaults={"reasoning_effort": "none"},
    )
