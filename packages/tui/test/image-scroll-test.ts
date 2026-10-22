/**
 * Manual fullscreen image clipping test. From the repository root:
 * node packages/tui/test/image-scroll-test.ts [image.png]
 * Scroll past the image's top edge: its remaining rows should stay visible.
 * Also shrink the terminal below the image height and scroll in both directions.
 */
import { readFileSync } from "node:fs";
import { Box } from "../src/components/box.ts";
import { Image } from "../src/components/image.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { getKeybindings, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS } from "../src/keybindings.ts";
import { ProcessTerminal } from "../src/terminal.ts";
import { getCapabilities } from "../src/terminal-image.ts";
import { Container } from "../src/tui.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";

if (getCapabilities().images !== "kitty") {
	console.error("This test needs a Kitty-graphics terminal such as Ghostty, cmux, Kitty, or WezTerm.");
	process.exit(1);
}

const path = process.argv[2] ?? new URL("../../ai/test/data/red-circle.png", import.meta.url);
const data = readFileSync(path).toString("base64");
setKeybindings(
	new KeybindingsManager(TUI_KEYBINDINGS, {
		"tui.altScreen.lineUp": "up",
		"tui.altScreen.lineDown": "down",
	}),
);

const terminal = new ProcessTerminal();
const tui = new TuiAltScreen(terminal);
const content = new Container();
const box = new Box(1, 1, (text) => `\x1b[48;2;28;65;48m${text}\x1b[49m`);
box.addChild(new Text("Padded image: scroll its top edge off screen", 0, 0));
box.addChild(
	new Image(data, "image/png", { fallbackColor: (text) => text }, { maxWidthCells: 80, maxHeightCells: 40 }),
);
box.addChild(new Text("End of image", 0, 0));
content.addChild(box);
content.addChild(new Text(Array.from({ length: 60 }, (_, i) => `Following text ${i + 1}`).join("\n"), 0, 0));
const scrollView = new ScrollView(content, { primary: true });
tui.setLayoutRoot(
	new VStack([
		{ component: scrollView, basis: 0, grow: 1 },
		new Text("Wheel / Up / Down: scroll | Ctrl+Home: top | Ctrl+C: exit", 0, 0),
	]),
);
tui.addInputListener((input) => {
	if (getKeybindings().matches(input, "tui.input.copy")) {
		tui.stop();
		process.exit(0);
	}
	return undefined;
});
tui.start();
