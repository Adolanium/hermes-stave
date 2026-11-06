"""Checks a Stave piece the way the Desktop page does, so the agent can fix its own music before
it opens on the page. A piece is plain data: meter, voices (id, clef, instrument) and bars, where
each bar holds one ABC string per voice in L:1/8 (a plain note is an eighth).

Each issue names the bar (1-based) and voice, so a fix can target exactly those bars.
A section id that comes back (A B A) must bring its bars back, since the page labels it 'again'.
"""

from __future__ import annotations

import re
from fractions import Fraction

METERS = {"4/4", "3/4", "6/8", "2/4"}
INSTRUMENTS = {
    "piano", "music box", "celesta", "vibraphone", "marimba", "nylon guitar", "acoustic bass",
    "violin", "viola", "cello", "strings", "harp", "choir", "trumpet", "french horn", "clarinet",
    "oboe", "flute", "pan flute",
}
KEY_RE = re.compile(r"^[A-G][#b]?m?$")

# Diatonic steps from middle C (C = 0, c = 7, C, = -7), the numbering abcjs uses.
RANGES = {"treble": (-5, 17, "G3 to f6"), "bass": (-17, 4, "E1 to G4")}

_LENGTH = r"(\d*)(/*)(\d*)"
_NOTE = re.compile(r"([_^=]*)([A-Ga-g])([,']*)" + _LENGTH)
_REST = re.compile(r"[zx]" + _LENGTH)
_CHORD = re.compile(r"\[([^\]|]*)\]" + _LENGTH)
_SKIP = re.compile(r'"[^"]*"|![^!]*!|\+[^+]*\+|\{[^}]*\}|[\s\-()<>~.]')


def _length(num: str, slashes: str, den: str) -> Fraction:
    value = Fraction(int(num)) if num else Fraction(1)
    if slashes:
        divisor = int(den) if den else 2 ** len(slashes)
        if den and len(slashes) > 1:
            divisor = int(den) * 2 ** (len(slashes) - 1)
        value /= divisor
    return value


def _pitch(letter: str, octave: str) -> int:
    step = "CDEFGAB".index(letter.upper()) + (7 if letter.islower() else 0)
    return step - 7 * octave.count(",") + 7 * octave.count("'")


def read_bar(text: str) -> tuple[Fraction, list[int], str | None]:
    """Duration in eighths, the pitches, and the first syntax problem (or None)."""
    s = str(text or "")
    if not s.strip():
        return Fraction(0), [], "empty bar"
    if "|" in s:
        return Fraction(0), [], "bar line inside a bar"
    if s.count('"') % 2:
        return Fraction(0), [], "unclosed chord symbol"
    total = Fraction(0)
    pitches: list[int] = []
    tuplet_left = 0
    tuplet_ratio = Fraction(1)
    i = 0
    while i < len(s):
        if s[i] == "(" and i + 1 < len(s) and s[i + 1].isdigit():
            p = int(s[i + 1])
            q = {2: 3, 3: 2, 4: 3, 5: 2, 6: 2, 7: 2, 9: 2}.get(p, 2)
            tuplet_ratio, tuplet_left = Fraction(q, p), p
            i += 2
            continue
        skip = _SKIP.match(s, i)
        if skip:
            i = skip.end()
            continue
        for kind, pattern in (("chord", _CHORD), ("note", _NOTE), ("rest", _REST)):
            m = pattern.match(s, i)
            if not m:
                continue
            if kind == "chord":
                inner = _NOTE.findall(m.group(1))
                if not inner:
                    return total, pitches, "empty chord"
                first = inner[0]
                length = _length(*first[3:6]) * _length(*m.groups()[1:4])
                pitches.extend(_pitch(n[1], n[2]) for n in inner)
            elif kind == "note":
                length = _length(*m.groups()[3:6])
                pitches.append(_pitch(m.group(2), m.group(3)))
            else:
                length = _length(*m.groups())
            if tuplet_left > 0:
                length *= tuplet_ratio
                tuplet_left -= 1
            total += length
            i = m.end()
            break
        else:
            if re.match(r"[A-Z]:", s[i:i + 2]):
                return total, pitches, "header field inside a bar"
            return total, pitches, f"'{s[i]}' is not ABC this page reads"
    return total, pitches, None


def eighths_per_bar(meter: str) -> Fraction:
    n, d = (int(x) for x in meter.split("/"))
    return Fraction(n * 8, d)


def check_piece(piece: dict) -> list[dict]:
    """Every problem with a piece, in bar order: [{bar, voice, kind, message}]."""
    issues: list[dict] = []
    meter = str(piece.get("meter") or "4/4")
    if meter not in METERS:
        issues.append({"bar": 0, "voice": "", "kind": "meta", "message": f"meter {meter!r}: use one of {sorted(METERS)}"})
        meter = "4/4"
    key = str(piece.get("key") or "C")
    if not KEY_RE.match(key):
        issues.append({"bar": 0, "voice": "", "kind": "meta", "message": f"key {key!r}: write it like C, F#m or Bb"})
    voices = piece.get("voices") or []
    if not 1 <= len(voices) <= 3:
        issues.append({"bar": 0, "voice": "", "kind": "meta", "message": "use 1 to 3 voices"})
    for v in voices:
        if str(v.get("instrument", "")).lower() not in INSTRUMENTS:
            issues.append({"bar": 0, "voice": v.get("id", ""), "kind": "meta",
                           "message": f"instrument {v.get('instrument')!r}: pick one of {sorted(INSTRUMENTS)}"})
    bars = piece.get("bars") or []
    if not bars:
        issues.append({"bar": 0, "voice": "", "kind": "meta", "message": "no bars"})
    want = eighths_per_bar(meter)
    for index, bar in enumerate(bars, start=1):
        notes = bar.get("notes", bar) if isinstance(bar, dict) else {}
        for v in voices:
            vid = v.get("id", "")
            length, pitches, problem = read_bar(notes.get(vid, ""))
            if problem:
                issues.append({"bar": index, "voice": vid, "kind": "syntax", "message": problem})
                continue
            if length != want:
                issues.append({"bar": index, "voice": vid, "kind": "length",
                               "message": f"{_fmt(length)} eighths, needs {_fmt(want)}"})
            low, high, label = RANGES["bass" if v.get("clef") == "bass" else "treble"]
            if any(p < low or p > high for p in pitches):
                issues.append({"bar": index, "voice": vid, "kind": "range",
                               "message": f"note outside the {v.get('clef', 'treble')} range ({label})"})
    issues.extend(_returns(bars, voices))
    return issues


_SOUND_SKIP = re.compile(r'"[^"]*"|![^!]*!|\s')


def _sound(text) -> str:
    """A bar's notes without chord symbols, decorations or spacing: what you would hear."""
    return _SOUND_SKIP.sub("", str(text or ""))


def _returns(bars: list, voices: list) -> list[dict]:
    """A section id that comes back (A B A) must bring its bars back: the page labels it "again".

    Each later run of an id is compared bar by bar with the first run, on the melody (the first
    voice). At least half the bars have to match; changing the last bar or two is fine.
    """
    if not voices:
        return []
    melody = voices[0].get("id", "V1")
    runs: list[list] = []  # [section id, first index, last index], 0-based
    for i, bar in enumerate(bars):
        sid = str(bar.get("section") or "") if isinstance(bar, dict) else ""
        if runs and runs[-1][0] == sid:
            runs[-1][2] = i
        else:
            runs.append([sid, i, i])

    def sound(i: int) -> str:
        bar = bars[i]
        notes = bar.get("notes", bar) if isinstance(bar, dict) else {}
        return _sound(notes.get(melody, ""))

    first: dict[str, tuple[int, int]] = {}
    issues: list[dict] = []
    for sid, lo, hi in runs:
        if not sid:
            continue
        if sid not in first:
            first[sid] = (lo, hi)
            continue
        a_lo, a_hi = first[sid]
        count = min(hi - lo, a_hi - a_lo) + 1
        same = sum(sound(lo + k) == sound(a_lo + k) for k in range(count))
        if same * 2 < count:
            issues.append({
                "bar": lo + 1, "voice": melody, "kind": "form",
                "message": f"section {sid} returns at bars {lo + 1}-{hi + 1} but only {same} of {count} melody bars "
                           f"match bars {a_lo + 1}-{a_lo + count}; repeat those bars (a change near the end is fine) "
                           f"or give this section a new id",
            })
    return issues


def _fmt(x: Fraction) -> str:
    return str(x.numerator) if x.denominator == 1 else f"{float(x):g}"
