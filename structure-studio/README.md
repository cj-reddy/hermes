# Structure Studio

A clean, browser-based 3D house and furniture planner built with Three.js.

## Features

- Draw complete rectangular rooms or individual walls on a 0.25 m grid
- Add wall-hosted doors and windows with real wall cutouts that follow their wall, plus sofas, beds, tables, chairs, cabinets, and plants
- Select, move, rotate, resize, recolor, duplicate, and delete objects
- Toggle between perspective and true top-down plan views
- Orbit, pan, zoom, fit to view, and show transparent walls
- Undo and redo project changes
- Autosave designs to browser storage
- Import/export portable JSON project files
- Export PNG snapshots
- Responsive desktop, tablet, and mobile interface with all authoring controls available
- Keyboard-accessible object picker; arrow keys move the selection and `Shift` + arrows rotate it
- Bounded projects: at most 500 objects, 200 walls, 100 openings, and 16 non-overlapping openings per wall

## Local development

```bash
cd structure-studio
npm test
npm run serve
```

Then open `http://127.0.0.1:8765/structure-studio/`.

The app is static and vendors pinned Three.js modules locally, so it requires no build step or runtime script CDN.
