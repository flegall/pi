# Image/modal reproduction

Run from the repository root in cmux, Ghostty, Kitty, or WezTerm (at least 80 columns and 32 rows):

```sh
npm ci --ignore-scripts
node packages/tui/test/image-overlay-demo.ts
```

This uses Pi's fullscreen TUI and `showOverlay`, without an API key or extension.

- The modal opens across the image body. Every line of the modal should be readable.
- Press **Enter** to close and reopen it. Closing must restore the image.
- Press **Tab** to move the modal across the image's first row, then back across its body.
- Press **Ctrl+C** to exit before switching branches.

On `florent.legall/tui-image-overlay-repro`, the image obscures the modal.
On `florent.legall/tui-image-overlay-fixed-demo`, the overlapping image is temporarily hidden while the modal is open.

The companion branches are for reproduction only. Keep discussion on the fix PR.

![Captured in cmux](./screenshot.png)
