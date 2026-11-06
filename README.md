# Stave

Describe a piece of music in a sentence and Hermes writes it as sheet music. Stave is a page in Hermes Desktop that engraves the score, plays it with the sounding notes lit, and changes any bars you pick when you ask in words.

Hermes writes notes, not audio. Every note is on the page, so you can read it, hear it, change it, and take it to another music app as MIDI.

## What it does

- **Writes a piece from a sentence.** "A waltz for two cats in love" becomes a plan (key, meter, tempo, instruments, sections with their chords), then each section in ABC notation. The score fills in section by section, and the notes slide onto the staff as each one arrives.
- **Checks its own work.** Before you see a section, Stave parses it and checks that every bar of every part adds up to the meter and that every note sits in its instrument's range. Hermes repairs the bars that fail, once, and the fixed bars are marked in the margin.
- **Plays it.** Press play or Space. The notes light up as they sound, and a line runs along the melody so you can follow it without reading music. The page scrolls with the music.
- **Changes what you point at.** Click a bar, drag across several, or Shift-click, then say what you want: "sadder", "end on a long note", "simpler bass". Hermes rewrites only those bars and notes what it changed in the margin. With nothing selected, a request applies to the whole piece: "slower", "on strings", "in A minor", "make it longer".
- **Undoes anything.** Every change keeps a snapshot. Undo with the arrow button or Cmd/Ctrl+Z.
- **Exports.** MIDI for any music app, WAV of what you hear, or the ABC text.
- **Keeps your pieces.** The Pieces menu lists everything you have written on this machine.

## How Hermes is used

Every step is one stateless `llm.oneshot` call: plan, one call per section, one per repair, one per change. Nothing runs in the gateway and no agent tools are added.

By default Stave writes with your chat model. It creates one hidden Hermes session named "Stave" so that `llm.oneshot` can borrow that session's model. Choose "The fast helper model" in the export menu to use Hermes's auxiliary task model instead, which skips the session.

## Install

Stave is a Hermes Desktop plugin (`kind: standalone`, `desktop/plugin.js`).

```bash
hermes plugins install https://github.com/Adolanium/hermes-stave
```

Then enable Stave in Capabilities → Plugins. It appears in the sidebar and as "Open Stave" in the command palette.

To develop, link the `desktop/` folder into Hermes Desktop's plugin folder and rebuild after edits; Desktop reloads the page on every build:

```bash
ln -s "$PWD/desktop" ~/.hermes/desktop-plugins/stave
cd desktop-src && npm ci && npm run build
```

Tests:

```bash
cd desktop-src && npm test
```

## What it does on your machine

- **Network.** Playback downloads instrument samples (General MIDI soundfont files) from `https://paulrosen.github.io/midi-js-soundfonts/` the first time each instrument plays. The model calls go through Hermes to whichever provider you configured. Nothing else leaves your machine.
- **Storage.** Pieces, their undo history, and your model choice are kept in the plugin's own Desktop storage. Stave writes no files unless you export one.
- **Sessions.** With "Your chat model" selected, Stave creates one hidden Hermes session titled "Stave" and reuses it. Hermes does not let plugins delete sessions; you can remove it from the session list.
- **Audio.** Sound plays only when you press play. Stave uses no microphone.

## Credits

- [abcjs](https://github.com/paulrosen/abcjs) (MIT) engraves and plays the notation.
- [Rough Notation](https://github.com/rough-stuff/rough-notation) (MIT) draws Hermes's pencil marks.
- [Bodoni Moda](https://github.com/indestructible-type/Bodoni) and [Kalam](https://github.com/itfoundry/kalam) (SIL Open Font License 1.1) set the titles and the margin notes.
- The instrument samples are the FluidR3 GM soundfont, converted by [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts).

## License

MIT
