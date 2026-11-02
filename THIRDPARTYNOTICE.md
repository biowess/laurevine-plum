# Third-Party Notices

Laurevine Plum is licensed under the Apache License 2.0 (see `LICENSE.txt`). This repository and the packaged application bundle the third-party software and assets listed below, each governed by its own license. Components that are not bundled (external CDNs, TeX distributions, Python runtimes) are listed only in section 5 for transparency.

---

## 1. JavaScript Libraries

### PDF.js (v3.11.174)
- **Path:** `js/vendor/pdf.min.js`, `js/vendor/pdf.worker.min.js`
- **License:** Apache License 2.0
- **Notice:** Copyright 2023 Mozilla Foundation and individual contributors. Full license text: [js/vendor/pdfjs-LICENSE.txt](js/vendor/pdfjs-LICENSE.txt).

### Lucide Icons (embedded geometry subset)
- **Path:** `js/icons-fallback.js`
- **License:** ISC License (Lucide), with portions under the MIT License (Feather)
- **Notice:** Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022 (https://lucide.dev).
- **License Text (ISC, Lucide):**
  ```text
  ISC License

  Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
  All other copyright (c) for Lucide are held by Lucide Contributors 2022.

  Permission to use, copy, modify, and/or distribute this software for any
  purpose with or without fee is hereby granted, provided that the above
  copyright notice and this permission notice appear in all copies.

  THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
  WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
  MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
  ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
  WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
  ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
  OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
  ```
- **License Text (MIT, Feather portions):**
  ```text
  MIT License

  Copyright (c) 2013-2022 Cole Bemis

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
  ```

---

## 2. Application Runtime

### Electron
- **Used for:** the desktop shell of every packaged build (Windows and Linux), added by electron-builder at packaging time (version per `package.json`).
- **License:** MIT License
- **Notice:** Copyright (c) Electron contributors. Copyright (c) 2013-2020 GitHub Inc. (https://www.electronjs.org)
- **License Text:**
  ```text
  MIT License

  Copyright (c) Electron contributors
  Copyright (c) 2013-2020 GitHub Inc.

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
  ```
- **Bundled with Electron:** Chromium, Node.js, V8, FFmpeg and other components under their own licenses (BSD, MIT, Apache 2.0, LGPL and others). Their texts ship with every Electron distribution as `LICENSE.electron.txt` and `LICENSES.chromium.html` next to the application executable. These two files must be kept in every package and installer (do not strip them from builds).

---

## 3. Bundled Fonts

All fonts in `fonts/` are redistributed unmodified under their upstream licenses. The license text accompanies each font in its own folder (`OFL.txt` or `LICENSE.txt`).

### SIL Open Font License, Version 1.1 (OFL-1.1)
The following fonts are licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/):

- **Amiri**: Copyright 2010-2022 The Amiri Project Authors (`fonts/amiri/OFL.txt`)
- **Arimo**: Copyright 2026 The Arimo Project Authors (`fonts/arimo/OFL.txt`)
- **Bitter**: Copyright 2011 The Bitter Project Authors (`fonts/bitter/OFL.txt`)
- **Cairo**: Copyright 2009 The Cairo Project Authors (`fonts/cairo/OFL.txt`)
- **Caveat**: Copyright 2014 The Caveat Project Authors (`fonts/caveat/OFL.txt`)
- **Cinzel**: Copyright 2020 The Cinzel Project Authors (`fonts/cinzel/OFL.txt`)
- **Cormorant Garamond**: Copyright 2015 The Cormorant Project Authors (`fonts/cormorant-garamond/OFL.txt`)
- **EB Garamond**: Copyright 2017 The EB Garamond Project Authors (`fonts/eb-garamond/OFL.txt`)
- **Fira Code**: Copyright 2014-2020 The Fira Code Project Authors (`fonts/fira-code/OFL.txt`)
- **Fira Sans**: Copyright 2012-2015 The Mozilla Foundation and Telefonica S.A. (`fonts/fira-sans/OFL.txt`)
- **Inconsolata**: Copyright 2006 The Inconsolata Project Authors (`fonts/inconsolata/OFL.txt`)
- **Inter**: Copyright 2020 The Inter Project Authors (`fonts/inter/OFL.txt`)
- **JetBrains Mono**: Copyright 2020 The JetBrains Mono Project Authors (`fonts/jetbrains-mono/OFL.txt`)
- **Lato**: Copyright 2010-2014 tyPoland Lukasz Dziedzic (`fonts/lato/OFL.txt`)
- **Libre Baskerville**: Copyright 2012 The Libre Baskerville Project Authors (`fonts/libre-baskerville/OFL.txt`)
- **Lora**: Copyright 2011 The Lora Project Authors (`fonts/lora/OFL.txt`)
- **Merriweather**: Copyright 2020 The Merriweather Project Authors (`fonts/merriweather/OFL.txt`)
- **Montserrat**: Copyright 2024 The Montserrat.Git Project Authors (`fonts/montserrat/OFL.txt`)
- **Noto Sans Arabic**: Copyright 2022 The Noto Project Authors (`fonts/noto-sans-arabic/OFL.txt`)
- **OpenDyslexic**: Copyright 2019 Abbie Gonzalez (`fonts/open-dyslexic/OFL.txt`)
- **Open Sans**: Copyright 2020 The Open Sans Project Authors (`fonts/open-sans/OFL.txt`)
- **Oswald**: Copyright 2016 The Oswald Project Authors (`fonts/oswald/OFL.txt`)
- **Outfit**: Copyright 2021 The Outfit Project Authors (`fonts/outfit/OFL.txt`)
- **Pacifico**: Copyright 2018 The Pacifico Project Authors (`fonts/pacifico/OFL.txt`)
- **Playfair Display**: Copyright 2017 The Playfair Display Project Authors (`fonts/playfair-display/OFL.txt`)
- **Plus Jakarta Sans**: Copyright 2020 The Plus Jakarta Sans Project Authors (`fonts/plus-jakarta-sans/OFL.txt`)
- **Poppins**: Copyright 2020 The Poppins Project Authors (`fonts/poppins/OFL.txt`)
- **PT Serif**: Copyright 2010 ParaType Ltd. (`fonts/pt-serif/OFL.txt`)
- **Raleway**: Copyright 2010 The Raleway Project Authors (`fonts/raleway/OFL.txt`)
- **Roboto**: Copyright 2011 The Roboto Project Authors (`fonts/roboto/OFL.txt`)
- **Scheherazade New**: Copyright 1994-2026 SIL Global (`fonts/scheherazade-new/OFL.txt`)
- **Source Code Pro**: Copyright 2010, 2012 Adobe Systems Incorporated (`fonts/source-code-pro/OFL.txt`)
- **Source Sans 3**: Copyright 2010-2020 Adobe (`fonts/source-sans-3/OFL.txt`)
- **Space Grotesk**: Copyright 2020 The Space Grotesk Project Authors (`fonts/space-grotesk/OFL.txt`)
- **Space Mono**: Copyright 2016 The Space Mono Project Authors (`fonts/space-mono/OFL.txt`)
- **Spline Sans**: Copyright 2021 The Spline Sans Project Authors (`fonts/spline-sans/OFL.txt`)
- **Tajawal**: Copyright 2018 Boutros International (`fonts/tajawal/OFL.txt`)

### GUST Font License (TeX Gyre fonts)
The TeX Gyre fonts are released by the GUST e-foundry under the [GUST Font License](http://tug.org/fonts/licenses/GUST-FONT-LICENSE.txt) (GFL), which is an instance of the LaTeX Project Public License (LPPL) version 1.3c or later. The GFL text is included in each font folder as `GUST-FONT-LICENSE.txt`, together with the LPPL 1.3c text as `LICENSE.txt`. Under this license the fonts may be used, copied and redistributed freely, provided the license and copyright notices stay with them; derived fonts should be renamed (requested by the GFL, not legally required).

- **TeX Gyre Termes** v2.004: Copyright 2006, 2009 B. Jackowski and J.M. Nowacki (on behalf of TeX users groups) (`fonts/tex-gyre-termes/`)
- **TeX Gyre Pagella** v2.501: Copyright 2006-2018 B. Jackowski, J.M. Nowacki, et al. (on behalf of TeX users groups); Vietnamese characters added by Han The Thanh (`fonts/tex-gyre-pagella/`)
- **TeX Gyre Heros** and **TeX Gyre Heros Cn** v2.004: Copyright 2006, 2009 B. Jackowski and J.M. Nowacki (on behalf of TeX users groups) (`fonts/tex-gyre-heros/`)

---

## 4. Project Assets

The application icons and artwork in `assets/` (`appicon.png`, `icon.svg`, `splash.png`, `splash.html`, `wizard-bg.png`), `build/icons/`, the document templates and sample figures in `templates/`, and the in-app documentation in `docs/` are original works of BIOWESS, Copyright 2026 BIOWESS, licensed under the Apache License 2.0 (`LICENSE.txt`). The names and logos remain subject to `TRADEMARK.md`. The application source code is likewise Copyright 2026 BIOWESS under the Apache License 2.0.

---

## 5. Not Bundled

These are loaded or used at run time and are not redistributed with the application. Their own licenses apply:

- **Lucide 0.469.0** (ISC / MIT), loaded from the unpkg CDN when online; section 1 covers the offline subset.
- **KaTeX 0.16.11** (MIT, Copyright (c) 2013-2020 Khan Academy and other contributors), loaded from the jsDelivr CDN when online, together with its own KaTeX fonts.
- **TeX distribution / XeLaTeX / LuaLaTeX, Python and Matplotlib**, installed separately by the user and called as external programs.
- **electron-builder** and the installer or AppImage runtime components it adds, build-time tooling only.