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


def test_a_returning_section_must_bring_its_bars_back():
    a = [{"V1": '"C"E2 G2 c2 G2', "V2": "C,8"}, {"V1": '"G"D2 F2 B2 G2', "V2": "G,,8"},
         {"V1": '"F"A2 c2 f2 c2', "V2": "F,,8"}, {"V1": '"C"c8', "V2": "C,8"}]
    b = [{"V1": '"Am"A4 c4', "V2": "A,,8"}, {"V1": '"G"B4 G4', "V2": "G,,8"}]
    def bars(*runs):
        return [{"section": sid, **bar} for sid, run in runs for bar in run]
    base = piece([])
    # A B A with the A bars back, the chord symbols and the last bar changed: fine
    varied = [*a[:3], {"V1": '"C"c4 z4', "V2": "C,8"}]
    varied[0] = {**varied[0], "V1": '"Am"E2 G2 c2 G2'}
    assert abc_check.check_piece({**base, "bars": bars(("A", a), ("B", b), ("A", varied))}) == []
    # A B "A" with new music: flagged on the first bar of the return
    new = [{"V1": '"Dm"d2 f2 a2 f2', "V2": "D,8"}, *a[1:2], {"V1": '"C"e2 g2 c2 e2', "V2": "C,8"}, {"V1": "f8", "V2": "F,,8"}]
    [issue] = abc_check.check_piece({**base, "bars": bars(("A", a), ("B", b), ("A", new))})
    assert (issue["bar"], issue["voice"], issue["kind"]) == (7, "V1", "form")
    assert "1 of 4" in issue["message"] and "bars 1-4" in issue["message"]
    # the same music under a new id is not a return
    assert abc_check.check_piece({**base, "bars": bars(("A", a), ("B", b), ("C", new))}) == []


def test_guitar_parts_have_a_fixed_clef_their_own_range_and_six_strings():
    voices = [{"id": "V1", "instrument": "steel guitar", "clef": "bass"}, {"id": "V2", "instrument": "bass guitar", "clef": "treble"}]
    good = {"title": "T", "key": "G", "meter": "4/4", "tempo": 90, "voices": voices, "sections": [{"id": "A"}],
            "bars": [{"section": "A", "V1": '"G"[G,B,DGB]4 [G,B,DGB]4', "V2": "G,,4 D,4"}]}
    assert abc_check.check_piece(tools._normalise(good)) == []
    assert [v["clef"] for v in tools._normalise(good)["voices"]] == ["treble", "bass"]

    # Straight to the checker: tools._normalise would move C, and C,, up an octave first.
    bad = {**tools._normalise(good), "bars": [{"section": "A", "notes": {"V1": "C,8", "V2": "C,,8"}},
                                              {"section": "A", "notes": {"V1": "[E,G,B,EGBe]8", "V2": "G,8"}}]}
    messages = [(i["bar"], i["voice"], i["message"]) for i in abc_check.check_piece(bad)]
    assert (1, "V1", "note outside the guitar range (E, to e' as written; nothing below E,, so a D chord starts on D, not D,)") in messages
    assert (1, "V2", "note outside the bass guitar range (E,, to G as written; nothing below E,,)") in messages
    assert (2, "V1", "a chord with 7 notes; this part has 6 strings") in messages
    assert not [m for m in messages if m[0] == 2 and m[1] == "V2"]


def test_guitar_chords_need_one_string_per_note_like_the_page():
    guitar = abc_check.OPEN_STRINGS["guitar"]
    assert abc_check.chord_fits_strings([55, 59, 62, 67, 71], guitar)
    assert abc_check.chord_fits_strings([65, 62], guitar)
    assert not abc_check.chord_fits_strings([52, 54], guitar)
    assert not abc_check.chord_fits_strings([59, 62, 65], guitar)
    assert not abc_check.chord_fits_strings([71, 70, 69], guitar)
    assert abc_check.key_accidentals("G") == {"F": 1}
    assert abc_check.key_accidentals("Dm") == {"B": -1}
    piece = {"title": "T", "key": "G", "meter": "4/4", "tempo": 90, "sections": [{"id": "A"}],
             "voices": [{"id": "V1", "instrument": "nylon guitar", "clef": "treble"}],
             "bars": [{"section": "A", "V1": "[G,B,DGB]8"}, {"section": "A", "V1": "[B,DF]8"}, {"section": "A", "V1": "[B,D=F]8"}]}
    issues = abc_check.check_piece(tools._normalise(piece))
    assert [i["bar"] for i in issues] == [2, 3]
    assert "same string" in issues[0]["message"]


def test_out_of_range_guitar_notes_move_by_octaves_like_the_page():
    assert abc_check.fold_into_range('"Dm"D,2 F2 A2', -5, 16) == '"Dm"D2 F2 A2'
    assert abc_check.fold_into_range("[D,A,DF]4 ^C,,2 a'2", -5, 16) == "[DA,DF]4 ^C2 a2"
    assert abc_check.fold_into_range("C,,4 c4", -12, 4) == "C,4 C4"
    piece = tools._normalise({"voices": [{"id": "V1", "instrument": "steel guitar"}, {"id": "V2", "instrument": "flute"}],
                              "bars": [{"section": "A", "V1": "D,4 D,4", "V2": "D,4 D,4"}]})
    assert piece["bars"][0]["notes"] == {"V1": "D4 D4", "V2": "D,4 D,4"}


def test_accidentals_the_key_gives_are_dropped_like_the_page():
    assert abc_check.drop_key_accidentals('"D"[DAd^f]2 ^F2 =C2', "G") == '"D"[DAdf]2 F2 C2'
    assert abc_check.drop_key_accidentals("=F2 ^F2 ^G2 _B2", "G") == "=F2 ^F2 ^G2 _B2"
    assert abc_check.drop_key_accidentals('"Bb"_B2 _e2 =A2 ^c2', "Bb") == '"Bb"B2 e2 A2 ^c2'
    piece = tools._normalise({"key": "G", "voices": [{"id": "V1", "instrument": "steel guitar"}],
                              "bars": [{"section": "A", "V1": "[DAd^f]4 [DAd^f]4"}]})
    assert piece["bars"][0]["notes"]["V1"] == "[DAdf]4 [DAdf]4"


def test_courtesy_accidentals_like_the_page():
    assert abc_check.courtesy_accidentals("[=CEG]4 [EGc]4", "D") == "[=CEG]4 [EG^c]4"
    assert abc_check.courtesy_accidentals("^c2 C2 c2 C2", "C") == "^c2 =C2 ^c2 =C2"
    assert abc_check.courtesy_accidentals("c2 C2 ^G2 ^g2", "D") == "c2 C2 ^G2 ^g2"
