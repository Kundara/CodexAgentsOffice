These PNGs are extracted runtime-ready sprite cuts from `../PixelOfficeAssets.png`.

- `avatars/` keeps the fixed 16x32 character frames used by the office view.
- `chairs/` keeps the chair variants from the source atlas.
- `props/` keeps the standalone furniture and decor sprites used by the renderer.
- `icons/` keeps toast/event pixel SVGs plus state-marker PNGs such as `icons/state/hand.png`.
- `icons/thread-item/` keeps semantic thread-item icons used for audit coverage and generic item fallbacks.

The browser renderer should reference these files directly instead of slicing `PixelOfficeAssets.png` at runtime.

Additional icon sources used in this folder:

- `icons/worktree.png`, `icons/state/*.png`, and selected `icons/thread-item/*.png` assets are adapted from Justin Arnold's "Justin's 16x16 Icon Pack" (`https://zeromatrix.itch.io/rpgiab-icons`), released under CC BY 4.0.
