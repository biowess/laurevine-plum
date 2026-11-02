#!/usr/bin/env python3
"""Regenerates the figures and table values of templates/sample-article.tex (ILLUSTRATIVE simulation, not a research result).
Developer-only reference: Plum never runs this file; the compiled PDFs sit next to it. Needs numpy + matplotlib.
Usage (from this folder):  python generate_sample_article_figures.py"""
import json, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.normpath(os.path.join(HERE, "..", "..", "fonts", "tex-gyre-termes"))   # bundled TeX Gyre Termes (TTF)
for f in ("regular", "bold", "italic", "bolditalic"):
    p = os.path.join(FONTS, f"texgyretermes-{f}.ttf")
    if os.path.exists(p): fm.fontManager.addfont(p)

NAVY, TEAL, OCHRE, RED, GRAY, INK = "#1F3A5F", "#2E7D8C", "#B8862B", "#9B3B3B", "#7A8594", "#1A1A1A"
plt.rcParams.update({
    "font.family": "TeX Gyre Termes", "font.size": 9, "axes.labelsize": 9, "axes.titlesize": 9.5, "legend.fontsize": 8,
    "xtick.labelsize": 8, "ytick.labelsize": 8, "mathtext.fontset": "custom", "mathtext.rm": "TeX Gyre Termes",
    "mathtext.it": "TeX Gyre Termes:italic", "mathtext.bf": "TeX Gyre Termes:bold", "pdf.fonttype": 42,
    "axes.edgecolor": "#444", "axes.linewidth": 0.6, "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": "#DDE1E6", "grid.linewidth": 0.5, "axes.axisbelow": True,
    "xtick.major.width": 0.6, "ytick.major.width": 0.6, "legend.frameon": False, "lines.linewidth": 1.5,
    "axes.titleweight": "normal", "axes.titlelocation": "left"})

# ---- simulation setup (mirrors Table 1 of the article) ----
N, S, SIGMA, KAPPA = 256, 8, 0.05, 1.6
FRAC = {"two": (0.60, 0.40), "three": (0.50, 0.25, 0.25)}    # measurement fraction per stage
CAND = {"two": (48,), "three": (64, 24)}                      # candidate-set sizes after each non-final stage
TRIALS, M_GRID, M_TAB = 300, [48, 64, 80, 96, 112, 128], 80

def draw_signal(rng):
    x = np.zeros(N); sup = rng.choice(N, S, replace=False)
    x[sup] = rng.choice([-1, 1], S) * rng.uniform(1.0, 2.0, S); return x, np.sort(sup)

def rows(rng, m, idx=None):
    A = np.zeros((m, N)); k = N if idx is None else len(idx)
    G = rng.normal(0, 1/np.sqrt(k), (m, k))            # unit expected row energy: equal energy per measurement
    if idx is None: return G
    A[:, idx] = G; return A

def lasso(A, y, lam, it=400):                           # FISTA on column-normalised A
    d = np.linalg.norm(A, axis=0); d[d == 0] = 1; B = A / d
    L = np.linalg.norm(B, 2) ** 2; z = np.zeros(N); w = z.copy(); t = 1.0
    for _ in range(it):
        g = w - B.T @ (B @ w - y) / L; zn = np.sign(g) * np.maximum(np.abs(g) - lam / L, 0)
        tn = (1 + np.sqrt(1 + 4 * t * t)) / 2; w = zn + (t - 1) / tn * (zn - z); z, t = zn, tn
    return z / d

def debias(A, y, sup):
    x = np.zeros(N); x[sup] = np.linalg.lstsq(A[:, sup], y, rcond=None)[0]; return x

def rank(A, y, xh):                                     # LASSO magnitude first; zero coefficients are ordered by residual correlation (no index-order ties)
    d = np.linalg.norm(A, axis=0); d[d == 0] = 1; c = np.abs(A.T @ (y - A @ xh)) / d
    return np.lexsort((-c, -np.abs(xh)))

LAM = KAPPA * SIGMA * np.sqrt(2 * np.log(N))

def run(strategy, m, rng, x=None, sup=None):
    if x is None: x, sup = draw_signal(rng)
    info = {"stage": [], "cand": [N], "recall": [1.0]}
    if strategy == "oracle":
        A = rows(rng, m, sup); y = A @ x + SIGMA * rng.normal(size=m); return debias(A, y, sup), sup, A, y, info   # oracle measures only on the true support
    if strategy == "gauss":
        A = rows(rng, m); y = A @ x + SIGMA * rng.normal(size=m); info["stage"] = [0] * m
    else:
        fr, cs = FRAC[strategy], CAND[strategy]; ms = [int(round(f * m)) for f in fr]; ms[-1] = m - sum(ms[:-1])
        A = np.zeros((0, N)); y = np.zeros(0); idx = None
        for k, mk in enumerate(ms):
            Ak = rows(rng, mk, idx); A = np.vstack([A, Ak]); y = np.concatenate([y, Ak @ x + SIGMA * rng.normal(size=mk)]); info["stage"] += [k] * mk
            if k < len(cs):
                xh = lasso(A, y, LAM); idx = np.sort(rank(A, y, xh)[:cs[k]])
                info["cand"].append(len(idx)); info["recall"].append(len(set(idx) & set(sup)) / S)
    xh = lasso(A, y, LAM); top = np.sort(rank(A, y, xh)[:S])
    return debias(A, y, top), top, A, y, info

def metrics(xh, top, x, sup):
    tp = len(set(top) & set(sup)); return np.linalg.norm(xh - x) / np.linalg.norm(x), 2 * tp / (len(top) + len(sup)), float(tp == S)

NAMES = {"gauss": "Non-adaptive Gaussian", "two": "Two-stage adaptive", "three": "Three-stage adaptive", "oracle": "Oracle support"}
res = {k: {m: [] for m in M_GRID} for k in NAMES}
for m in M_GRID:
    for tr in range(TRIALS):
        x, sup = draw_signal(np.random.default_rng(10_000 * m + tr))
        for j, k in enumerate(NAMES):
            rng = np.random.default_rng(10_000 * m + tr + 7_919 * (j + 1))
            xh, top, *_ = run(k, m, rng, x, sup); res[k][m].append(metrics(xh, top, x, sup))
R = {k: {m: np.array(v) for m, v in d.items()} for k, d in res.items()}

# ---- Figure: recovery (strategy comparison) ----
fig, ax = plt.subplots(figsize=(5.4, 3.3)); sty = {"gauss": (GRAY, "o", "-"), "two": (TEAL, "s", "-"), "three": (NAVY, "D", "-"), "oracle": (OCHRE, None, "--")}
for k, (c, mk, ls) in sty.items():
    med = np.array([np.median(R[k][m][:, 0]) for m in M_GRID]); lo = np.array([np.percentile(R[k][m][:, 0], 25) for m in M_GRID]); hi = np.array([np.percentile(R[k][m][:, 0], 75) for m in M_GRID])
    ax.plot(M_GRID, med, color=c, marker=mk, ms=4, ls=ls, label=NAMES[k]); ax.fill_between(M_GRID, lo, hi, color=c, alpha=0.10, lw=0)
ax.set_yscale("log"); ax.set_xlabel(r"Number of measurements $m$"); ax.set_ylabel(r"Relative error $\|\hat{x}-x\|_2/\|x\|_2$")
ax.set_xticks(M_GRID); ax.set_ylim(6e-3, 0.9); ax.legend(loc="upper right"); fig.tight_layout(); fig.savefig(os.path.join(HERE, "recovery.pdf")); plt.close(fig)

# ---- Figure: adaptive-curve (candidate-set curve + sensing energy) ----
rng = np.random.default_rng(2026); x, sup = draw_signal(rng); xh, top, A, y, info = run("three", M_TAB, np.random.default_rng(31), x, sup)
Rc = {"cand": [], "rec": []}
for tr in range(TRIALS):
    xx, ss = draw_signal(np.random.default_rng(555 + tr)); _, _, _, _, inf = run("three", M_TAB, np.random.default_rng(900 + tr), xx, ss); Rc["cand"].append(inf["cand"]); Rc["rec"].append(inf["recall"])
cand, rec = np.mean(Rc["cand"], 0), np.mean(Rc["rec"], 0); stg = np.arange(len(cand)) + 1
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.6, 2.9), gridspec_kw={"width_ratios": [1, 1.5]})
a1.plot(stg, cand / N, color=NAVY, marker="o", ms=4, label="$|S_{k-1}|/n$"); a1.plot(stg, rec, color=OCHRE, marker="s", ms=4, ls="--", label="Recall of $S_{k-1}$")
a1.set_xticks(stg); a1.set_ylim(0, 1.08); a1.set_xlabel("Stage $k$"); a1.set_title("(a) Candidate-set curve"); a1.legend(loc="center right", bbox_to_anchor=(1.0, 0.6), fontsize=7.2)
en = (A ** 2).sum(0); a2.bar(np.arange(1, N + 1), en, width=1.0, color=NAVY, alpha=0.85, lw=0); a2.plot(sup + 1, np.full(S, en.max() * 1.10), "v", color=RED, ms=4.5, label="True support")
a2.set_xlim(0, N + 1); a2.set_ylim(0, en.max() * 1.32); a2.set_xlabel("Coordinate index $j$"); a2.set_ylabel(r"Sensing energy $\sum_i A_{ij}^2$"); a2.set_title("(b) Energy allocation, one run"); a2.legend(loc="upper right", fontsize=7.5, borderaxespad=0.1)
fig.tight_layout(); fig.savefig(os.path.join(HERE, "adaptive-curve.pdf")); plt.close(fig)

# ---- Figure: measurements (one run, m = 80) ----
xg, topg, Ag, yg, _ = run("gauss", M_TAB, np.random.default_rng(31), x, sup)
fig, (a1, a2) = plt.subplots(1, 2, figsize=(6.6, 2.9), gridspec_kw={"width_ratios": [1.5, 1]})
cols = [GRAY, TEAL, NAVY]; st = np.array(info["stage"]); edges = [0] + [int(np.where(st == k)[0][-1]) + 1 for k in range(3)]
for k in range(3):
    s = st == k; a1.vlines(np.where(s)[0] + 1, 0, y[s], color=cols[k], lw=1.2, label=f"Stage {k + 1} ($m_{k + 1}={s.sum()}$)"); a1.plot(np.where(s)[0] + 1, y[s], "o", color=cols[k], ms=2.6)
a1.axhline(0, color="#444", lw=0.6); a1.set_xlabel("Measurement index $i$"); a1.set_ylabel("$y_i$"); a1.set_title("(a) Measurements, three-stage run"); a1.legend(loc="upper right", fontsize=7.2, ncol=1)
a1.set_xlim(0, M_TAB + 1); a1.set_ylim(y.min() * 1.15, y.max() * 1.55)
lim = 2.3; a2.plot([-lim, lim], [-lim, lim], color="#444", lw=0.6, ls=":"); a2.plot(x[sup], xg[sup], "o", mfc="none", color=GRAY, ms=5, label="Non-adaptive"); a2.plot(x[sup], xh[sup], "D", color=NAVY, ms=3.8, label="Three-stage")
a2.set_xlim(-lim, lim); a2.set_ylim(-lim, lim); a2.set_aspect("equal"); a2.set_xlabel(r"True coefficient $x_j$"); a2.set_ylabel(r"Recovered $\hat{x}_j$"); a2.set_title("(b) Recovery on the support"); a2.legend(loc="upper left", fontsize=7.5)
fig.tight_layout(); fig.savefig(os.path.join(HERE, "measurements.pdf")); plt.close(fig)

# ---- table values ----
tab = {NAMES[k]: {"med": float(np.median(R[k][M_TAB][:, 0])), "q1": float(np.percentile(R[k][M_TAB][:, 0], 25)), "q3": float(np.percentile(R[k][M_TAB][:, 0], 75)),
                  "f1": float(R[k][M_TAB][:, 1].mean()), "exact": float(100 * R[k][M_TAB][:, 2].mean())} for k in NAMES}
sweep = {NAMES[k]: {int(m): float(np.median(R[k][m][:, 0])) for m in M_GRID} for k in NAMES}
print(json.dumps({"table": tab, "sweep": sweep, "cand": cand.tolist(), "recall": rec.tolist(), "m_stage": [int((st == k).sum()) for k in range(3)],
                  "run_rel_err": {"gauss": float(np.linalg.norm(xg - x) / np.linalg.norm(x)), "three": float(np.linalg.norm(xh - x) / np.linalg.norm(x))}}, indent=1))
