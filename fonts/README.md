# Laurevine Plum — Font Catalogue

This folder contains bundled OpenType (`.otf`) and TrueType (`.ttf`) fonts available to XeLaTeX and LuaLaTeX without requiring system installation.

## Adding Fonts

1. **Formats:** OpenType (`.otf`) and TrueType (`.ttf`).
2. **Placement:** Put font files in a subfolder named after the family (e.g. `fonts/my-font/`) or directly inside `fonts/`.
3. **Naming:**
   - **Variable fonts:** `Family[wght].ttf`, `Family-Italic[wght].ttf`
   - **Static styles:** `Family-Regular.ttf`, `Family-Bold.ttf`, `Family-Italic.ttf`, `Family-BoldItalic.ttf`
4. **Catalogue & Discovery:**
   - The compile server automatically scans `fonts/` for font files, derives family names, weight ranges, and italics, and supplies them to the editor font picker and compile jobs.
   - `fonts/fonts.css` is optional; if present, its `@font-face` rules are loaded, but bundled fonts are discovered from the files themselves even without it.
5. **After adding fonts:** Restart the compile server (`node server/server.js`) and reload the editor so the catalogue refreshes in the ribbon and compiler registry.
