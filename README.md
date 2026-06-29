# MathGraph Studio

A GUI-based mathematical graph builder for Obsidian using local LuaLaTeX, TikZ, PGFPlots, and optional Octave sampling.

---

## Overview

MathGraph Studio lets you create mathematical graphs in Obsidian **without** writing TikZ, PGFPlots, JSON, YAML, or LaTeX by hand.

You build graphs through:

- **Ribbon command** — click the line-chart icon in the left ribbon
- **Command palette** — run **Insert Math Graph**
- **Empty ` ```graph ` block** — type an empty fenced block and use the inline builder

The plugin stores graph configuration inside a ` ```graph ` block as JSON. In **Reading View**, that block is replaced by the rendered graph image. You normally interact through the GUI, not by editing the JSON directly.

---

## Key Features

- **GUI graph builder** — full modal with function, ranges, parameters, points, style, and size controls
- **Inline graph builder** — quick setup when you create an empty ` ```graph ` block
- **2D function graphs** — plot `y = f(x)`
- **3D surface graphs** — plot `z = f(x, y)` with wireframe mesh by default
- **PDE explicit solution surfaces** — plot a user-provided solution `u(x, y, t)` (v1 does not solve PDEs symbolically)
- **ODE explicit solution plots** — plot a user-provided solution (v1 does not solve ODEs symbolically)
- **Parametric graphs** — 2D and 3D parametric curves (full modal builder)
- **Data plots** — plot `(x, y)` point pairs
- **Labeled points** — overlay annotated points on graphs
- **Wireframe / grid surfaces** — default 3D style uses PGFPlots `mesh`
- **Transparent graph output** — borderless, transparent SVG by default
- **Export size and scaling** — separate LaTeX axis size and Obsidian display scale
- **Local LuaLaTeX rendering** — compiles TikZ/PGFPlots on your machine
- **Optional Octave engine** — numerical sampling for selected graph modes
- **Render cache** — in-memory cache for recently compiled graphs
- **SVG display and export** — graphs render as SVG; PNG export available from the graph toolbar

---

## Design Philosophy

MathGraph Studio is **GUI-first**.

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
| PGFPlots / LuaLaTeX | `compileExpressionForPgfplots()` — e.g. `deg()` for trig, `ln()` for natural log |
| Octave (optional) | `compileExpressionForOctave()` — elementwise `.^`, `.*`, `./`, radians |

Each backend compiles from the **original user expression**. PGFPlots-normalized output is never passed to Octave, and vice versa.

---

## Installation

1. Clone or copy this repository into your Obsidian plugins folder:

   ```text
   Vault/.obsidian/plugins/mathgraph-studio/
   ```

2. Install dependencies and build:

   ```bash
   cd Vault/.obsidian/plugins/mathgraph-studio
   npm install
   npm run build
   ```

3. In Obsidian: **Settings → Community plugins → MathGraph Studio → Enable**

This plugin is **desktop-only** (`isDesktopOnly: true`). It runs local programs (LuaLaTeX, and optionally Octave) and does not work on Obsidian Mobile.

---

## Requirements

### Required

| Tool | Purpose |
|------|---------|
| **Obsidian Desktop** | Host application |
| **Node.js / npm** | Development and building the plugin |
| **LuaLaTeX** | Compiles TikZ/PGFPlots to PDF/SVG |
| **PGFPlots** | LaTeX plotting package (included in most TeX distributions) |
| **pdftocairo** | Converts PDF output to SVG (Poppler) |

Typical macOS LuaLaTeX path (auto-detected):

```text
/Library/TeX/texbin/lualatex
```

Install a full TeX distribution such as [MacTeX](https://tug.org/mactex/) if LuaLaTeX is not on your PATH.

### Optional

| Tool | Purpose |
|------|---------|
| **GNU Octave** | Numerical function sampling before PGFPlots plotting |

Typical Homebrew Octave path on macOS (auto-detected):

```text
/opt/homebrew/bin/octave-cli
```

Octave is **not required** for basic 2D graphs or many symbolic 3D surfaces.

---

## Basic Usage

### Workflow A: Ribbon

1. Open a note in Obsidian.
2. Click the **line-chart** ribbon icon (**Insert Math Graph**).
3. Choose a graph type, enter the function, ranges, labels, and style.
4. Click **Insert Graph**.
5. Switch to Reading View — the rendered graph appears in the note.

### Workflow B: Command Palette

1. Open the command palette (`Cmd/Ctrl + P`).
2. Run **Insert Math Graph**.
3. Fill in the graph builder modal.
4. Click **Insert Graph**.

### Workflow C: Inline Builder

1. In a note, type a fenced block:

   ````markdown
   ```graph
   
   ```
   ````

2. MathGraph Studio detects the empty block and shows an **inline field-based builder**.
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

> **Important:** v1 plots explicit solutions only. MathGraph Studio does **not** symbolically solve arbitrary ODEs.

### PDE Solution

Plot an **explicit** solution surface or slice.

- **Equation label:** `u_t = u_xx + u_yy`
- **Solution:** `exp(-2*t)*sin(x)*sin(y)`
- **Parameter:** `t = 0.25`

> **Important:** v1 plots explicit solutions only. MathGraph Studio does **not** symbolically solve arbitrary PDEs.

### Parametric 2D / 3D

Available in the **full graph builder modal** (not the inline quick builder).

- Enter `x(t)`, `y(t)`, and optionally `z(t)`
- Set the parameter range for `t`

### Data Plot

Enter `(x, y)` pairs manually or paste comma-separated values.

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

## Rendering Backends

### LuaLaTeX + PGFPlots (main backend)

- Generates TikZ/PGFPlots source from the graph spec
- Compiles locally with LuaLaTeX
- Best for clean academic graphs, 2D plots, and many symbolic 3D surfaces
- Used by default when Octave is disabled or not selected

### Octave Engine (optional)

- Samples functions numerically when enabled
- Useful for 3D surfaces, large grids, and numeric ODE/PDE modes
- **Does not replace LaTeX** — Octave produces data; PGFPlots still renders the final graph

**Pipeline with Octave:**

```text
GUI expression (user syntax)
  → compileExpressionForOctave()
  → run Octave script
  → graph-data.csv  (columns: x, y, z)
  → PGFPlots table import (col sep=comma)
  → LuaLaTeX renders final SVG
```

Per-graph **Render mode** options: **Auto**, **Symbolic (PGFPlots)**, **Octave (numeric)** (Octave option appears when enabled in settings).

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

**Default:** wireframe grid (`mesh` in PGFPlots) — clean and academic.

In the graph builder **Style** section you can set:

- **Color** — line/surface color
- **Line width** — PGFPlots width option

Solid filled surfaces and rainbow colormaps are not the default in v1. The focus is readable, publication-style wireframe output.

---

## Graph Sizing and Scaling

MathGraph Studio separates two size concepts:

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

Rendered graphs are **transparent and borderless** by default so they blend into your note.

**Rendered graph frame** setting (optional border in notes):

| Option | Effect |
|--------|--------|
| **None** (default) | Transparent, no frame |
| **Subtle** | Light border |
| **Glass card** | Frosted card frame |

The builder UI may use a glass style, but inserted graphs stay clean unless you choose a frame.

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

Open **Settings → MathGraph Studio**.

### Appearance

| Setting | Description |
|---------|-------------|
| **UI style** | Glass (frosted panels) or Native Obsidian |
| **Rendered graph frame** | None / Subtle / Glass card |

### Default graph size (LaTeX)

| Setting | Default |
|---------|---------|
| **Default size preset** | Large |
| **Default 2D width / height** | 15 cm / 9 cm |
| **Default 3D width / height** | 15 cm / 10 cm |
| **Default display scale** | 100% |

### Rendering

| Setting | Description |
|---------|-------------|
| **Enable Octave engine** | Turn on optional numerical sampling |
| **Octave path** | Custom path, or empty for auto-detect |
| **Prefer Octave for 3D surfaces** | Use Octave for 3D surface sampling |
| **Prefer Octave for ODE/PDE numeric mode** | Use Octave when `numericMode` is set |

### Auto-detected (not in settings UI)

| Item | Behavior |
|------|----------|
| **LuaLaTeX path** | Auto-detected (`/Library/TeX/texbin/lualatex`, PATH, etc.) |
| **Render timeout** | 60 s (LaTeX), 120 s (Octave) |
| **Render cache** | In-memory, ~32 entries, 30 min TTL |
| **Output format** | SVG in Reading View; export SVG or PNG from graph toolbar |

---

## Troubleshooting

### LuaLaTeX not found

Install a TeX distribution (e.g. MacTeX) and ensure `lualatex` is available:

```bash
which lualatex
```

Expected on macOS: `/Library/TeX/texbin/lualatex`

### PGFPlots expression error

Use simple syntax: `sin^2(x)`, `x^2`, `exp(-x)`, `sqrt(x^2+y^2)`.

Do **not** type PGFPlots syntax (`deg()`, `\\addplot`, etc.) in function fields.

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

## Development

```bash
npm install
npm run build        # production build → main.js
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
| `graphSyntax.ts` | User → PGFPlots / Octave compilers |
| `graphPreprocessor.ts` | Graph DSL → PGFPlots expansion |
| `render/renderer.ts` | `TikzRenderer` — LuaLaTeX compile + cache |
| `render/commandResolver.ts` | LuaLaTeX / pdftocairo path resolution |
| `render/tikzSource.ts` | LaTeX document wrapper |
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
