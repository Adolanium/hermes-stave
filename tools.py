"""Agent tools: check a piece, and open it on the Stave page.

``stave_open`` refuses a piece with problems and returns them, so the agent fixes its own music
before anything reaches the page. A clean piece is written to the plugin's inbox, which the Desktop
page reads through the dashboard route in dashboard/plugin_api.py.
"""

from __future__ import annotations

import json
import time
import uuid

from .abc_check import FRETTED, INSTRUMENTS, check_piece, clef_for, fold_into_range
from .inbox import Inbox

TOOLSET = "stave"

_PIECE_PROPS = {
    "title": {"type": "string", "description": "2 to 4 word title."},
    "mood": {"type": "string", "description": "A few words, e.g. 'gentle, sleepy'."},
    "key": {"type": "string", "description": "C, G, D, A, F, Bb, Eb, Am, Em, Bm, F#m, Dm, Gm, Cm."},
    "meter": {"type": "string", "enum": ["4/4", "3/4", "6/8", "2/4"]},
    "tempo": {"type": "integer", "description": "Quarter notes per minute (dotted quarters for 6/8), 40-200."},
    "voices": {
        "type": "array",
        "description": "1 to 3 parts; the first is the melody. Ids are V1, V2, V3 in order. Guitars use the treble "
                       "clef and bass guitar the bass clef, written an octave above how they sound; the page adds TAB.",
        "items": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "enum": ["V1", "V2", "V3"]},
                "name": {"type": "string"},
                "instrument": {"type": "string", "enum": sorted(INSTRUMENTS)},
                "clef": {"type": "string", "enum": ["treble", "bass"]},
            },
            "required": ["id", "instrument", "clef"],
        },
    },
    "sections": {
        "type": "array",
        "description": "The form, in order of first appearance: id (A, B...) and a 1-2 word name.",
        "items": {"type": "object", "properties": {"id": {"type": "string"}, "name": {"type": "string"}}, "required": ["id"]},
    },
    "bars": {
        "type": "array",
        "description": "Every bar in order. 'section' is the section id; each voice id maps to that bar's ABC "
                       "(L:1/8, no bar lines), e.g. {\"section\": \"A\", \"V1\": \"\\\"C\\\"E2 G2 c2 G2\", \"V2\": \"C,4 G,,4\"}.",
        "items": {"type": "object", "properties": {"section": {"type": "string"}}, "required": ["section"]},
    },
}

CHECK_SCHEMA = {
    "name": "stave_check",
    "description": "Check a Stave piece before opening it: every bar of every voice must add up to the meter, "
                   "notes must sit in the instrument's range, and the ABC must be readable. Returns the problems by "
                   "bar and voice, or ok. Load the stave:compose skill first for the notation rules.",
    "parameters": {"type": "object", "properties": _PIECE_PROPS, "required": ["meter", "voices", "bars"]},
}

OPEN_SCHEMA = {
    "name": "stave_open",
    "description": "Open a finished piece of music on the Stave page in Hermes Desktop, where the person can read the "
                   "engraved score, play it and ask for changes. The piece is checked first; a piece with problems is "
                   "not opened and the problems come back for you to fix. Load the stave:compose skill first.",
    "parameters": {
        "type": "object",
        "properties": {**_PIECE_PROPS, "prompt": {"type": "string", "description": "What the person asked for, in their words."},
                       "note": {"type": "string", "description": "One line for the margin about the piece, under 12 words."}},
        "required": ["title", "key", "meter", "tempo", "voices", "sections", "bars"],
    },
}


def _normalise(args: dict) -> dict:
    voices = [
        {"id": f"V{i + 1}", "name": str(v.get("name") or ("Melody" if i == 0 else "Part"))[:24],
         "instrument": str(v.get("instrument", "piano")).lower(), "clef": clef_for(v.get("instrument"), v.get("clef"))}
        for i, v in enumerate((args.get("voices") or [])[:3])
    ]
    ids = [v["id"] for v in voices]
    bars = []
    for bar in args.get("bars") or []:
        if not isinstance(bar, dict):
            continue
        notes = bar.get("notes") if isinstance(bar.get("notes"), dict) else bar
        cleaned = {vid: str(notes.get(vid, "")).replace("|", " ").strip() for vid in ids}
        for v in voices:
            fretted = FRETTED.get(v["instrument"])
            if fretted:
                cleaned[v["id"]] = fold_into_range(cleaned[v["id"]], fretted[1], fretted[2])
        bars.append({"section": str(bar.get("section") or "A")[:3], "notes": cleaned})
    return {**args, "voices": voices, "bars": bars}


def stave_check(args: dict, **_kw) -> str:
    piece = _normalise(args)
    issues = check_piece(piece)
    if issues:
        return json.dumps({"ok": False, "problems": issues[:40], "count": len(issues),
                           "hint": "Rewrite only the listed bars, then check again."})
    return json.dumps({"ok": True, "bars": len(piece["bars"]), "voices": len(piece["voices"])})


def stave_open(args: dict, **_kw) -> str:
    piece = _normalise(args)
    issues = check_piece(piece)
    if issues:
        return json.dumps({"opened": False, "problems": issues[:40], "count": len(issues),
                           "hint": "Nothing was opened. Fix these bars and call stave_open again."})
    entry = {
        "id": f"h{uuid.uuid4().hex[:12]}",
        "at": time.time(),
        "title": str(piece.get("title") or "Untitled")[:60],
        "prompt": str(piece.get("prompt") or "")[:300],
        "mood": str(piece.get("mood") or "")[:80],
        "key": str(piece.get("key") or "C"),
        "meter": piece.get("meter") or "4/4",
        "tempo": max(40, min(200, int(piece.get("tempo") or 100))),
        "voices": piece["voices"],
        "sections": [{"id": str(s.get("id"))[:3], "name": str(s.get("name") or "")[:28]} for s in piece.get("sections") or []],
        "bars": piece["bars"],
        "note": str(piece.get("note") or "")[:120],
    }
    Inbox().put(entry)
    return json.dumps({"opened": True, "title": entry["title"], "bars": len(entry["bars"]),
                       "where": "the Stave page in Hermes Desktop (sidebar: Stave)"})


def register_tools(ctx) -> None:
    for schema, handler, emoji in ((CHECK_SCHEMA, stave_check, "🎼"), (OPEN_SCHEMA, stave_open, "🎵")):
        ctx.register_tool(name=schema["name"], toolset=TOOLSET, schema=schema, handler=handler,
                          description=schema["description"], emoji=emoji)
