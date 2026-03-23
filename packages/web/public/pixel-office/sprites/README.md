These PNGs are extracted runtime-ready sprite cuts from `../PixelOfficeAssets.png`.

- `avatars/` keeps the fixed 16x32 character frames used by the office view.
- `chairs/` keeps the chair variants from the source atlas.
- `props/` keeps the standalone furniture and decor sprites used by the renderer.

The browser renderer should reference these files directly instead of slicing `PixelOfficeAssets.png` at runtime.
