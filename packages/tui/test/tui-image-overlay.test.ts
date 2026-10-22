import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	cropKittyImageLine,
	encodeKitty,
	registerKittyImageMetadata,
	resetCapabilitiesCache,
	setCapabilities,
} from "../src/terminal-image.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { stripTerminalSequences } from "../src/utils.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class OverlayTui extends TuiAltScreen {
	compose(lines: string[]): string[] {
		return this.compositeOverlays(lines, 40, 12);
	}
}

class RecordingTerminal extends VirtualTerminal {
	writes = "";
	override write(data: string): void {
		this.writes += data;
		super.write(data);
	}
}

function imageLines(imageId: number): string[] {
	registerKittyImageMetadata({ imageId, columns: 10, rows: 6, widthPx: 100, heightPx: 120 });
	// A long payload exercises chunked transmissions, with text on both sides of the image.
	const image = encodeKitty("A".repeat(8192), { imageId, columns: 10, rows: 6, moveCursor: false });
	return ["header", `left ${image}${" ".repeat(10)} right`, ...Array<string>(5).fill(""), "footer"];
}

const modal = { render: () => ["MODAL", "server", "close"], invalidate() {} };

describe("Kitty images behind overlays", () => {
	beforeEach(() => setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true }));
	afterEach(() => resetCapabilitiesCache());

	for (const row of [1, 3]) {
		it(`hides an overlapping image when the modal starts on row ${row} and restores it on close`, () => {
			const tui = new OverlayTui(new VirtualTerminal(40, 12));
			const lines = imageLines(7100 + row);
			// Row 1 covers the image anchor; row 3 only covers the body below it.
			const overlay = tui.showOverlay(modal, { row, col: 8, width: 12 });
			try {
				const screen = tui.compose(lines);
				assert.ok(!screen.join("").includes("\x1b_G"), "overlapping image must not be drawn above the modal");
				assert.equal(stripTerminalSequences(screen[row]).slice(8, 13), "MODAL", "modal title must be visible");
				assert.ok(stripTerminalSequences(screen[1]).startsWith("left "), "text beside the image must survive");
				overlay.hide();
				assert.deepEqual(tui.compose(lines), lines, "closing the modal must restore the original image");
			} finally {
				tui.stop();
			}
		});
	}

	for (const position of [
		{ row: 1, col: 15 },
		{ row: 7, col: 5 },
	]) {
		it(`preserves images beside or above a modal at ${JSON.stringify(position)}`, () => {
			const tui = new OverlayTui(new VirtualTerminal(40, 12));
			const lines = imageLines(7200);
			tui.showOverlay(modal, { ...position, width: 12 });
			try {
				const screen = tui.compose(lines);
				assert.ok(screen[1].includes("\x1b_G"), "non-overlapping image must remain visible");
				assert.equal(stripTerminalSequences(screen[position.row]).slice(position.col, position.col + 5), "MODAL");
			} finally {
				tui.stop();
			}
		});
	}

	it("preserves a bare image anchor beside the modal", () => {
		const tui = new OverlayTui(new VirtualTerminal(40, 12));
		registerKittyImageMetadata({ imageId: 7250, columns: 5, rows: 3, widthPx: 50, heightPx: 60 });
		const image = encodeKitty("AAAA", { imageId: 7250, columns: 5, rows: 3, moveCursor: false });
		tui.showOverlay(modal, { row: 0, col: 5, width: 12 });
		try {
			const screen = tui.compose([image, "", ""]);
			assert.ok(screen[0].includes(image), "bare image anchor must survive compositing beside the modal");
			assert.equal(stripTerminalSequences(screen[0]).slice(5, 10), "MODAL");
		} finally {
			tui.stop();
		}
	});

	it("respects hidden overlays and their stacking order", () => {
		const tui = new OverlayTui(new VirtualTerminal(40, 12));
		const lines = imageLines(7300);
		const imageOverlay = tui.showOverlay({ render: () => lines, invalidate() {} }, { row: 0, col: 0, width: 30 });
		const top = tui.showOverlay(modal, { row: 3, col: 8, width: 12 });
		try {
			assert.ok(!tui.compose([]).join("").includes("\x1b_G"), "top modal must hide an image in a lower overlay");
			top.setHidden(true);
			assert.ok(tui.compose([]).join("").includes("\x1b_G"), "hidden modal must not suppress images");
			top.setHidden(false);
			imageOverlay.focus();
			assert.ok(tui.compose([]).join("").includes("\x1b_G"), "frontmost overlay's own image must remain visible");
		} finally {
			tui.stop();
		}
	});

	it("uses the visible height of a cropped image", () => {
		const tui = new OverlayTui(new VirtualTerminal(40, 12));
		const lines = imageLines(7400);
		const cropped = [cropKittyImageLine(lines[1], 4, 2), "", "after"];
		const overlay = tui.showOverlay(modal, { row: 2, col: 8, width: 12 });
		try {
			assert.ok(tui.compose(cropped)[0].includes("\x1b_G"), "modal below the cropped image must not hide it");
			overlay.hide();
			tui.showOverlay(modal, { row: 1, col: 8, width: 12 });
			assert.ok(!tui.compose(cropped)[0].includes("\x1b_G"), "modal covering the cropped image must hide it");
		} finally {
			tui.stop();
		}
	});

	it("deletes the terminal placement on open and reuses the cached image on close", async () => {
		const terminal = new RecordingTerminal(40, 12);
		const tui = new TuiAltScreen(terminal);
		const lines = imageLines(7500);
		tui.setLayoutRoot({ render: () => lines, invalidate() {} });
		tui.start();
		try {
			await terminal.waitForRender();
			assert.ok(terminal.writes.includes("\x1b_Ga=T"), "image must initially be transmitted");
			terminal.writes = "";
			const overlay = tui.showOverlay(modal, { row: 3, col: 8, width: 12 });
			await terminal.waitForRender();
			// xterm does not render graphics, so inspect placement commands as well as modal text.
			assert.ok(
				terminal.writes.includes("\x1b_Ga=d,d=a,q=2"),
				"opening modal must delete the existing image placement",
			);
			assert.ok(!/\x1b_Ga=[Tp]/.test(terminal.writes), "image must not be placed over the open modal");
			assert.equal(terminal.getViewport()[3].slice(8, 13), "MODAL");
			terminal.writes = "";
			overlay.hide();
			await terminal.waitForRender();
			assert.ok(terminal.writes.includes("\x1b_Ga=p"), "closing modal must restore the image placement");
			assert.ok(!terminal.writes.includes("\x1b_Ga=T"), "restoring the image must reuse the cached upload");
		} finally {
			tui.stop();
		}
	});
});
