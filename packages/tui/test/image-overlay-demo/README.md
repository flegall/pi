# Image/modal reproduction

In a Kitty-graphics terminal such as cmux, Ghostty, Kitty, or WezTerm, use at least 80 columns and 32 rows:

```sh
npm ci --ignore-scripts
node packages/tui/test/image-overlay-demo.ts
```

The demo uses Pi's fullscreen TUI and needs no API key or extension.

- The modal opens automatically. **Enter** closes/reopens it.
- **Tab** moves it between the image body and its first row.
- **Ctrl+C** exits before switching branches.

On `florent.legall/tui-image-overlay-hide-repro`, the image covers the left part of the modal while its right side stays visible.
On `florent.legall/tui-image-overlay-hide-fixed-demo`, the overlapping image is hidden while the modal is open and restored on close.

Checkout only: keep discussion on the fix PR and do not merge the demos.

![Captured in cmux](./screenshot.png)
