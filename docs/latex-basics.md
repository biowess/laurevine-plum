# LaTeX Basics

LaTeX turns a plain-text file into a typeset PDF. You describe **structure** (title, sections, lists, equations) and LaTeX handles layout. This page covers what you need for most documents. Laurevine Plum inserts much of this for you, but you can always type it yourself.

## The building blocks

- **Commands** start with a backslash: `\textbf{bold}`, `\section{Intro}`.
- **Arguments** go in braces `{ }` (required) or square brackets `[ ]` (optional): `\documentclass[12pt]{article}`.
- **Environments** wrap content: `\begin{itemize} … \end{itemize}`.
- **Packages** add features: `\usepackage{graphicx}`.
- **Comments** start with `%` and run to the end of the line.
- **Groups** `{ … }` limit the reach of a change, for example `{\large big text} normal text`.

## A complete minimal file

```latex
% !TEX program = xelatex
\documentclass[11pt]{article}

\usepackage{fontspec}
\usepackage{amsmath}
\usepackage{graphicx}

\title{My First Document}
\author{Your Name}
\date{\today}

\begin{document}
\maketitle

\section{Introduction}
Some text with \emph{emphasis} and \textbf{bold}.

\end{document}
```

Everything before `\begin{document}` is the **preamble** (settings and packages). Everything between `\begin` and `\end{document}` is the **body**. Text after `\end{document}` is ignored.

## Document classes

| Class | Use for |
| ----- | ------- |
| `article` | Papers, homework, short reports |
| `report` | Longer reports with chapters |
| `book` | Books with front/back matter |
| `beamer` | Slides |
| `letter` | Letters |

Common options: `11pt`, `12pt`, `a4paper`, `letterpaper`, `twocolumn`, `twoside`, `draft`.

## Text and spacing

- A **blank line** starts a new paragraph. A single line break is just a space.
- `\\` forces a line break; `\newpage` starts a new page; `\vspace{1cm}` adds vertical space.
- Quotes: `` `single' `` and ` ``double'' ` (not the straight `"`).
- Dashes: `-` hyphen, `--` range (pages 1--5), `---` sentence dash.
- These characters are special and must be escaped: `\# \$ \% \& \_ \{ \}`. Write `\textbackslash` for a backslash.
- Several spaces count as one. Use `~` for a non-breaking space (`Figure~\ref{fig:a}`) and `\ ` after an abbreviation if needed.

## Text formatting

| You want | Write |
| -------- | ----- |
| **Bold** | `\textbf{text}` |
| *Italic* | `\textit{text}` or `\emph{text}` |
| Underline | `\underline{text}` |
| Strikethrough | `\sout{text}` (needs `ulem`) |
| Monospace | `\texttt{text}` |
| Small caps | `\textsc{text}` |
| Colour | `\textcolor{red}{text}` (needs `xcolor`) |
| Superscript / subscript | `\textsuperscript{2}` / `\textsubscript{2}` |

Sizes, smallest to largest: `\tiny \scriptsize \footnotesize \small \normalsize \large \Large \LARGE \huge \Huge`. Use `\emph` for meaning; use `\textit` for pure style.

## Sections and structure

```latex
\section{Methods}
\subsection{Participants}
\subsubsection{Recruitment}
\paragraph{Note.} A run-in heading.
```

- `\chapter` and `\part` exist only in `report` and `book`.
- Add a star to drop the number: `\section*{Acknowledgements}`.
- `\tableofcontents` builds a contents page, `\appendix` switches to appendix numbering, and `\listoffigures` / `\listoftables` list your floats.
- Contents and references need **two passes**; the app does this automatically.

## Lists

```latex
\begin{itemize}
  \item A bullet
  \item Another, with a nested list:
    \begin{enumerate}
      \item First
      \item Second
    \end{enumerate}
\end{itemize}

\begin{description}
  \item[Term] Its definition.
\end{description}
```

`enumerate` numbers items. Lists can nest up to four levels deep. The `enumitem` package customises spacing and labels.

## Mathematics

Load `amsmath` for anything beyond trivial formulas.

```latex
Inline: $E = mc^2$.

Display:
\[
  \int_0^1 x^2 \, dx = \frac{1}{3}
\]

Numbered and aligned:
\begin{align}
  a &= b + c \label{eq:first} \\
  d &= e + f
\end{align}
```

| You want | Write |
| -------- | ----- |
| Fraction | `\frac{a}{b}` |
| Square root | `\sqrt{x}`, `\sqrt[3]{x}` |
| Powers and indices | `x^2`, `x_i`, `x_{i+1}^{2}` |
| Sum / integral | `\sum_{i=1}^{n}`, `\int_a^b` |
| Greek | `\alpha \beta \gamma \Delta \Omega` |
| Relations | `\leq \geq \neq \approx \equiv` |
| Arrows | `\to \Rightarrow \leftrightarrow` |
| Sets | `\in \subset \cup \cap \mathbb{R}` |
| Text in math | `\text{if } x > 0` |
| Scalable brackets | `\left( \frac{a}{b} \right)` |

Use `align` for multi-line equations (not `eqnarray`), `equation*` or `\[ \]` for unnumbered ones, and `\eqref{eq:first}` to cite a numbered equation. Wrap multi-letter operators in `\operatorname{name}`. In XeLaTeX, Unicode characters such as `α` also work in text.

## Tables

```latex
\begin{table}[ht]
  \centering
  \caption{Results}\label{tab:results}
  \begin{tabular}{lcr}
    \toprule
    Name & Value & Unit \\
    \midrule
    Mass & 5.2 & kg \\
    Length & 1.8 & m \\
    \bottomrule
  \end{tabular}
\end{table}
```

- Column letters: `l` left, `c` centre, `r` right, `p{3cm}` fixed-width wrapped text, `|` vertical line.
- `&` separates cells and `\\` ends a row.
- `\toprule`, `\midrule`, `\bottomrule` need `booktabs` and look better than `\hline`.
- `multirow`, `tabularx` and `longtable` handle merged cells, full-width tables and tables across pages.

## Figures

```latex
\begin{figure}[ht]
  \centering
  \includegraphics[width=0.8\textwidth]{figures/plot.png}
  \caption{A descriptive caption.}\label{fig:plot}
\end{figure}
```

- Load `graphicx`. Supported images: PNG, JPEG and PDF. Convert SVG first.
- **Placement** letters: `h` here, `t` top, `b` bottom, `p` separate page, `!` override. LaTeX may still move floats; that is normal.
- Put `\label` **after** `\caption`, or numbers will be wrong.
- Side-by-side figures: use `subcaption`.

## Cross-references and footnotes

```latex
See Section~\ref{sec:methods}, Figure~\ref{fig:plot} and Eq.~\eqref{eq:first}.
\section{Methods}\label{sec:methods}
Some text.\footnote{A footnote appears at the page bottom.}
```

Use consistent label prefixes (`sec:`, `fig:`, `tab:`, `eq:`). References show `??` until the second pass. `hyperref` makes them clickable; `cleveref` adds automatic names (`\cref`).

## Citations and bibliographies

Store sources in a `.bib` file:

```bibtex
@article{knuth1984,
  author  = {Donald E. Knuth},
  title   = {Literate Programming},
  journal = {The Computer Journal},
  year    = {1984},
  volume  = {27},
  number  = {2},
  pages   = {97--111}
}
```

Then cite and print them in one of two systems:

| System | In the preamble | In the text | At the end |
| ------ | --------------- | ----------- | ---------- |
| BibTeX + natbib | `\usepackage{natbib}` | `\citep{key}`, `\citet{key}` | `\bibliographystyle{plainnat}` and `\bibliography{refs}` |
| biblatex + Biber | `\usepackage[style=apa]{biblatex}` and `\addbibresource{refs.bib}` | `\cite{key}`, `\textcite{key}` | `\printbibliography` |

Do not mix the two systems in one document. Laurevine Plum detects which one you use and runs the right tool when you compile.

## Page layout

```latex
\usepackage[margin=2.5cm, a4paper]{geometry}
\usepackage{setspace}   \onehalfspacing
\usepackage{parskip}    % paragraph spacing instead of indents
\usepackage{fancyhdr}   \pagestyle{fancy}
```

- `geometry` controls margins, paper size and orientation.
- `setspace` provides `\singlespacing`, `\onehalfspacing` and `\doublespacing`.
- `fancyhdr` builds headers and footers; `multicol` gives `\begin{multicols}{2}`.
- `titlesec` restyles headings.

## Fonts, colours and Unicode (XeLaTeX)

```latex
\usepackage{fontspec}
\setmainfont{Libertinus Serif}
\setsansfont{Latin Modern Sans}
\setmonofont{Latin Modern Mono}
```

- `fontspec` works with XeLaTeX and LuaLaTeX only, not `pdflatex`. It lets you use any installed font and type Unicode directly.
- If a font is not found, check its exact family name or choose one from the font menu.
- `\usepackage{xcolor}` adds colours: `\definecolor{brand}{HTML}{50466F}`, then `\textcolor{brand}{text}`.
- With `pdflatex` instead, use `\usepackage[T1]{fontenc}` and `\usepackage[utf8]{inputenc}`.

## Useful packages

| Package | Purpose |
| ------- | ------- |
| `amsmath`, `amssymb`, `amsthm` | Math, symbols, theorems |
| `graphicx` | Images |
| `booktabs`, `tabularx`, `longtable` | Better and longer tables |
| `hyperref` | Links and PDF bookmarks (load last in most cases) |
| `geometry` | Page size and margins |
| `biblatex` or `natbib` | Citations |
| `listings` | Source code listings |
| `tikz`, `pgfplots` | Diagrams and plots |
| `siunitx` | Numbers and units: `\SI{9.81}{\meter\per\second\squared}` |
| `enumitem` | List customisation |
| `caption`, `subcaption` | Caption styles, sub-figures |
| `microtype` | Subtle typographic polish |

Browse about a hundred more in **Help ▸ Package Reference**.

## Reading errors

Look at the **first** error only; later ones are often side effects. Errors start with `!` and the next line shows `l.<number>`, the source line.

| Message | Usual cause |
| ------- | ----------- |
| `Undefined control sequence` | Typo, or the package that defines the command is not loaded |
| `Missing $ inserted` | Math symbol (`_`, `^`, `\alpha`) used outside math mode |
| `Missing } inserted` or `Runaway argument` | Unbalanced braces |
| `File ended while scanning` | A `{` or `\begin` was never closed |
| `\begin{x} ended by \end{y}` | Mismatched environment names |
| `Environment x undefined` | Missing package for that environment |
| `File 'x.sty' not found` | Package not installed in your TeX distribution |
| `Paragraph ended before … was complete` | Blank line inside a command argument |
| `Misplaced alignment tab character &` | `&` used outside a table, or a literal `&` not escaped as `\&` |

**Warnings** are usually harmless. *Overfull \hbox* means a line is too wide (reword, or add `\sloppy`). *Reference undefined* disappears after another pass. *Float too large* means an image is bigger than the page.

## Good habits

- Indent environments and add `%` comments to explain intent.
- Keep **one sentence per line**: it makes diffs and Track Changes much cleaner.
- Compile after every small change.
- Use `\label` and `\ref` instead of hard-coded numbers.
- Prefer built-in structure (`\section`, `itemize`) to manual spacing.
- Use `\input{file}` or `\include{file}` to split long documents into several `.tex` files.
- Keep generated files, such as `.aux` and `.log`, out of version control.

## See also

Back to the [Documentation](documentation.md) or [Getting Started](getting-started.md).
