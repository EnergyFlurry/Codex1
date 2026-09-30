# Rainy Window

A realistic rain-on-the-window simulation for the browser, with ambient rain sounds, thunder and calming generative music.

## Run it

It's a static site with no build step and no dependencies:

- Open `index.html` directly in a browser, **or**
- Serve the folder: `python3 -m http.server` and visit <http://localhost:8000>.

Click **Start with sound** (browsers only allow audio after a click).

## What's simulated

- **Water on the glass.** Drops land, sit, merge with their neighbours and, once heavy enough, slide down in a stick-slip motion. Running drops stretch into teardrops, sweep up the droplets in their path and leave a trail of beads behind them.
- **Condensation and fog.** Fine droplets build up across the pane and slowly evaporate. The "Window fog" slider sets how misted the glass is, from clear to fully fogged. Running drops wipe clear channels through the mist, and it slowly creeps back.
- **Optics.** The glass is stored as a height map, and a WebGL shader turns it into surface normals. Each drop acts as a lens that shows a sharp, upside-down view of the out-of-focus scene behind it, with dark rims and specular glints.
- **Outside.** There are three hand-painted procedural scenes: City at night (with moving traffic), Misty forest and Harbor at dusk (with bobbing boats and a lighthouse). Rain falls in the distance, and lightning flashes are followed by thunder whose delay depends on how far away the strike is.
- **Sound.** Everything is synthesized live with the Web Audio API: layered rain noise with gusts, drops tapping the pane (some synced to drops landing on screen), drips, rolling thunder, and a slow ambient piece of pad chords and a sparse piano-like melody through reverb.

## Controls

- **Settings** (the gear button or `S`): rain intensity, drop size, condensation, window fog, thunderstorm frequency, scene, depth of field, refraction, brightness, window frame, quality, and separate volume sliders for master, rain, music and thunder. Settings are saved in your browser.
- **Drag on the glass** to wipe it with your finger or cursor.
- `M` mutes the sound, `F` toggles fullscreen, `Space` pauses the rain and `H` hides the UI.

## Files

| File | Purpose |
| --- | --- |
| `js/simulation.js` | Drop physics, condensation and fog layers (2D canvas height map) |
| `js/renderer.js` | WebGL refraction, blur, bokeh, fog and lightning shader |
| `js/scenes.js` | Procedurally painted backdrops and animated lights |
| `js/audio.js` | Procedural rain, thunder and music |
| `js/app.js` | Settings panel, render loop, input |
