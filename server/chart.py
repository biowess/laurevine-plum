"""chart.py: renders one chart from a JSON spec with Matplotlib. Called by server/server.js (POST /api/chart):
    python3 chart.py spec.json out.(png|svg|pdf) [dpi]
Spec: { type: line|scatter|bar|histogram|box|heatmap, title, xlabel, ylabel, legend, grid, bins, columns: [names], rows: [[cells...]],
        variant (line: step · scatter: linear|linear_ci|quadratic · bar: stacked · histogram: kde · box: notch · heatmap: values), palette, style, xlim, ylim ("min, max") }
line/scatter/bar: column 0 is X (numbers, or labels for bar); every other column is one series. Blank cells are gaps.
histogram/box: EVERY column is one dataset of raw values (blank cells skipped); bins applies to histogram.
heatmap: column 0 holds the row labels; every other column is a matrix column (header = column label).
On bad data/plot errors it prints ONE readable line to stderr and exits non-zero (server.js shows it in the UI)."""
import sys, json, math

def fail(msg, code=2):
    sys.stderr.write(str(msg).strip().splitlines()[-1] if str(msg).strip() else 'Unknown error')
    sys.exit(code)

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
except ImportError:
    fail('Matplotlib is not installed. Run: pip install matplotlib', 3)

MAX_ROWS, MAX_COLS = 1000, 21
PALETTES = {
    'default': ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#000000', '#7F7F7F'],
    'colorblind': ['#000000', '#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7'],
    'muted': ['#332288', '#88CCEE', '#44AA99', '#117733', '#999933', '#DDCC77', '#CC6677', '#882255', '#AA4499'],
    'grayscale': ['#000000', '#555555', '#8C8C8C', '#B3B3B3'],
    'viridis': ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725']
}
CMAPS = ('viridis', 'plasma', 'inferno', 'magma', 'cividis', 'coolwarm', 'bwr', 'RdBu', 'seismic')
STYLES = ('seaborn-v0_8-whitegrid', 'seaborn-v0_8-ticks', 'ggplot', 'bmh')
VARIANTS = {'line': ('', 'step'), 'scatter': ('', 'linear', 'linear_ci', 'quadratic'), 'bar': ('', 'stacked'), 'histogram': ('', 'kde'), 'box': ('', 'notch'), 'heatmap': ('', 'values')}

def lim(v, name):
    t = str(v or '').replace(',', ' ').split()
    if not t: return None
    try: a, b = (float(x) for x in t)
    except ValueError: fail('%s must be two numbers, like 0, 10.' % name)
    if not (math.isfinite(a) and math.isfinite(b) and a < b): fail('%s: the minimum must be smaller than the maximum.' % name)
    return a, b

def kde(v, g):   # Gaussian kernel density, Silverman bandwidth
    v = np.asarray(v, float); h = 1.06 * (v.std(ddof=1) if len(v) > 1 else 1) * len(v) ** -0.2 or 1.0
    return np.exp(-0.5 * ((g[:, None] - v) / h) ** 2).sum(1) / (len(v) * h * math.sqrt(2 * math.pi))

def fit(ax, x, y, deg, ci, color, name):   # polynomial trend line, optionally with the 95% confidence band of the mean
    ok = ~(np.isnan(x) | np.isnan(y)); x, y = x[ok], y[ok]
    if len(x) < deg + 2 or len(set(x)) < deg + 1: fail('Column "%s": a %s fit needs at least %d points with different X values.' % (name, 'linear' if deg == 1 else 'quadratic', deg + 2))
    c = np.polyfit(x, y, deg); g = np.linspace(x.min(), x.max(), 100); f = np.polyval(c, g); ax.plot(g, f, color=color, lw=1.5)
    if ci:
        s = math.sqrt(((y - np.polyval(c, x)) ** 2).sum() / (len(x) - 2)); se = s * np.sqrt(1 / len(x) + (g - x.mean()) ** 2 / ((x - x.mean()) ** 2).sum())
        try: from scipy.stats import t; k = t.ppf(0.975, len(x) - 2)
        except ImportError: k = 1.96
        ax.fill_between(g, f - k * se, f + k * se, color=color, alpha=0.15, lw=0)

def num(cell, row, col):
    try:
        v = float(str(cell).strip())
    except ValueError:
        fail('Row %d, column "%s": "%s" is not a number.%s' % (row, col, str(cell).strip(), ' Use a dot as the decimal separator.' if ',' in str(cell) else ''))
    if not math.isfinite(v):
        fail('Row %d, column "%s": "%s" is not a finite number.' % (row, col, str(cell).strip()))
    return v

def main():
    spec = json.load(open(sys.argv[1], encoding='utf-8'))
    out, dpi = sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 100
    kind = spec.get('type')
    cols = [str(c) for c in spec.get('columns', [])]
    rows = [r for r in spec.get('rows', []) if any(str(c).strip() for c in r)]
    if kind not in ('line', 'scatter', 'bar', 'histogram', 'box', 'heatmap'): fail('Unknown chart type.')
    raw = kind in ('histogram', 'box')
    if len(cols) < (1 if raw else 2): fail('Add at least two columns: X and one series.')
    if len(cols) > MAX_COLS or len(rows) > MAX_ROWS: fail('Too much data (max %d rows, %d columns).' % (MAX_ROWS, MAX_COLS))
    if not rows: fail('The spreadsheet has no data rows.')
    variant, pal, style = spec.get('variant') or '', spec.get('palette') or '', spec.get('style') or ''
    if variant not in VARIANTS[kind]: fail('Unknown option "%s" for this chart type.' % variant)
    if pal and pal not in PALETTES and pal not in CMAPS: fail('Unknown colour palette.')
    if style and style not in STYLES: fail('Unknown theme.')
    xlim, ylim = lim(spec.get('xlim'), 'X range'), lim(spec.get('ylim'), 'Y range')
    rows = [(list(r) + [''] * len(cols))[:len(cols)] for r in rows]

    nums = lambda i: [float('nan') if not str(r[i]).strip() else num(r[i], n + 1, cols[i]) for n, r in enumerate(rows)]
    if raw:
        data = []
        for i, c in enumerate(cols):
            v = [x for x in nums(i) if not math.isnan(x)]
            if not v: fail('Column "%s" has no numeric values.' % c)
            data.append((c or 'Data %d' % (i + 1), v))
    elif kind == 'heatmap':
        x = [str(r[0]).strip() for r in rows]
    elif kind == 'bar':
        x = [str(r[0]).strip() for r in rows]
    else:
        x = [num(r[0], n + 1, cols[0]) if str(r[0]).strip() else fail('Row %d: the X value is empty.' % (n + 1)) for n, r in enumerate(rows)]
    series = []
    for i in range(1, 0 if raw else len(cols)):
        y = nums(i)
        if all(math.isnan(v) for v in y): fail('Column "%s" has no numeric values.' % cols[i])
        series.append((cols[i] or 'Series %d' % i, y))

    if style:
        try: plt.style.use(style)
        except OSError: fail('This theme needs Matplotlib 3.6 or newer.')
    if pal and pal in PALETTES: plt.rcParams['axes.prop_cycle'] = plt.cycler(color=PALETTES[pal])
    
    base_fs = float(spec.get('fontSize') or 10)
    plt.rcParams['font.size'] = base_fs
    fam = spec.get('fontFamily') or 'sans'
    if fam in ('sans', 'serif', 'mono'):
        plt.rcParams['font.family'] = {'sans': 'sans-serif', 'serif': 'serif', 'mono': 'monospace'}[fam]

    win = min(30.0, max(0.5, float(spec.get('wIn') or 6.4)))
    hin = min(30.0, max(0.5, float(spec.get('hIn') or 4.2)))
    fig, ax = plt.subplots(figsize=(win, hin))
    if kind == 'histogram':
        try: bins = min(200, max(1, int(spec.get('bins') or 10)))
        except (TypeError, ValueError): fail('Bins must be a whole number.')
        multi = len(data) > 1
        for i, (name, v) in enumerate(data):
            _, e, _ = ax.hist(v, bins=bins, density=variant == 'kde', alpha=0.6 if multi else 0.85, label=name, color='C%d' % i, edgecolor='white')
            if variant == 'kde': g = np.linspace(e[0], e[-1], 200); ax.plot(g, kde(v, g), color='C%d' % i, lw=1.5)
    elif kind == 'box':
        for n_, v_ in data:
            if variant == 'notch' and len(v_) < 10: fail('Notched boxes need at least 10 values in every column; "%s" has %d. Turn notches off or add data.' % (n_, len(v_)))
        ax.boxplot([v for _, v in data], notch=variant == 'notch'); ax.set_xticks(range(1, len(data) + 1)); ax.set_xticklabels([n for n, _ in data])
    elif kind == 'heatmap':
        m = np.ma.masked_invalid(np.array([nums(i) for i in range(1, len(cols))], dtype=float).T)
        if m.mask.all(): fail('The heatmap has no numeric values.')
        cmap = pal if pal in CMAPS else 'viridis'
        im = ax.imshow(m, aspect='auto', cmap=cmap); fig.colorbar(im, ax=ax)
        if variant == 'values':
            a = m.filled(np.nan); lo, hi = np.nanmin(a), np.nanmax(a)
            for (i, j), v in np.ndenumerate(a):
                if not np.isnan(v): ax.text(j, i, '%.3g' % v, ha='center', va='center', fontsize=8, color='white' if (v - lo) / ((hi - lo) or 1) < 0.5 else 'black')
        ax.set_xticks(range(len(cols) - 1)); ax.set_xticklabels([c or '' for c in cols[1:]]); ax.set_yticks(range(len(x))); ax.set_yticklabels(x)
    elif kind == 'line':
        for name, y in series:
            if variant == 'step': ax.step(x, y, where='mid', label=name)
            else: ax.plot(x, y, marker='o', markersize=4, label=name)
    elif kind == 'scatter':
        for i, (name, y) in enumerate(series):
            ax.scatter(x, y, s=22, label=name, color='C%d' % i)
            if variant: fit(ax, np.array(x, float), np.array(y, float), 2 if variant == 'quadratic' else 1, variant == 'linear_ci', 'C%d' % i, name)
    elif variant == 'stacked':
        base = np.zeros(len(x))
        for name, y in series: y = np.nan_to_num(np.array(y, float)); ax.bar(range(len(x)), y, 0.6, bottom=base, label=name); base = base + y
        ax.set_xticks(range(len(x))); ax.set_xticklabels(x)
    else:
        n = len(series); w = 0.8 / n
        for j, (name, y) in enumerate(series):
            ax.bar([i + (j - (n - 1) / 2) * w for i in range(len(x))], y, w, label=name)
        ax.set_xticks(range(len(x))); ax.set_xticklabels(x)

    if spec.get('despine'):
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
    tdir = spec.get('tickDirection') or 'out'
    if tdir in ('out', 'in', 'inout'): ax.tick_params(direction=tdir)
    xrot = float(spec.get('xTickRotation') or 0)
    yrot = float(spec.get('yTickRotation') or 0)
    if xrot: ax.tick_params(axis='x', labelrotation=xrot)
    if yrot: ax.tick_params(axis='y', labelrotation=yrot)
    if spec.get('xScale') == 'log' and kind not in ('bar', 'heatmap'): ax.set_xscale('log')
    if spec.get('yScale') == 'log' and kind != 'heatmap': ax.set_yscale('log')

    t_sz = float(spec.get('titleSize') or round(base_fs * 1.2, 1))
    lbl_sz = float(spec.get('labelSize') or base_fs)
    tk_sz = float(spec.get('tickSize') or round(base_fs * 0.9, 1))
    ax.tick_params(labelsize=tk_sz)

    if spec.get('title'): ax.set_title(spec['title'], fontsize=t_sz)
    if spec.get('subtitle'): ax.text(0.5, 1.01, spec['subtitle'], transform=ax.transAxes, ha='center', va='bottom', fontsize=lbl_sz, color='#555555')
    if spec.get('xlabel'): ax.set_xlabel(spec['xlabel'], fontsize=lbl_sz)
    if spec.get('ylabel'): ax.set_ylabel(spec['ylabel'], fontsize=lbl_sz)
    if xlim: ax.set_xlim(*xlim)
    if ylim: ax.set_ylim(*ylim)

    gstyle = {'solid': '-', 'dashed': '--', 'dotted': ':', 'dashdot': '-.'}.get(spec.get('gridStyle') or 'solid', '-')
    galpha = float(spec.get('gridAlpha') if spec.get('gridAlpha') is not None else 0.3)
    if kind != 'heatmap':
        if spec.get('grid'): ax.grid(True, linestyle=gstyle, alpha=galpha)
        else: ax.grid(False)
        if spec.get('gridMinor'):
            ax.minorticks_on()
            ax.grid(True, which='minor', linestyle=gstyle, alpha=galpha * 0.7, linewidth=0.5)

    if spec.get('legend') and kind not in ('box', 'heatmap'):
        pos = spec.get('legendPos') or 'best'
        frame = bool(spec.get('legendFrame', True))
        leg_sz = float(spec.get('legendSize') or round(base_fs * 0.9, 1))
        if pos == 'outside': ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=frame, fontsize=leg_sz)
        else: ax.legend(loc=pos, frameon=frame, fontsize=leg_sz)

    fig.tight_layout()
    fig.savefig(out, dpi=dpi); plt.close(fig)

try:
    main()
except SystemExit:
    raise
except Exception as e:
    fail('Could not draw the chart: %s' % e)
