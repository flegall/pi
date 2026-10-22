import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Box } from "../src/components/box.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { renderLayoutFrame } from "../src/layout.ts";
import { encodeKitty, getKittyImageMetadata, registerKittyImageMetadata } from "../src/terminal-image.ts";
import { type Component, Container } from "../src/tui.ts";
import { stripTerminalSequences } from "../src/utils.ts";

describe("scrolling partially visible Kitty images", () => {
	for (const wrapping of ["bare", "padded", "background"] as const) {
		it(`keeps the visible image slice when its anchor scrolls away (${wrapping})`, () => {
			const imageId = 12000 + ["bare", "padded", "background"].indexOf(wrapping);
			const sequence = encodeKitty("AAAA", { columns: 4, rows: 8, imageId, moveCursor: false });
			registerKittyImageMetadata({ imageId, columns: 4, rows: 8, widthPx: 40, heightPx: 160 });
			// The first row carries the image command; seven empty rows reserve the rest of its height.
			const image: Component = {
				render: () => [sequence, ...Array<string>(7).fill("")],
				invalidate: () => {},
			};
			const content = new Container();
			if (wrapping === "bare") {
				content.addChild(image);
			} else {
				// Box fills those empty rows with spaces and, optionally, background color codes.
				const box = new Box(1, 0, wrapping === "background" ? (text) => `\x1b[42m${text}\x1b[49m` : undefined);
				box.addChild(image);
				content.addChild(box);
			}
			content.addChild({ render: () => ["after", "", "", "", ""], invalidate: () => {} });
			const scrollView = new ScrollView(content);
			const render = () => renderLayoutFrame(scrollView, 20, 4, () => {}).lines;

			assert.equal(getKittyImageMetadata(render()[0]!)?.imageId, imageId);
			// Hide the image anchor above the four-row viewport; the remaining slice must stay visible.
			for (const hiddenRows of [1, 3, 7]) {
				scrollView.scrollTo(hiddenRows);
				const lines = render();
				const visibleRows = Math.min(4, 8 - hiddenRows);
				const metadata = getKittyImageMetadata(lines[0]!);
				assert.ok(
					metadata,
					`${wrapping} image disappeared after scrolling ${hiddenRows} of 8 rows off-screen; ${visibleRows} image rows should still be visible`,
				);
				assert.equal(metadata.imageId, imageId, "Scrolling must preserve the original image");
				// Kitty crops in pixels: 160 pixels / 8 image rows = 20 pixels per row.
				assert.ok(
					lines[0]!.includes(`y=${hiddenRows * 20},h=${visibleRows * 20},r=${visibleRows}`),
					`${wrapping} image should crop ${hiddenRows} rows from the top and display ${visibleRows} rows`,
				);
			}

			// All eight image rows are now above the viewport; only the following content should remain.
			scrollView.scrollTo(8);
			const after = render();
			assert.ok(after.every((line) => getKittyImageMetadata(line) === undefined));
			assert.equal(stripTerminalSequences(after[0]!).trim(), "after");

			// Scrolling back restores the image at the top of the viewport.
			scrollView.scrollToStart();
			assert.equal(getKittyImageMetadata(render()[0]!)?.imageId, imageId);
		});
	}
});
