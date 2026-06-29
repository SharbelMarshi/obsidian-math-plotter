# Math Plotter

A GUI-based mathematical graph builder for Obsidian using bundled TikZJax WebAssembly, TikZ, PGFPlots, and a built-in JavaScript expression engine for graph sampling.

---

## Overview

Math Plotter lets you create mathematical graphs in Obsidian **without** writing TikZ, PGFPlots, JSON, YAML, or LaTeX by hand.

You build graphs through:

- **Ribbon command** — click the line-chart icon in the left ribbon
- **Command palette** — run **Insert Function Plot**
- **Empty ` ```graph ` block** — type an empty fenced block and use the inline builder

The plugin stores graph configuration inside a ` ```graph ` block as JSON. In **Reading View**, that block is replaced by the rendered graph image. You normally interact through the GUI, not by editing the JSON directly.

---

## Key Features

- **GUI graph builder** — full modal with function, ranges, parameters, points, style, and size controls
- **Inline graph builder** — quick setup when you create an empty ` ```graph ` block
- **2D function graphs** — plot `y = f(x)`
- **3D surface graphs** — plot `z = f(x, y)` with colored heat-style mesh by default
- **PDE explicit solution surfaces** — plot a user-provided solution `u(x, y, t)` (v1 does not solve PDEs symbolically)
- **ODE explicit solution plots** — plot a user-provided solution (v1 does not solve ODEs symbolically)
- **Parametric graphs** — 2D and 3D parametric curves (full modal builder)
- **Data plots** — plot `(x, y)` point pairs
- **Labeled points** — overlay annotated points on 2D and 3D graphs (Points tab; plotted on top via PGFPlots)
- **Wireframe / grid surfaces** — default 3D style uses PGFPlots `mesh`
- **Transparent graph output** — borderless, transparent SVG by default
- **Export size and scaling** — separate LaTeX axis size and Obsidian display scale
- **Fast SVG preview (default)** — graphs render instantly via a built-in JavaScript sampler + direct SVG; no WASM compile during normal editing
- **Optional high-quality render** — TikZJax WebAssembly or local LuaLaTeX on demand from the graph toolbar
- **Built-in JavaScript sampling** — local expression evaluation; no Octave required for normal graphs
- **SVG display and export** — graphs render as SVG; PNG export available from the graph toolbar

---

## Design Philosophy

Math Plotter is **GUI-first**.

You write simple math syntax such as:

```text
sin^2(x)+cos^2(y)
```

**Not** PGFPlots syntax like:

```text
(sin(deg(x)))^2 + (cos(deg(y)))^2
```

**Not** Octave syntax like:

```text
sin(x).^2 + cos(y).^2
```

The plugin keeps your expression unchanged in the saved graph model and **compiles it internally** at render time:

| Backend | Internal compilation |
|---------|----------------------|
| PGFPlots / TikZJax | `compileExpressionForPgfplots()` — e.g. `deg()` for trig, `ln()` for natural log |
| Octave (optional) | `compileExpressionForOctave()` — elementwise `.^`, `.*`, `./`, radians |

Each backend compiles from the **original user expression**. PGFPlots-normalized output is never passed to Octave, and vice versa.

---

## Installation

1. Clone or copy this repository into your Obsidian plugins folder:

   ```text
   Vault/.obsidian/plugins/math-plotter/
   ```

2. Install dependencies and build:

   ```bash
   cd Vault/.obsidian/plugins/math-plotter
   npm install
   npm run build
   ```

   `npm install` copies bundled TikZJax WebAssembly assets into `assets/tikzjax/node/`. **Do not copy only `main.js`** — the full plugin folder must be deployed, including:

   ```text
   main.js
   manifest.json
   styles.css
   assets/tikzjax/node/
   ```

3. In Obsidian: **Settings → Community plugins → Math Plotter → Enable**, then **reload Obsidian** (or disable/re-enable the plugin) after building.

### Community plugin install (from GitHub releases)

When installed through Obsidian’s community plugin browser, only `main.js`, `manifest.json`, and `styles.css` are downloaded. **Fast SVG rendering works** with those files alone.

For **TikZ / high-quality rendering**, extract `math-plotter-full.zip` from the GitHub release into your plugin folder, or build from source as above. See [RELEASING.md](RELEASING.md) for maintainer release steps.

This plugin is **desktop-only** (`isDesktopOnly: true`). It uses bundled WebAssembly rendering and does not work on Obsidian Mobile.

---

## Requirements

### Required

| Tool | Purpose |
|------|---------|
| **Obsidian Desktop** | Host application |
| **Node.js / npm** | Development and building the plugin |

After `npm run build`, normal graph rendering needs only Obsidian and the plugin files. TikZJax WebAssembly compiles generated TikZ/PGFPlots to SVG locally.

### Optional

| Tool | Purpose |
|------|---------|
| **LuaLaTeX + Poppler** | Advanced fallback when TikZJax cannot compile a graph (enable in Settings → Advanced) |
| **GNU Octave** | Optional external numerical sampler (Settings → Advanced) |

Math Plotter uses the **headless Octave CLI**, preferably `octave-cli`, not the Octave GUI app. On macOS with Homebrew (Apple Silicon), the recommended path is:

```text
/opt/homebrew/bin/octave-cli
```

Auto-detection checks `octave-cli` before `octave` and never launches `/Applications/Octave.app`. Octave runs silently in the background — no GUI window, terminal, or dock icon should appear during graph sampling.

Typical fallback paths:

```text
/opt/homebrew/bin/octave-cli    (macOS Apple Silicon)
/usr/local/bin/octave-cli       (macOS Intel)
/usr/bin/octave-cli             (Linux)
```

Octave is **not required**. Normal graphing uses the built-in JavaScript sampler plus bundled TikZJax.

**TikZJax limitations:** The bundled engine supports core TikZ and PGFPlots (compat 1.16) but not every LaTeX package in a full TeX Live install. Enable **Use local LuaLaTeX fallback** in Advanced settings if you need higher compatibility.

---

## Basic Usage

### Workflow A: Ribbon

1. Open a note in Obsidian.
2. Click the **line-chart** ribbon icon (**Insert Function Plot**).
3. Choose a graph type, enter the function, ranges, labels, and style.
4. Click **Insert Graph**.
5. Switch to Reading View — the rendered graph appears in the note.

### Workflow B: Command Palette

1. Open the command palette (`Cmd/Ctrl + P`).
2. Run **Insert Function Plot**.
3. Fill in the graph builder modal — start in the **Equation** tab to choose **Graph type**, **Title**, and the function or solution.
4. Click **Insert Graph**.

### Workflow C: Inline Builder

1. In a note, type a fenced block:

   ````markdown
   ```graph
   
   ```
   ````

2. Math Plotter detects the empty block and shows an **inline field-based builder**.
3. Choose graph type, function, title, and size preset.
4. Click **Insert Graph**, or **More Options** to open the full modal.

---

## Graph Types

### 2D Function

Plot an explicit function `y = f(x)`.

- **Example function:** `sin^2(x)`
- **Typical x range:** `-2*pi` to `2*pi`

### 3D Surface

Plot an explicit surface `z = f(x, y)`.

- **Examples:** `x^2+y^2`, `sin^2(x)+cos^2(y)`
- Set **x**, **y**, and **z** ranges in the builder
- Default 3D export size: **15 cm × 10 cm**

### ODE Solution

Plot an **explicit** solution you provide.

- **Equation label (caption):** `y' = -2y`
- **Solution function:** `exp(-2*x)`

> **Important:** v1 plots explicit solutions only. Math Plotter does **not** symbolically solve arbitrary ODEs.

### PDE Solution

Plot an **explicit** solution surface or slice.

- **Equation label:** `u_t = u_xx + u_yy`
- **Solution:** `exp(-2*t)*sin(x)*sin(y)`
- **Parameter:** `t = 0.25`

> **Important:** v1 plots explicit solutions only. Math Plotter does **not** symbolically solve arbitrary PDEs.

### Parametric 2D / 3D

Available in the **full graph builder modal** (not the inline quick builder).

- Enter `x(t)`, `y(t)`, and optionally `z(t)`
- Set the parameter range for `t`

### Data Plot

Enter `(x, y)` pairs manually or paste comma-separated values.

### Points overlay

Use the **Points** tab in the full graph builder modal to mark labeled points on top of the rendered graph.

| Graph type | Point fields |
|------------|--------------|
| 2D (function, ODE, parametric 2D, etc.) | **x**, **y**, **label** |
| 3D surface / PDE 3D / parametric 3D | **x**, **y**, **z**, **label** |

For 3D surfaces, if **z** is left empty the plugin tries to compute it from the surface expression at the given **x** and **y**. Otherwise it asks for **z** explicitly.

Points are drawn with PGFPlots after the main plot (including Octave-sampled surfaces), so they always appear on top.

---

## User Math Syntax

Type simple, calculator-style expressions in function fields.

**Supported examples:**

```text
x^2 + y^2
sin^2(x)+cos^2(y)
sin(x)*cos(y)
exp(-2*t)*sin(x)*sin(y)
e^(-x^2-y^2)
sqrt(x^2+y^2)
ln(x)
log(x)          → natural logarithm (same as ln)
pi
π
2sin(x)
3(x+1)
```

The plugin stores this syntax in the `function` field of the graph JSON. It is **never** rewritten to Octave or PGFPlots syntax in the saved file.

---

## Rendering Pipeline

Math Plotter uses a **bundled JavaScript expression engine** for normal graph sampling. Users do **not** need to install Octave, Homebrew, or any external numerical CLI for standard graphing.

### Built-in JavaScript sampler (default)

For 2D functions, 3D surfaces, and explicit ODE/PDE solution plots:

```text
GUI expression (user syntax)
  → compileExpressionForOctave() internally (not stored in JSON)
  → evaluate with bundled expr-eval engine
  → FastSvgRenderer draws SVG directly (default, instant)
  → optional: TikZJax / LuaLaTeX for high-quality export
```

**Refresh** re-renders the fast SVG preview. **High quality** runs TikZJax (or LuaLaTeX fallback) when you need full PGFPlots output. Display scale changes use CSS only and do not trigger recompilation.

Supported user syntax includes `x^2+y^2`, `sin^2(x)+cos^2(y)`, `exp(-2*t)*sin(x)*sin(y)`, `e^(-x^2-y^2)`, `sqrt(x^2+y^2)`, `ln(x)`, `log(x)`, and `pi` / `π`. You never type Octave syntax like `.^`, `.*`, or `./`.

Point auto-detection and “not on graph” checks use the same JavaScript engine.

### Symbolic PGFPlots (parametric, data, implicit)

Parametric curves, data plots, and implicit contours use the fast SVG preview when possible. Use **High quality** in the graph toolbar for full TikZJax/PGFPlots output when the fast renderer is not enough.

### TikZJax WebAssembly (optional high-quality backend)

- Bundled TeX/TikZ engine compiled to WebAssembly
- Renders generated TikZ/PGFPlots to SVG on demand (toolbar **High quality**)
- Works offline — assets ship with the plugin under `assets/tikzjax/`
- PGFPlots compat is capped at **1.16** in TikZJax (not full TeX Live)
- Loaded once and queued — not run on every field change or scale adjustment

### Local LuaLaTeX (optional advanced fallback)

- Off by default — enable under **Settings → Advanced**
- Retries failed TikZJax renders when a local TeX install is available
- Useful for unsupported packages, fill-between plots, or debugging

### Octave engine (optional advanced)

Octave is **optional** and **off by default**. Enable it under **Settings → Advanced** only if you want an external numerical sampler.

- Does not replace LaTeX — Octave produces CSV data; PGFPlots still renders
- Not required for normal 2D, 3D surface, ODE, or PDE explicit-solution graphs

**Pipeline with Octave (when enabled):**

```text
GUI expression → compileExpressionForOctave() → octave-cli script → graph-data.csv → PGFPlots → TikZJax SVG
```

---

## Octave Engine Details

Internally, Octave requires **elementwise** operators on meshgrid arrays:

| User syntax | Octave (internal) |
|-------------|-------------------|
| `x^2` | `x.^2` |
| `x*y` | `x.*y` |
| `x/y` | `x./y` |
| `sin^2(x)` | `sin(x).^2` |

**You should never type Octave syntax.** The plugin compiles automatically.

### CSV format

Octave writes comma-separated data with a header row:

```csv
x,y,z
-2,-2,8
-1.9,-2,7.61
...
```

PGFPlots imports it with named columns:

```latex
table[col sep=comma, x=x, y=y, z=z]
```

This avoids column-index errors such as `requested column number '1' does not exist`.

---

## Surface Styles

**2D and ODE graphs** default to a **theme-aware line** (`color: auto`) — black in light mode, white in dark mode.

Default graph colors are theme-aware. In dark mode, default 2D lines and wireframes render in light colors, while colored 3D/PDE surfaces keep their heat colormap.

**3D surfaces and PDE 3D surfaces** default to **colored heat-style** rendering (blue → yellow → red by height/intensity). This is useful for heat equations, waves, and potential fields.

In the graph builder **Style** section you can set:

- **Grid** — show or hide background grid lines on 2D graphs (enabled by default)
- **Surface style** (3D / PDE 3D only) — **Colored** (default), **Wireframe**, or **Solid**
- **Color** — line color for 2D, ODE, and PDE 2D slice graphs (`auto` follows the Obsidian theme; use `red`, `blue`, etc. for a fixed color)
- **Line width** — PGFPlots width option

2D graphs support a Grid on/off option. Grid is enabled by default. This option does not apply to 3D surface graphs.

Switch a 3D surface to **Wireframe** in the Style tab if you prefer a plain theme-aware mesh for publication output.

---

## Graph Sizing and Scaling

Math Plotter separates two size concepts:

### LaTeX graph size

- Controls PGFPlots **width** and **height** (e.g. `15cm × 10cm` for 3D)
- Affects label spacing, render quality, and export resolution
- Changing LaTeX size **recompiles** the graph

**Presets:** Small · Medium · Large · Full width · Custom

Default for new 3D graphs: **Large — 15 cm × 10 cm**

### Display scale

- Controls how large the graph **appears in Obsidian** (CSS zoom)
- Range: **0.5× – 2.5×**
- Adjustable from hover controls on the rendered graph **without recompiling**

---

## Transparent Output

Rendered graphs are **transparent and borderless** — no border, card, shadow, or frame padding. They blend cleanly into your note.

The graph builder, inline builder, modal, settings panels, and error boxes use a modern glass-style interface. **Inserted graphs in notes are always transparent and borderless.**

---

## Internal Storage

Graph data is stored in a fenced block:

````markdown
```graph
{
  "version": 1,
  "type": "surface3d",
  "function": "x^2 + y^2",
  "ranges": {
    "x": ["-2", "2"],
    "y": ["-2", "2"],
    "z": ["0", "8"]
  },
  "size": {
    "preset": "large"
  }
}
```
````

Notes:

- The canonical expression field is **`function`** (user syntax only)
- Compiled PGFPlots or Octave syntax is **never** stored
- In Reading View, the block is replaced by the rendered SVG graph
- Manual JSON editing is possible but not the intended workflow

---

## Example Graphs

### 2D function

| Field | Value |
|-------|-------|
| Type | 2D Function |
| Function | `sin^2(x)` |
| x range | `-2*pi` to `2*pi` |

### 3D surface

| Field | Value |
|-------|-------|
| Type | 3D Surface |
| Function | `x^2+y^2` |
| x range | `-2` to `2` |
| y range | `-2` to `2` |
| z range | `0` to `8` |

### PDE surface

| Field | Value |
|-------|-------|
| Type | PDE Solution |
| Equation | `u_t = u_xx + u_yy` |
| Solution | `exp(-2*t)*sin(x)*sin(y)` |
| Parameter | `t = 0.25` |
| View | 3D surface |

---

## Settings

Open **Settings → Math Plotter**.

### Rendering

| Setting | Description |
|---------|-------------|
| *(built-in)* | JavaScript expression engine samples graphs locally |
| *(built-in)* | TikZJax WebAssembly renders TikZ/PGFPlots to SVG — no configuration needed |
| **Output format** | SVG in Reading View; PNG available for export |

Math Plotter uses an internal 15-second render timeout and keeps render caching enabled automatically.

### Advanced (optional fallbacks)

| Setting | Description |
|---------|-------------|
| **Use local LuaLaTeX fallback** | Retry failed TikZJax renders with local LuaLaTeX when installed — off by default |
| **LuaLaTeX path** | Shown when fallback is enabled; empty = auto-detect |
| **Enable Octave engine** | Optional external sampler — off by default |
| **Octave CLI path** | Headless binary, or empty for auto-detect |
| **Detect Octave CLI** / **Test Octave** | Verify Octave installation |
| **Prefer Octave for 3D surfaces** | Use Octave instead of the built-in sampler when enabled |
| **Prefer Octave for ODE/PDE numeric mode** | Use Octave when `numericMode` is set |

Math Plotter uses an internal 15-second render timeout and keeps render caching enabled automatically.

### Debug

| Setting | Description |
|---------|-------------|
| **Debug mode** | Include generated TikZ in error details |

### Graph size (per graph)

Graph size is **not** configured in plugin settings. Change LaTeX axis size and display scale per graph from:

- **Graph builder → Size tab** (full modal)
- **Inline builder** size preset dropdown
- Per-graph JSON `size` field

Default new graphs use the **Large** preset (15 cm × 9 cm for 2D, 15 cm × 10 cm for 3D).

Function syntax examples (`sin^2(x)`, `x^2+y^2`, etc.) are documented in this README and shown as placeholders in graph editor fields — not in settings.

---

## Troubleshooting

### TikZJax render failed

Some graphs use PGFPlots features that TikZJax does not support (for example `fillbetween` or newer compat settings). Enable **Use local LuaLaTeX fallback** in Advanced settings if you have MacTeX or TeX Live installed.

### LuaLaTeX not found (fallback only)

LuaLaTeX is only needed when the optional fallback is enabled. Install a TeX distribution (e.g. MacTeX) and ensure `lualatex` is available:

```bash
which lualatex
```

Expected on macOS: `/Library/TeX/texbin/lualatex`

### PGFPlots expression error

Use simple syntax: `sin^2(x)`, `x^2`, `exp(-x)`, `sqrt(x^2+y^2)`.

Do **not** type PGFPlots syntax (`deg()`, `\\addplot`, etc.) in function fields.

### Octave CLI failed or GUI appeared

Use **Octave CLI path** in settings — prefer `/opt/homebrew/bin/octave-cli` over `octave` or the Octave.app bundle. Click **Detect Octave CLI** or **Test Octave** to verify. Math Plotter must not launch Octave via `open` or the GUI app.

### Octave elementwise error

If you see an error about matrix vs elementwise operators (`Use .^ for elementwise power`), the Octave compiler may have failed. This should be handled automatically — report it as a bug if it persists.

### CSV column error

If PGFPlots reports a missing CSV column, Octave data may not have been imported correctly. The plugin should write `x,y,z` headers and use `col sep=comma`. Expand **Details** on the error panel for CSV preview and the generated table command.

### Graph appears too small

1. Open the graph builder → **Size** section
2. Set preset to **Large** or **Full width**
3. Or increase custom LaTeX width/height
4. Use **display scale** hover controls (+/−) for on-screen zoom without recompiling

### Surface is clipped

Check the **z range**. Example: for `z = x^2` with `x` from `-100` to `100`, z reaches `10000` — a z range of `-1` to `1` will clip almost everything.

The plugin warns: *"Most of the surface may be clipped by the selected z range."*

### Invalid graph block

Use **Edit Graph** or **Reset Block** on the error panel. Empty blocks show the inline builder automatically.

---

## Releasing

See [RELEASING.md](RELEASING.md) for version bumps, `versions.json`, GitHub Actions releases, and community plugin submission.

---

## Development

```bash
npm install
npm run build        # production build → main.js
npm run release:check
npm run dev          # watch mode
npm run test:syntax  # expression compiler tests
npm run test:octave-csv
npm run test:range   # z-range validation tests
```

### Project structure

| Path | Role |
|------|------|
| `main.ts` | Plugin entry, commands, ribbon |
| `src/graphBuilderModal.ts` | Full graph builder modal |
| `src/InlineGraphBuilder.ts` | Empty-block inline builder |
| `src/graphSpec.ts` | Graph model, JSON serialize/hydrate |
| `src/graphProcessor.ts` | Reading View block processor |
| `src/graphJsonConverter.ts` | Graph spec → TikZ / render bundle |
| `src/graphSize.ts` | LaTeX size and display scale |
| `src/graphRangeValidation.ts` | Z-range clipping warnings |
| `src/settings.ts` | Plugin settings UI |
| `src/ExpressionEngine.ts` | Bundled JS math evaluator and sampler |
| `sampler/` | JS sampling pipeline and routing |
| `graphPreprocessor.ts` | Graph DSL → PGFPlots expansion |
| `render/TikzJaxRenderer.ts` | Bundled TikZJax WASM renderer |
| `render/tikzJaxSource.ts` | TikZJax-compatible document wrapper |
| `render/renderer.ts` | `GraphRenderer` — TikZJax default + optional LuaLaTeX fallback |
| `render/commandResolver.ts` | LuaLaTeX / pdftocairo path resolution (fallback only) |
| `render/tikzSource.ts` | LuaLaTeX document wrapper (fallback only) |
| `assets/tikzjax/` | Bundled TikZJax WASM assets (generated by `npm run build`) |
| `octave/` | Octave script generation, CSV, pipeline |
| `styles.css` | Glass UI and graph display styles |

---

## Roadmap

- Better Live Preview support
- More graph types and implicit plots
- Numeric ODE solving through Octave
- Numeric PDE grid generation through Octave
- Data import from files
- More export options
- Animation preview inside Obsidian
- Multiple static frames for PDF export

---

## Screenshots

> Screenshots will be added after the UI is finalized.

Suggested screenshots:

- Graph Builder Modal
- Inline Builder
- 2D Function Graph
- 3D Wireframe Surface
- PDE Surface
- Settings Tab

---

## License

[MIT](LICENSE) — Copyright © Sharbel Marshi
