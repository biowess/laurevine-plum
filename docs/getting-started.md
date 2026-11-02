# Getting Started

A walkthrough from first launch to a finished PDF. It takes about ten minutes.

## 1. Start the app

1. Install a TeX distribution (TeX Live, MacTeX or MiKTeX) so `xelatex` is available on your PATH.
2. In the project folder run `node server/server.js` (no `npm install` needed).
3. Open `http://localhost:5174` in Chrome, Edge or another Chromium browser.

> **Tip:** opening `index.html` directly shows the interface, but **Compile** will report that it can't reach the compile server.

## 2. Create or open a project

The Welcome panel offers three starting points:

- **New document**: a blank scratch document.
- **Open folder**: pick a folder of `.tex` files. The first `.tex` file at its top level opens automatically.
- **New from template**: Homework, Academic Article, Laboratory Report, Research Manuscript, Book or Sample Article.

A folder gives you the most: figures, bibliographies and multi-file documents all work, and **Save** writes back to disk. Reopen recent projects from the same panel.

## 3. Know the screen

- **Ribbon** (top): tabs of buttons. Home for formatting, Insert for tables, figures and equations, References for citations.
- **Sidebar** (left): your files, and an outline of your headings. Click a heading to jump to it.
- **Source pane** (middle): your LaTeX.
- **PDF pane** (right): the compiled result.

## 4. Write something

Type directly, or let the ribbon do it. Select some text and press **Bold** on Home: it becomes `\textbf{…}`. Pick **Section** in the Styles gallery and a `\section{…}` appears. Every action edits ordinary LaTeX you can read and change.

A minimal document looks like this:

```latex
% !TEX program = xelatex
\documentclass{article}
\begin{document}
\section{Introduction}
Hello, \LaTeX!
\end{document}
```

## 5. Compile

Press **Compile** or Ctrl/⌘ + Enter. The PDF appears on the right. If something is wrong, the Problems panel lists each error: click a row to jump to the line, fix the **first** error, and compile again. See [LaTeX Basics](latex-basics.md) for common causes.

Turn on **Auto-compile after pause** in Preferences to rebuild whenever you stop typing.

## 6. Save and export

- **Save** with Ctrl/⌘ + S. Without folder access, the app downloads a `.tex` file instead.
- **Export PDF**, **Export Project ZIP** or **Export single .tex** from the File menu.
- Unsaved work is recovered after a crash: you'll be asked to *Restore* or *Discard* it on the next launch.

## Quick tour of useful features

| I want to… | Go to |
| ---------- | ----- |
| Change fonts, colours or heading style for the whole document | Design tab |
| Set margins, paper size or columns | Layout tab |
| Add a table | Insert ▸ Table |
| Add an image with a caption | Insert ▸ Figure |
| Write a formula visually | Insert ▸ Equation Editor |
| Draw a flowchart (exported as TikZ) | Insert ▸ Flow Diagram |
| Plot data | Insert ▸ Chart (needs Python 3 and Matplotlib) |
| Add a table of contents | Insert or References ▸ Table of Contents |
| Cite a source | References ▸ Insert Citation (add sources first with Manage Sources or Import references) |
| Refer to a figure or equation | References ▸ Insert Label, then Cross-reference |
| Find and replace | Home ▸ Find, or Ctrl/⌘ + F |
| Count words | Review ▸ Word Count |
| Leave a note for yourself or a co-author | Review ▸ New Comment |
| See what you changed | Review ▸ Track Changes or Compare |
| Switch to dark mode | View ▸ Dark Mode |
| Find any command quickly | Ctrl/⌘ + K |

## Habits that save time

- **Compile early and often.** Small changes make errors easy to spot.
- Keep **figures** in a `figures/` folder; the Picture, Figure, Chart and Flow Diagram tools use it.
- Leave `%lp` comments that the app adds to paragraph commands. They let it adjust them later.
- Use **labels and cross-references** rather than typing figure or section numbers by hand.
- Put `% !TEX program = xelatex` (or `lualatex`, `pdflatex`) on the first line to choose the engine for that file.
- Use **Undo** freely: ribbon actions, dialogs and Replace All are all undoable.

## If something goes wrong

- **Could not reach the compile server:** start `node server/server.js` and use the address it prints.
- **Compiler not found:** install TeX Live, MacTeX or MiKTeX and make sure `xelatex` is on your PATH, then restart the server.
- **File not found (package):** install the missing package with your TeX distribution's package manager.
- **Folder won't open:** use a Chromium-based browser.

More fixes are under **Help ▸ Troubleshooting**.

## Where to go next

- The [Documentation](documentation.md) covers every part of the app in depth.
- [LaTeX Basics](latex-basics.md) teaches the language itself.
- **Help ▸ Package Reference** and **Help ▸ Keyboard Shortcuts** are searchable.
