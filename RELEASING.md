# Releasing Math Plotter

This checklist follows the [Obsidian plugin release guidelines](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions).

## Repository requirements

The repo root must contain:

| File | Purpose |
|------|---------|
| `manifest.json` | Plugin metadata |
| `main.js` | Compiled plugin (built artifact) |
| `styles.css` | Plugin styles |
| `README.md` | Documentation |
| `LICENSE` | License terms |
| `versions.json` | Maps each plugin version to its `minAppVersion` |

## Before each release

1. Bump `version` in `manifest.json` and `package.json` (must match, semver `x.y.z`).
2. Update `versions.json` when `minAppVersion` changes, or add a new version entry:

   ```json
   {
     "0.1.0": "1.5.0",
     "0.1.1": "1.5.0"
   }
   ```

3. Polish `manifest.json`:
   - Description ≤ 250 characters, action-oriented, ends with a period.
   - No empty optional fields (for example `authorUrl`).
   - `isDesktopOnly` set correctly.

4. Verify locally:

   ```bash
   npm run build
   npm run release:check
   npm run release:package
   ```

## Create a GitHub release

1. Commit the version bump and `versions.json` update.
2. Create an annotated tag that **exactly matches** `manifest.json` version (no `v` prefix):

   ```bash
   git tag -a 0.1.0 -m "0.1.0"
   git push origin 0.1.0
   ```

3. GitHub Actions (`.github/workflows/release.yml`) will:
   - Validate release metadata
   - Build the plugin and TikZJax assets
   - Attest `main.js`, `manifest.json`, and `styles.css`
   - Create a **draft** release with:
     - `main.js`
     - `manifest.json`
     - `styles.css`

   For manual installs with bundled TikZJax assets, run locally:

   ```bash
   npm run release:package
   ```

   This creates `math-plotter-full.zip` (not uploaded to GitHub releases).

4. Review the draft release on GitHub and publish it when ready.

## Community plugin submission

To submit to the [official plugin directory](https://github.com/obsidianmd/obsidian-releases):

1. Publish a GitHub release with the required assets attached as **individual files** (not only inside a zip).
2. Open a PR to `obsidianmd/obsidian-releases` adding an entry to `community-plugins.json`:

   ```json
   {
     "id": "math-plotter",
     "name": "Math Plotter",
     "author": "Sharbel Marshi",
     "description": "Create math graphs from a GUI. Insert plots via forms without writing plot code.",
     "repo": "YOUR_GITHUB_USER/math-plotter"
   }
   ```

3. Use the PR template checklist. Release tag must match `manifest.json` version exactly.

### TikZJax assets and community installs

Obsidian’s community installer downloads only `main.js`, `manifest.json`, and `styles.css`. It does **not** install the `assets/tikzjax/` folder required for high-quality TikZ rendering.

- **Fast SVG mode** works from the standard three release files.
- **TikZ / HQ rendering** requires TikZJax assets. For manual installs, use `math-plotter-full.zip` or build from source (`npm install && npm run build`).

If you need full TikZ support for community-plugin users without a manual build step, bundle or fetch assets at runtime in a future release.
