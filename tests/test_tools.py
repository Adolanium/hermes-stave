"""The agent-side checker must agree with the page's (desktop-src/test/music.test.mjs), and
stave_open must refuse broken music and deliver clean music to the inbox."""

import importlib.util
import json
import sys
from fractions import Fraction
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def _package():
    name = "hermes_stave_under_test"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name]


pkg = _package()
from hermes_stave_under_test import abc_check, inbox, tools  # noqa: E402

VOICES = [{"id": "V1", "instrument": "flute", "clef": "treble"}, {"id": "V2", "instrument": "cello", "clef": "bass"}]


def piece(bars, meter="4/4"):
    return {"title": "T", "key": "C", "meter": meter, "tempo": 120, "voices": VOICES,
            "sections": [{"id": "A", "name": "a"}], "bars": [{"section": "A", **b} for b in bars]}


@pytest.mark.parametrize("text,eighths", [
    ('"C"E2 G2 c2 G2', 8), ("c3 B A2", 6), ("(3ABc d4 z2", 8), ("[CEG]2 z6", 8), ("A/ A/ B3/2 c/ d4 z", 8),
    ("A2-A2 z4", 8), ("A3 B3", 6), ("_B2 ^F2 =F4", 8), ("[C2E2G2] z6", 8),
])
def test_bar_lengths(text, eighths):
    length, _pitches, problem = abc_check.read_bar(text)
    assert problem is None
    assert length == Fraction(eighths)


@pytest.mark.parametrize("text,problem", [
    ("A2 | B2", "bar line inside a bar"), ('"C E2', "unclosed chord symbol"), ("K:G A8", "header field inside a bar"),
    ("", "empty bar"), ("A2 # B2", "'#' is not ABC this page reads"),
])
def test_bar_syntax(text, problem):
    assert abc_check.read_bar(text)[2] == problem


def test_pitches_follow_abcjs_numbering():
    assert abc_check.read_bar("C c C, c'")[1] == [0, 7, -7, 14]


def test_check_names_bar_voice_and_kind():
    issues = abc_check.check_piece(piece([
        {"V1": "c3 B A2", "V2": "C,8"},
        {"V1": "c8", "V2": "C,4 G,,4 C,2"},
        {"V1": "c''8", "V2": "C,8"},
        {"V1": '"C"E2 G2 c2 G2', "V2": "C,4 G,,4"},
    ]))
    assert [(i["bar"], i["voice"], i["kind"]) for i in issues] == [(1, "V1", "length"), (2, "V2", "length"), (3, "V1", "range")]
    assert issues[0]["message"] == "6 eighths, needs 8"


def test_six_eight_needs_six_eighths():
    issues = abc_check.check_piece(piece([{"V1": "A3 B3", "V2": "C,6"}, {"V1": "A4", "V2": "C,6"}], meter="6/8"))
    assert [(i["bar"], i["voice"]) for i in issues] == [(2, "V1")]


def test_meta_problems():
    bad = {**piece([{"V1": "A8", "V2": "C,8"}]), "meter": "5/4", "key": "H"}
    bad["voices"] = [{"id": "V1", "instrument": "kazoo", "clef": "treble"}]
    kinds = [i["message"] for i in abc_check.check_piece(bad)]
    assert any("meter" in k for k in kinds) and any("key" in k for k in kinds) and any("kazoo" in k for k in kinds)


def test_open_refuses_broken_music(tmp_path, monkeypatch):
    monkeypatch.setattr(inbox, "_data_dir", lambda: tmp_path)
    out = json.loads(tools.stave_open(piece([{"V1": "c3 B A2", "V2": "C,8"}])))
    assert out["opened"] is False and out["problems"][0]["bar"] == 1
    assert not list((tmp_path / "inbox").glob("*.json"))


def test_open_delivers_clean_music_and_ack_removes_it(tmp_path, monkeypatch):
    monkeypatch.setattr(inbox, "_data_dir", lambda: tmp_path)
    out = json.loads(tools.stave_open({**piece([{"V1": '"C"E2 G2 c2 G2', "V2": "C,4 G,,4"}]), "prompt": "a test", "note": "hi"}))
    assert out["opened"] is True and out["bars"] == 1
    box = inbox.Inbox(tmp_path)
    [entry] = box.list()
    assert entry["title"] == "T" and entry["bars"][0]["notes"]["V2"] == "C,4 G,,4" and entry["prompt"] == "a test"
    assert box.ack(entry["id"]) is True and box.list() == []
    assert box.ack("../etc") is False


def test_check_tool_reports_ok():
    assert json.loads(tools.stave_check(piece([{"V1": "A8", "V2": "C,8"}]))) == {"ok": True, "bars": 1, "voices": 2}


def test_register_wires_tools_skill_and_task():
    calls = []

    class Ctx:
        def register_tool(self, **kw): calls.append(("tool", kw["name"]))
        def register_skill(self, name, path, description=""): calls.append(("skill", name, Path(path).exists()))
        def register_auxiliary_task(self, key, **kw): calls.append(("task", key, kw.get("defaults")))

    pkg.register(Ctx())
    assert calls == [("tool", "stave_check"), ("tool", "stave_open"), ("skill", "compose", True), ("task", "stave", {"reasoning_effort": "none"})]
