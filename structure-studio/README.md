# Structure Studio

A clean, browser-based 3D house and furniture planner built with Three.js.

## Features

- Draw complete rectangular rooms or individual walls on a 0.25 m grid
- Add doors, windows, sofas, beds, tables, chairs, cabinets, and plants
- Select, move, rotate, resize, recolor, duplicate, and delete objects
- Toggle between perspective and true top-down plan views
- Orbit, pan, zoom, fit to view, and show transparent walls
- Undo and redo project changes
- Autosave designs to browser storage
- Import/export portable JSON project files
- Export PNG snapshots
- Responsive desktop/tablet interface

## Local development

```bash
cd structure-studio
npm test
npm run serve
```

Then open `http://127.0.0.1:8765/structure-studio/`.

The app is static and uses an import map to load Three.js from jsDelivr, so it requires no build step.
