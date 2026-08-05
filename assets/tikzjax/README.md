# TikZJax assets

This folder is populated by `npm run build` via `scripts/copy-tikzjax-assets.mjs`.

- `node/` — bundled TikZJax runtime entry plus TeX/WASM support files
- `fonts.css` — font stylesheet copied from the TikZJax package

Do not load from a CDN. The plugin resolves assets locally for offline use.
