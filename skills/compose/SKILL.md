---
name: compose
description: Write a short piece of music as Stave ABC and open it on the Stave page. Use when someone asks for a song, melody, tune, lullaby, fanfare, waltz or any piece of music, or asks to see or hear music as sheet music.
---

# Compose for Stave

Stave is a page in Hermes Desktop that engraves a piece as sheet music, plays it, and lets the person change any bars by asking. You write the notes; the page does the engraving and the sound. Never send audio, lyrics or a description instead of notes.

## Workflow

1. **Plan before notes.** Decide the key, meter, tempo, 2 or 3 instruments, and a form of 2 to 4 sections (16 to 32 bars total) with one chord per bar. A memorable 1–2 bar motif, a contrasting middle, an ending that lands on the tonic.
2. **Write the bars** as data (shape below), every voice in every bar.
3. **Call `stave_check`.** It returns problems by bar and voice. Rewrite only those bars and check again. Two rounds is normal; stop guessing and simplify the rhythm if a bar keeps failing.
4. **Call `stave_open`** with the checked piece, the person's request as `prompt`, and a one-line `note` for the margin. It refuses a piece with problems and tells you why.
5. **Tell the person** it is on the Stave page (sidebar: Stave), in one line, with the title. Do not paste the ABC into the chat unless they ask.

When a section returns (A B A), reuse the A bars with at most a small change near the end. That keeps the form clear and saves effort. The page labels a reused id "again", so `stave_check` flags a return whose melody shares fewer than half its bars with the first time. New music gets a new id (A B C).

## The data

```json
{
  "title": "Sunny Day", "mood": "bright, easy", "key": "C", "meter": "4/4", "tempo": 120,
  "voices": [
    {"id": "V1", "name": "Melody", "instrument": "flute", "clef": "treble"},
    {"id": "V2", "name": "Bass", "instrument": "cello", "clef": "bass"}
  ],
  "sections": [{"id": "A", "name": "morning"}, {"id": "B", "name": "noon"}],
  "bars": [
    {"section": "A", "V1": "\"C\"E2 G2 c2 G2", "V2": "C,4 G,,4"},
    {"section": "A", "V1": "\"F\"A2 c2 \"G\"B2 d2", "V2": "F,,4 G,,4"}
  ]
}
```

Instruments: piano, music box, celesta, vibraphone, marimba, nylon guitar, steel guitar, electric guitar, bass guitar, acoustic bass, violin, viola, cello, strings, harp, choir, trumpet, french horn, clarinet, oboe, flute, pan flute.

## Notation (ABC, L:1/8)

- A plain note is an **eighth**. Every bar of every voice adds up to exactly: 4/4 → 8, 3/4 → 6, 6/8 → 6, 2/4 → 4 eighths.
- Pitches `C D E F G A B c d e f g a b`; a comma lowers an octave (`C,` `G,,`), an apostrophe raises one (`c'`). `C` is middle C.
- Lengths: `A2` quarter, `A4` half, `A8` whole, `A3` dotted quarter, `A/` sixteenth, `A3/2` dotted eighth. Rests `z z2 z4 z8`.
- Accidentals `^F` sharp, `_B` flat, `=F` natural. The key signature already applies; only mark notes that leave the key.
- Chords `[CEG]2` (one length after the bracket). Triplets `(3ABc` = three eighths in the time of two. Ties `A2-A2`.
- Chord symbols only in the first voice, in double quotes before the note where the harmony changes: `"Am"A2 c2 "F"F4`.
- Never put bar lines, repeats, header fields (`K:`, `M:`), decorations or comments inside a bar.
- Ranges: treble parts G3 to f6 (`G,` to `f'`); bass parts E1 to G4 (`E,,,` to `G`).
- Guitars (`nylon guitar`, `steel guitar`, `electric guitar`) are written on the treble clef an octave above how they sound, as guitar music is, from `E,` to `e'`. The page draws TAB under them. Nothing below `E,` (a D chord starts on `D`, not `D,`). Use these shapes, spelled for C major (in another key, mark any note the key signature would change): G `[G,B,DGBg]`, C `[CEGce]`, D `[DAd^f]`, Em `[E,B,EGBe]`, Am `[A,EAce]`, E `[E,B,E^GBe]`, A `[A,EA^ce]`, Dm `[DAdf]`, F `[FAcf]`, Bm `[B,^FBd^f]`. `stave_check` rejects a chord that cannot give each note its own string.
- Accompany like a guitarist, not with one block chord on every beat. On G (the shape's lowest note is the bass, the rest is the strum; the second bass is the chord's fifth): bass and strum `G,2 [DGBg]2 D2 [DGBg]2`, picked `G,B,DG BGDB,`, waltz `G,2 [DGB]2 [DGB]2`, 6/8 `G,DG BGD`. Change pattern between sections and hold a full chord at the end of a phrase.
- Bass guitar is written on the bass clef an octave above how it sounds, from `E,,` to `G`, one note at a time.

## Writing well

- **Melody:** mostly steps with a few leaps; leap, then step back. Give each phrase a high point. Breathe every 2 or 4 bars with a longer note or a rest.
- **Rhythm:** keep a rhythmic idea and vary it; avoid eight identical eighths bar after bar.
- **Bass:** roots and fifths on strong beats, moving by step into chord changes.
- **Inner part:** longer notes or a simple repeating figure (an arpeggio for harp or guitar, sustained chords for strings).
- **Cadences:** end sections on V or I; end the piece on I with a long note.
- **Character:** a lullaby is slow (50–70), narrow in range, 6/8 or 3/4; a fanfare is bright (110–140), brass, leaps of fourths and fifths, dotted rhythms; a waltz is 3/4 with bass on beat 1 and chords on 2 and 3.

## Changing a piece someone already has

If they want changes to a piece on the page, tell them to select the bars on the Stave page and ask there: the page rewrites only those bars and keeps an undo. If they want a new version from the chat, write it as a new piece and open it.
