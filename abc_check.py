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
    "piano", "music box", "celesta", "vibraphone", "marimba", "nylon guitar", "steel guitar",
    "electric guitar", "bass guitar", "acoustic bass",
    "violin", "viola", "cello", "strings", "harp", "choir", "trumpet", "french horn", "clarinet",
    "oboe", "flute", "pan flute",
}
KEY_RE = re.compile(r"^[A-G][#b]?m?$")

# Diatonic steps from middle C (C = 0, c = 7, C, = -7), the numbering abcjs uses.
RANGES = {"treble": (-5, 17, "G3 to f6"), "bass": (-17, 4, "E1 to G4")}

# Fretted parts are written an octave above how they sound, on a fixed clef, and the page draws TAB
# under them: (clef, lowest, highest, range label, strings).
_GUITAR_RANGE = "E, to e' as written; nothing below E,, so a D chord starts on D, not D,"
FRETTED = {
    "nylon guitar": ("treble", -5, 16, _GUITAR_RANGE, 6),
    "steel guitar": ("treble", -5, 16, _GUITAR_RANGE, 6),
    "electric guitar": ("treble", -5, 16, _GUITAR_RANGE, 6),
    "bass guitar": ("bass", -12, 4, "E,, to G as written; nothing below E,,", 4),
}


def fold_into_range(text, low, high) -> str:
    """Move notes outside a fretted part's range by whole octaves until they fit (a D chord written
    from D, starts on D), leaving chord symbols and decorations alone. Same as the page's foldIntoRange."""
    def fix(m):
        acc, letter, marks = m.group(1), m.group(2), m.group(3)
        pitch = "CDEFGAB".index(letter.upper()) + (7 if letter.islower() else 0) + 7 * (marks.count("'") - marks.count(","))
        if low <= pitch <= high:
            return m.group(0)
        while pitch < low:
            pitch += 7
        while pitch > high:
            pitch -= 7
        octave = pitch // 7
        name = letter.lower() + "'" * (octave - 1) if octave >= 1 else letter.upper() + "," * (-octave)
        return acc + name
    parts = re.split(r'("[^"]*"|![^!]*!)', str(text or ""))
    return "".join(part if i % 2 else re.sub(r"([_^=]*)([A-Ga-g])([,']*)", fix, part) for i, part in enumerate(parts))


def drop_key_accidentals(text, key) -> str:
    """Drop accidentals the key signature already gives (no sharp on F in a G major D chord), until one
    that changes the note appears on that letter in the bar. Same as the page's dropKeyAccidentals."""
    keyacc = key_accidentals(key)
    touched = set()

    def fix(m):
        acc, letter = m.group(1), m.group(2)
        if not acc:
            return m.group(0)
        name = letter.upper()
        if name not in touched and _ACC.get(acc, 0) == keyacc.get(name, 0):
            return letter
        touched.add(name)
        return m.group(0)

    parts = re.split(r'("[^"]*"|![^!]*!)', str(text or ""))
    return "".join(part if i % 2 else re.sub(r"(\^\^|__|[_^=])?([A-Ga-g])", fix, part) for i, part in enumerate(parts))


_SIGN = {1: "^", 2: "^^", -1: "_", -2: "__", 0: "="}


def courtesy_accidentals(text, key) -> str:
    """Write an accidental out when its letter carried a different one earlier in the bar, in another
    octave, so playback (octave by octave) and the TAB (letter by letter) agree. Same as the page's
    courtesyAccidentals."""
    keyacc = key_accidentals(key)
    by_octave: dict = {}
    by_letter: dict = {}

    def fix(m):
        acc, letter, marks = m.group(1), m.group(2), m.group(3)
        name = letter.upper()
        slot = f"{name}{1 if letter.islower() else 0}{marks}"
        if acc:
            by_octave[slot] = _ACC.get(acc, 0)
            by_letter[name] = _ACC.get(acc, 0)
            return m.group(0)
        sounding = by_octave.get(slot, keyacc.get(name, 0))
        if name not in by_letter or by_letter[name] == sounding:
            return m.group(0)
        by_letter[name] = sounding
        return _SIGN[sounding] + letter + marks

    parts = re.split(r'("[^"]*"|![^!]*!)', str(text or ""))
    return "".join(part if i % 2 else re.sub(r"(\^\^|__|[_^=])?([A-Ga-g])([,']*)", fix, part) for i, part in enumerate(parts))


def clef_for(instrument, clef) -> str:
    """The clef a voice must use: fixed for fretted instruments, the writer's choice otherwise."""
    fretted = FRETTED.get(str(instrument or "").lower())
    if fretted:
        return fretted[0]
    return "bass" if clef == "bass" else "treble"


# Open strings as written (an octave above sound), lowest first, in MIDI numbers.
OPEN_STRINGS = {"guitar": [52, 57, 62, 67, 71, 76], "bass guitar": [40, 45, 50, 55]}
_STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_ACC = {"^": 1, "^^": 2, "_": -1, "__": -2, "=": 0}
_MAJOR_FIFTHS = {"C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7,
                 "F": -1, "Bb": -2, "Eb": -3, "Ab": -4, "Db": -5, "Gb": -6, "Cb": -7}
_MINOR_FIFTHS = {"A": 0, "E": 1, "B": 2, "F#": 3, "C#": 4, "G#": 5, "D#": 6, "A#": 7,
                 "D": -1, "G": -2, "C": -3, "F": -4, "Bb": -5, "Eb": -6, "Ab": -7}


def key_accidentals(key) -> dict:
    """Sharps (+1) or flats (-1) by letter for a key like G, Bb or F#m."""
    key = str(key or "C")
    fifths = _MINOR_FIFTHS.get(key[:-1], 0) if key.endswith("m") else _MAJOR_FIFTHS.get(key, 0)
    if fifths >= 0:
        return {letter: 1 for letter in "FCGDAEB"[:fifths]}
    return {letter: -1 for letter in "BEADGCF"[:-fifths]}


def chord_fits_strings(pitches, open_strings) -> bool:
    """Same rule as the page (desktop-src/src/music/check.js chordFitsStrings), checked against abcjs's
    TAB on 900 random chords: high to low, each note on the highest string at or below it, one move
    down a string for a clash between neighbours; no second clash, none on the lowest string, and no
    two notes a half step apart or less."""
    ordered = sorted(pitches, reverse=True)
    if any(ordered[i - 1] - ordered[i] <= 1 for i in range(1, len(ordered))):
        return False
    pos = []
    for m in ordered:
        string = next((i for i in range(len(open_strings) - 1, -1, -1) if m >= open_strings[i]), -1)
        if string < 0:
            return False
        pos.append([m, string])
    moved = False
    for j in range(len(pos) - 1):
        a, b = pos[j], pos[j + 1]
        if a[1] != b[1]:
            continue
        if a[1] == 0 or moved:
            return False
        mover = b if b[0] - open_strings[b[1]] < a[0] - open_strings[a[1]] else a
        mover[1] -= 1
        moved = True
    return len({p[1] for p in pos}) == len(pos)


def _unfingerable_chord(text, key, open_strings) -> bool:
    """True when a chord in this bar cannot be given one string per note."""
    keyacc = key_accidentals(key)
    measure: dict = {}
    clean = re.sub(r'"[^"]*"|![^!]*!', "", str(text))
    for m in re.finditer(r"\[([^\]|]*)\]|([_^=]*)([A-Ga-g])([,']*)", clean):
        group = [(n.group(1), n.group(2), n.group(3)) for n in _NOTE.finditer(m.group(1))] if m.group(1) is not None \
            else [(m.group(2), m.group(3), m.group(4))]
        midis = []
        for acc, letter, octave in group:
            name = letter.upper()
            if acc:
                measure[name] = _ACC.get(acc, 0)
            base = 60 + _STEPS[name] + (12 if letter.islower() else 0) + 12 * octave.count("'") - 12 * octave.count(",")
            midis.append(base + measure.get(name, keyacc.get(name, 0)))
        if len(midis) > 1 and not chord_fits_strings(midis, open_strings):
            return True
    return False


def _largest_chord(text) -> int:
    return max((len(_NOTE.findall(m.group(1))) for m in _CHORD.finditer(re.sub(r'"[^"]*"', "", str(text)))), default=1)

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
            fretted = FRETTED.get(str(v.get("instrument", "")).lower())
            if fretted:
                _, low, high, label, strings = fretted
                name = str(v.get("instrument")).lower().replace("nylon ", "").replace("steel ", "").replace("electric ", "")
            else:
                low, high, label = RANGES["bass" if v.get("clef") == "bass" else "treble"]
                name, strings = v.get("clef", "treble"), 0
            if any(p < low or p > high for p in pitches):
                issues.append({"bar": index, "voice": vid, "kind": "range",
                               "message": f"note outside the {name} range ({label})"})
            elif strings and _largest_chord(notes.get(vid, "")) > strings:
                issues.append({"bar": index, "voice": vid, "kind": "range",
                               "message": f"a chord with {_largest_chord(notes.get(vid, ''))} notes; this part has {strings} strings"})
            elif strings and _unfingerable_chord(notes.get(vid, ""), key, OPEN_STRINGS["bass guitar" if strings == 4 else "guitar"]):
                issues.append({"bar": index, "voice": vid, "kind": "range",
                               "message": "two notes of a chord fall on the same string, so it cannot be fingered; "
                                          "spread the chord out or drop a note"})
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
