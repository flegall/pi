/** Interactive overlay/image reproduction: node packages/tui/test/image-overlay-demo.ts */
import { readFileSync } from "node:fs";
import { Box } from "../src/components/box.ts";
import { Image } from "../src/components/image.ts";
import { Text } from "../src/components/text.ts";
import { getKeybindings } from "../src/keybindings.ts";
import { ProcessTerminal } from "../src/terminal.ts";
import { getCapabilities } from "../src/terminal-image.ts";
import { Container, type OverlayHandle } from "../src/tui.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";

if (getCapabilities().images !== "kitty") {
	console.error("Run this demo in a Kitty-graphics terminal, such as cmux, Ghostty, Kitty, or WezTerm.");
	process.exit(1);
}

const terminal = new ProcessTerminal();
const tui = new TuiAltScreen(terminal);
const content = new Container();
content.addChild(new Text("Enter: toggle modal | Tab: move modal to image anchor | Ctrl+C: exit", 0, 0));
const box = new Box(1, 0, (text) => `\x1b[48;2;28;65;48m${text}\x1b[49m`);
box.addChild(new Text("Image behind modal", 0, 0));
box.addChild(
	new Image(
		readFileSync(new URL("../../ai/test/data/red-circle.png", import.meta.url)).toString("base64"),
		"image/png",
		{ fallbackColor: (text) => text },
		{ maxWidthCells: 80, maxHeightCells: 28 },
	),
);
content.addChild(box);
tui.setLayoutRoot(content);

const modal = new Box(2, 1, (text) => `\x1b[48;2;35;45;80m\x1b[97m${text}\x1b[0m`);
modal.addChild(
	new Text(
		"MODAL — all these lines should be readable\n\nServer: example\nStatus: connected\n\nEnter: close / reopen",
		0,
		0,
	),
);
let overlay: OverlayHandle | undefined;
let atAnchor = false;
function showModal(): void {
	overlay = tui.showOverlay(modal, { width: 52, row: atAnchor ? 2 : 7, col: 16 });
}
tui.addInputListener((input) => {
	const keys = getKeybindings();
	if (keys.matches(input, "tui.input.copy")) {
		tui.stop();
		process.exit(0);
	}
	if (keys.matches(input, "tui.input.submit")) {
		if (overlay) {
			overlay.hide();
			overlay = undefined;
		} else showModal();
		return { consume: true };
	}
	if (keys.matches(input, "tui.input.tab")) {
		atAnchor = !atAnchor;
		overlay?.hide();
		showModal();
		return { consume: true };
	}
	return undefined;
});
tui.start();
showModal();
