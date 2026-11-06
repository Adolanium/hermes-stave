// All of Stave's CSS, injected once while the page is mounted. Disk plugins are not scanned by the
// app's Tailwind, so layout lives here; colours come from the host theme tokens so every Desktop theme
// (light, dark, installed skins) paints the score in its own ink.
import bodoni from './fonts/bodoni.woff2'
import bodoniItalic from './fonts/bodoni-italic.woff2'
import kalam from './fonts/kalam.woff2'

export const CSS = `
@font-face{font-family:'Stave Bodoni';src:url(${bodoni}) format('woff2');font-weight:400 900;font-style:normal;font-display:swap}
@font-face{font-family:'Stave Bodoni';src:url(${bodoniItalic}) format('woff2');font-weight:400 900;font-style:italic;font-display:swap}
@font-face{font-family:'Stave Pencil';src:url(${kalam}) format('woff2');font-weight:400;font-display:swap}

.st-page{
  --st-ink:var(--ui-text-primary);
  --st-ink-2:var(--ui-text-secondary);
  --st-ink-3:var(--ui-text-tertiary);
  --st-ink-4:var(--ui-text-quaternary);
  --st-staff:color-mix(in srgb,var(--ui-text-primary) 34%,transparent);
  --st-pencil:var(--ui-accent,var(--ui-blue));
  --st-pencil-soft:color-mix(in srgb,var(--st-pencil) 13%,transparent);
  --st-pencil-faint:color-mix(in srgb,var(--st-pencil) 7%,transparent);
  --st-ground:var(--ui-chat-surface-background,var(--ui-bg));
  --st-rule:var(--ui-stroke-tertiary);
  --st-ease:cubic-bezier(.16,1,.3,1);
  position:relative;display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:100%;min-height:0;container-type:inline-size;container-name:stave;
  background:var(--st-ground);color:var(--st-ink);font-family:var(--font-sans);overflow:hidden
}
.st-page ::selection{background:var(--st-pencil-soft);color:var(--st-ink)}
.st-page *{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--st-ink) 18%,transparent) transparent}

/* ── header ─────────────────────────────────────────── */
.st-head{display:flex;align-items:flex-end;gap:24px;padding:26px clamp(20px,4vw,56px) 14px;min-width:0}
.st-titles{flex:1;min-width:0}
.st-title{font-family:'Stave Bodoni',serif;font-optical-sizing:auto;font-weight:500;font-size:clamp(30px,3.6vw,48px);line-height:1.02;letter-spacing:-.02em;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st-title[data-empty=true]{color:var(--st-ink-3)}
.st-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:8px;font-size:12.5px;color:var(--st-ink-3);font-variant-numeric:tabular-nums}
.st-meta b{font-weight:500;color:var(--st-ink-2)}
.st-meta .st-dot{width:3px;height:3px;border-radius:50%;background:var(--st-ink-4)}
.st-tools{display:flex;align-items:center;gap:4px;flex-shrink:0}

.st-iconbtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;min-width:32px;padding:0 9px;border-radius:8px;border:0;background:transparent;color:var(--st-ink-2);font:inherit;font-size:12.5px;cursor:pointer;transition:background .15s,color .15s}
.st-iconbtn:hover{background:var(--ui-control-hover-background);color:var(--st-ink)}
.st-iconbtn:disabled{opacity:.38;cursor:default;background:transparent}
.st-iconbtn:focus-visible,.st-play:focus-visible,.st-send:focus-visible,.st-chip:focus-visible,.st-bar:focus-visible{outline:2px solid var(--st-pencil);outline-offset:2px}
.st-iconbtn svg{width:16px;height:16px;flex-shrink:0}

/* ── transport ─────────────────────────────────────── */
.st-transport{display:flex;align-items:center;gap:12px;padding-left:14px;margin-left:6px;border-left:1px solid var(--st-rule)}
.st-play{position:relative;width:46px;height:46px;border-radius:50%;border:0;background:var(--st-pencil);color:var(--ui-bg,#fff);display:grid;place-items:center;cursor:pointer;box-shadow:0 6px 18px -8px color-mix(in srgb,var(--st-pencil) 80%,transparent);transition:transform .18s var(--st-ease),box-shadow .18s}
.st-play:hover{transform:scale(1.05)}
.st-play:active{transform:scale(.96)}
.st-play:disabled{opacity:.35;cursor:default;transform:none;box-shadow:none}
.st-play svg{width:18px;height:18px}
.st-play[data-loading=true]::after{content:'';position:absolute;inset:-4px;border-radius:50%;border:2px solid transparent;border-top-color:var(--st-pencil);animation:st-spin .8s linear infinite}
.st-clock{display:grid;gap:2px;min-width:92px;font-variant-numeric:tabular-nums}
.st-clock-time{font-size:13px;color:var(--st-ink)}
.st-clock-bar{font-size:11.5px;color:var(--st-ink-3)}
.st-scrub{position:relative;width:120px;height:18px;cursor:pointer;touch-action:none}
.st-scrub::before{content:'';position:absolute;left:0;right:0;top:8px;height:2px;border-radius:2px;background:color-mix(in srgb,var(--st-ink) 14%,transparent)}
.st-scrub-fill{position:absolute;left:0;top:8px;height:2px;border-radius:2px;background:var(--st-pencil)}
.st-scrub-knob{position:absolute;top:4px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:var(--st-pencil);box-shadow:0 0 0 3px var(--st-ground)}
.st-tempo{display:flex;align-items:center;gap:2px;font-size:12px;color:var(--st-ink-3);font-variant-numeric:tabular-nums}
.st-tempo .st-iconbtn{height:24px;min-width:24px;padding:0}
.st-tempo span{min-width:44px;text-align:center}

/* ── score ─────────────────────────────────────────── */
.st-body{position:relative;overflow:auto;overscroll-behavior:contain;padding:6px clamp(20px,4vw,56px) 56px;-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 56px),transparent);mask-image:linear-gradient(to bottom,#000 calc(100% - 56px),transparent)}
.st-score-wrap{position:relative;max-width:1180px;margin:0 auto}
.st-score{position:relative}
.st-score svg{display:block;overflow:visible}
.st-score svg path,.st-score svg text{fill:var(--st-ink)}
.st-score svg .abcjs-staff path,.st-ghost svg .abcjs-staff path{fill:var(--st-staff)}
.st-score svg .abcjs-tempo{display:none}
.st-score svg text{font-family:var(--font-sans)}
.st-score svg .abcjs-title{display:none}
.st-score svg .abcjs-part{font-family:'Stave Bodoni',serif;font-style:italic;font-weight:600;fill:var(--st-ink-2)}
.st-score svg .abcjs-chord{font-family:'Stave Bodoni',serif;font-weight:500;fill:var(--st-ink-3)}
.st-score svg .abcjs-tempo,.st-score svg .abcjs-tempo path,.st-score svg .abcjs-tempo text{fill:var(--st-ink-3)}
.st-score svg .abcjs-voice-name{fill:var(--st-ink-3);font-size:11px}
.st-score svg .st-lit,.st-score svg .st-lit path{fill:var(--st-pencil)!important;transition:fill .08s}
.st-score svg .st-lit-soft,.st-score svg .st-lit-soft path{fill:color-mix(in srgb,var(--st-pencil) 45%,var(--st-ink))!important;transition:fill .08s}
.st-loop[data-on=true]{color:var(--st-pencil);background:var(--st-pencil-faint)}

/* slither: notes swim onto the staff in a travelling wave, a bar at a time */
.st-score svg .st-slither{transform-box:fill-box;transform-origin:center;opacity:0;animation:st-slither .62s var(--st-ease) forwards;animation-delay:var(--st-delay,0ms)}
@keyframes st-slither{
  0%{opacity:0;transform:translate(-22px,var(--st-dy,0px)) scale(.86);filter:blur(1.5px)}
  45%{opacity:1;filter:blur(0)}
  100%{opacity:1;transform:none;filter:blur(0)}
}

/* the melody line: a luminous serpent along the noteheads */
.st-score svg path.st-serpent,.st-serpent{fill:none;stroke:var(--st-pencil);stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.st-serpent-trace{stroke-width:1.4;opacity:0;transition:opacity .5s}
.st-score[data-playing=true] .st-serpent-trace{opacity:.16}
.st-serpent-body{stroke-width:3.2;opacity:0;filter:drop-shadow(0 0 5px color-mix(in srgb,var(--st-pencil) 70%,transparent))}
.st-serpent-body[data-on=true]{opacity:.95}
.st-serpent-draw{stroke-width:2.2;opacity:.7;filter:drop-shadow(0 0 4px color-mix(in srgb,var(--st-pencil) 60%,transparent))}
.st-score svg .st-serpent-head{fill:var(--st-pencil);opacity:0;filter:drop-shadow(0 0 7px var(--st-pencil))}
.st-serpent-head[data-on=true]{opacity:1}

/* bars: hit areas, selection wash, pencil marks */
.st-overlay{position:absolute;inset:0;pointer-events:none}
.st-bar{position:absolute;pointer-events:auto;cursor:pointer;border-radius:6px;background:transparent;border:0;padding:0;transition:background .15s}
.st-bar:hover{background:var(--st-pencil-faint)}
.st-bar[data-selected=true]{background:color-mix(in srgb,var(--st-pencil) 17%,transparent);box-shadow:inset 0 2px 0 var(--st-pencil),inset 0 -2px 0 var(--st-pencil)}
.st-bar[data-busy=true]{animation:st-breathe 1.6s ease-in-out infinite}
@keyframes st-breathe{0%,100%{background:var(--st-pencil-faint)}50%{background:var(--st-pencil-soft)}}
.st-mark{position:absolute;pointer-events:none}
.st-note{position:absolute;pointer-events:none;font-family:'Stave Pencil',cursive;font-size:15px;line-height:1.1;color:var(--st-pencil);white-space:nowrap;transform:rotate(-1.5deg);transform-origin:left bottom;opacity:0;animation:st-ink .5s var(--st-ease) forwards;animation-delay:var(--st-delay,0ms)}
.st-note[data-kind=fixed],.st-note[data-kind=changed]{font-size:14px}
@keyframes st-ink{from{opacity:0;transform:rotate(-1.5deg) translateY(4px)}to{opacity:1;transform:rotate(-1.5deg)}}
.st-writing{position:absolute;font-family:'Stave Pencil',cursive;font-size:17px;color:var(--st-pencil);display:flex;align-items:center;gap:8px}
.st-writing i{display:inline-block;width:22px;height:2px;border-radius:2px;background:var(--st-pencil);transform-origin:left;animation:st-scribble 1.1s ease-in-out infinite}
@keyframes st-scribble{0%{transform:scaleX(.2)}50%{transform:scaleX(1)}100%{transform:scaleX(.2)}}

/* ── empty state: one staff, a ghost motif swimming on, the ask below ─ */
.st-ghost{width:100%}
.st-ghost svg{display:block;overflow:visible}
.st-ghost svg path,.st-ghost svg text{fill:var(--st-ink)}
.st-ghost svg .abcjs-note path,.st-ghost svg .abcjs-note,.st-ghost svg .abcjs-rest,.st-ghost svg .abcjs-beam-elem,.st-ghost svg .abcjs-chord{opacity:.32}
.st-ghost svg .abcjs-chord{font-family:'Stave Bodoni',serif;font-weight:600}
.st-ghost svg .st-slither{animation-duration:.9s}
.st-ghost svg{clip-path:inset(-40px 100% -40px 0);animation:st-wipe 1.4s cubic-bezier(.45,.05,.35,1) .1s forwards}
@keyframes st-wipe{to{clip-path:inset(-40px 0 -40px 0)}}
.st-empty[data-planning=true] .st-ghost{opacity:.35;transition:opacity .6s}
.st-plan{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:34px}
.st-plan .st-note{font-size:21px}
.st-plan small{font-size:14px;opacity:.65;margin-left:4px}
.st-empty>.st-ask{width:min(820px,100%)}
.st-empty{min-height:100%;display:grid;align-content:center;justify-items:center;gap:30px;padding:40px 0 60px}
.st-empty h2{font-family:'Stave Bodoni',serif;font-style:italic;font-weight:500;font-size:clamp(28px,3.4vw,44px);letter-spacing:-.02em;margin:0;text-align:center}
.st-empty-staff{position:relative;width:min(980px,100%)}
.st-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:10px 22px;max-width:820px}
.st-chip{font-family:'Stave Pencil',cursive;font-size:17px;color:var(--st-ink-2);background:none;border:0;padding:2px 2px;cursor:pointer;position:relative;transition:color .15s}
.st-chip:hover{color:var(--st-pencil)}
.st-chip::after{content:'';position:absolute;left:0;right:0;bottom:0;height:1.5px;background:currentColor;transform:scaleX(0);transform-origin:left;transition:transform .3s var(--st-ease)}
.st-chip:hover::after{transform:scaleX(1)}

/* ── the ask field ──────────────────────────────────── */
.st-foot{padding:10px clamp(20px,4vw,56px) 18px}
.st-ask{position:relative;max-width:1180px;margin:0 auto;display:flex;align-items:center;gap:8px;min-height:50px;padding:6px 6px 6px 14px;border-radius:14px;background:var(--ui-bg-secondary,var(--ui-surface-background));border:1px solid var(--st-rule);transition:border-color .2s,box-shadow .2s}
.st-ask:focus-within{border-color:color-mix(in srgb,var(--st-pencil) 55%,var(--st-rule));box-shadow:0 0 0 4px var(--st-pencil-faint)}
.st-ask[data-big=true]{min-height:62px;border-radius:16px;padding-left:20px;background:var(--st-ground)}
.st-ask input{flex:1;min-width:0;height:36px;border:0;outline:0;background:transparent;color:var(--st-ink);font:inherit;font-size:14.5px;caret-color:var(--st-pencil)}
.st-ask[data-big=true] input{font-family:'Stave Bodoni',serif;font-style:italic;font-size:21px}
.st-ask input::placeholder{color:var(--st-ink-3)}
.st-scope{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 4px 0 10px;border-radius:8px;background:var(--st-pencil-soft);color:var(--st-pencil);font-size:12.5px;font-weight:500;white-space:nowrap}
.st-scope button{display:grid;place-items:center;width:20px;height:20px;border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer}
.st-scope button:hover{background:var(--st-pencil-soft)}
.st-scope svg{width:12px;height:12px}
.st-send{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;border:0;background:var(--st-pencil);color:var(--ui-bg,#fff);cursor:pointer;flex-shrink:0;transition:transform .15s var(--st-ease),opacity .15s}
.st-send:hover{transform:translateY(-1px)}
.st-send:disabled{opacity:.3;cursor:default;transform:none}
.st-send svg{width:17px;height:17px}
.st-status{display:flex;align-items:center;gap:10px;flex:1;min-width:0;font-size:13.5px;color:var(--st-ink-2)}
.st-status em{font-family:'Stave Pencil',cursive;font-style:normal;font-size:16px;color:var(--st-pencil)}
.st-status .st-steps{display:flex;gap:4px;margin-left:auto}
.st-status .st-steps i{width:18px;height:3px;border-radius:2px;background:color-mix(in srgb,var(--st-ink) 14%,transparent);transition:background .3s}
.st-status .st-steps i[data-done=true]{background:var(--st-pencil)}
.st-status .st-steps i[data-now=true]{background:color-mix(in srgb,var(--st-pencil) 50%,transparent);animation:st-pulse 1s ease-in-out infinite}
@keyframes st-pulse{50%{opacity:.4}}
.st-error{max-width:1180px;margin:0 auto 8px;font-family:'Stave Pencil',cursive;font-size:15px;color:var(--ui-red);display:flex;gap:12px;align-items:baseline}
.st-error button{font:inherit;font-family:var(--font-sans);font-size:12.5px;color:var(--st-ink-2);background:none;border:0;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.st-hint{max-width:1180px;margin:0 auto 8px;font-size:12px;color:var(--st-ink-3);display:flex;gap:16px}
.st-hint kbd{font-family:var(--font-mono);font-size:11px;padding:1px 5px;border-radius:4px;border:1px solid var(--st-rule);color:var(--st-ink-3)}

/* ── pieces & export menus ──────────────────────────── */
.st-menu{width:320px;max-height:min(460px,70vh);overflow:auto;padding:6px}
.st-menu-head{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 8px;font-size:12px;color:var(--st-ink-3)}
.st-piece{display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 8px;width:100%;padding:8px 8px;border-radius:8px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}
.st-piece:hover{background:var(--ui-row-hover-background)}
.st-piece[data-current=true]{background:var(--ui-row-active-background)}
.st-piece-title{font-family:'Stave Bodoni',serif;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st-piece-sub{grid-column:1;font-size:11.5px;color:var(--st-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st-piece-del{grid-row:1/span 2;grid-column:2;opacity:0}
.st-piece:hover .st-piece-del{opacity:1}
.st-menu-item{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:8px;border:0;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.st-menu-item:hover{background:var(--ui-row-hover-background)}
.st-menu-item svg{width:16px;height:16px;color:var(--st-ink-3)}
.st-menu-item small{margin-left:auto;font-size:11.5px;color:var(--st-ink-4)}
.st-menu-note{padding:10px 10px 6px;margin-top:6px;border-top:1px solid var(--st-rule);font-size:12px;line-height:1.45;color:var(--st-ink-3)}
.st-menu-note b{font-weight:500;color:var(--st-ink-2)}
.st-menu-empty{padding:18px 10px;font-family:'Stave Pencil',cursive;font-size:15px;color:var(--st-ink-3);text-align:center}

@keyframes st-spin{to{transform:rotate(360deg)}}

/* The page column, not the window, decides: Desktop's sidebars take their share first. */
@container stave (max-width:1080px){
  .st-scrub{display:none}
  .st-tools .st-iconbtn .st-label{display:none}
}
@container stave (max-width:860px){
  .st-head{flex-wrap:wrap;align-items:center;row-gap:14px}
  .st-titles{flex-basis:100%}
  .st-tools{flex:1;justify-content:flex-start}
  .st-transport{margin-left:auto}
  .st-hint{display:none}
}
@media (prefers-reduced-motion:reduce){
  .st-score svg .st-slither,.st-ghost svg .st-slither,.st-note,.st-ghost svg{animation:none!important;opacity:1;clip-path:none}
  .st-serpent-body,.st-serpent-head,.st-serpent-draw{display:none}
  .st-bar[data-busy=true]{animation:none;background:var(--st-pencil-soft)}
}
`
