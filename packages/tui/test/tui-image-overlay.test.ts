import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
	cropKittyImageLine,
	encodeKitty,
	getKittyImagePlacementRows,
	registerKittyImageMetadata,
	resetCapabilitiesCache,
	setCapabilities,
} from "../src/terminal-image.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { stripTerminalSequences, visibleWidth } from "../src/utils.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}
interface Placement extends Rect {
	id: number;
	placementId: number;
	source: Rect;
}

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

function image(id: number, width = 10, height = 6): string {
	registerKittyImageMetadata({
		imageId: id,
		columns: width,
		rows: height,
		widthPx: width * 10,
		heightPx: height * 20,
	});
	// Chunked uploads must remain intact when the image is split into several placements.
	return encodeKitty("A".repeat(8192), { imageId: id, columns: width, rows: height, moveCursor: false });
}

function imageLines(id = 7100): string[] {
	return ["header", `left ${image(id)}${" ".repeat(10)} right`, ...Array<string>(5).fill(""), "footer"];
}

// xterm does not draw graphics; decode placement commands alongside its text assertions.
function placements(output: string): Placement[] {
	const result: Placement[] = [];
	let x = 0,
		y = 0,
		savedX = 0,
		savedY = 0,
		offset = 0;
	for (const match of output.matchAll(/\x1b_G([^\x1b]*)\x1b\\|\x1b\[([\d;?]*)([A-Za-z])/g)) {
		x += visibleWidth(output.slice(offset, match.index));
		offset = match.index + match[0].length;
		if (match[1] !== undefined) {
			const controls = Object.fromEntries(
				match[1]
					.split(";", 1)[0]
					.split(",")
					.map((entry) => entry.split("=")),
			);
			if (controls.a !== "T" && controls.a !== "p") continue;
			result.push({
				x,
				y,
				width: Number(controls.c),
				height: Number(controls.r),
				id: Number(controls.i),
				placementId: Number(controls.p ?? 0),
				source: {
					x: Number(controls.x ?? 0),
					y: Number(controls.y ?? 0),
					width: Number(controls.w ?? Number(controls.c) * 10),
					height: Number(controls.h ?? Number(controls.r) * 20),
				},
			});
		} else {
			const values = match[2].split(";").map(Number);
			switch (match[3]) {
				case "H":
					y = (values[0] || 1) - 1;
					x = (values[1] || 1) - 1;
					break;
				case "B":
					y += values[0] || 1;
					break;
				case "G":
					x = (values[0] || 1) - 1;
					break;
				case "s":
					savedX = x;
					savedY = y;
					break;
				case "u":
					x = savedX;
					y = savedY;
					break;
			}
		}
	}
	return result;
}

function screenPlacements(lines: string[]): Placement[] {
	return placements(lines.map((line, row) => `\x1b[${row + 1};1H${line}`).join(""));
}

function contains(rect: Rect, x: number, y: number): boolean {
	return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

function assertClipped(
	actual: Placement[],
	bounds: Rect,
	covers: Rect[],
	source = { x: 0, y: 0, width: bounds.width * 10, height: bounds.height * 20 },
): void {
	for (let y = 0; y < 12; y++) {
		for (let x = 0; x < 40; x++) {
			const covered = covers.some((rect) => contains(rect, x, y));
			const expected = contains(bounds, x, y) && !covered ? 1 : 0;
			assert.equal(
				actual.filter((rect) => contains(rect, x, y)).length,
				expected,
				covered
					? `image must not cover modal cell (${x}, ${y})`
					: `image must cover each visible cell exactly once (${x}, ${y})`,
			);
		}
	}
	for (const piece of actual) {
		const left = source.x + Math.floor(((piece.x - bounds.x) * source.width) / bounds.width);
		const top = source.y + Math.floor(((piece.y - bounds.y) * source.height) / bounds.height);
		assert.deepEqual(
			piece.source,
			{
				x: left,
				y: top,
				width: source.x + Math.floor(((piece.x + piece.width - bounds.x) * source.width) / bounds.width) - left,
				height: source.y + Math.floor(((piece.y + piece.height - bounds.y) * source.height) / bounds.height) - top,
			},
			"cropped pieces must retain their original source pixels",
		);
	}
}

const modal = { render: () => ["MODAL", "server", "close"], invalidate() {} };
const bounds = { x: 5, y: 1, width: 10, height: 6 };

describe("Kitty images behind fullscreen overlays", () => {
	beforeEach(() => setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true }));
	afterEach(() => resetCapabilitiesCache());

	for (const position of [
		{ row: 1, col: 8 },
		{ row: 3, col: 8 },
		{ row: 1, col: 15 },
		{ row: 7, col: 5 },
	]) {
		it(`clips around a modal at row ${position.row}, column ${position.col} and restores on close`, () => {
			const tui = new OverlayTui(new VirtualTerminal(40, 12));
			const lines = imageLines();
			const overlay = tui.showOverlay(modal, { ...position, width: 5 });
			try {
				const screen = tui.compose(lines);
				assertClipped(screenPlacements(screen), bounds, [
					{ x: position.col, y: position.row, width: 5, height: 3 },
				]);
				assert.equal(stripTerminalSequences(screen[position.row]).slice(position.col, position.col + 5), "MODAL");
				assert.ok(stripTerminalSequences(screen[1]).startsWith("left "), "text beside the image must survive");
				overlay.hide();
				assert.deepEqual(tui.compose(lines), lines, "closing the modal must restore the original image");
			} finally {
				tui.stop();
			}
		});
	}

	it("removes fully covered images without leaving a placement", () => {
		const tui = new OverlayTui(new VirtualTerminal(40, 12));
		tui.showOverlay({ render: () => Array<string>(8).fill("modal"), invalidate() {} }, { row: 0, col: 0, width: 20 });
		try {
			assert.deepEqual(screenPlacements(tui.compose(imageLines())), []);
		} finally {
			tui.stop();
		}
	});

	it("preserves a bare image anchor beside the modal", () => {
		const tui = new OverlayTui(new VirtualTerminal(40, 12));
		tui.showOverlay(modal, { row: 0, col: 5, width: 12 });
		try {
			const screen = tui.compose([image(7200, 5, 3), "", ""]);
			assertClipped(screenPlacements(screen), { x: 0, y: 0, width: 5, height: 3 }, []);
			assert.equal(stripTerminalSequences(screen[0]).slice(5, 10), "MODAL");
		} finally {
			tui.stop();
		}
	});

	it("subtracts stacked modals and respects hidden overlays and focus order", () => {
		const tui = new OverlayTui(new VirtualTerminal(40, 12));
		const lines = imageLines();
		const lower = tui.showOverlay({ render: () => lines, invalidate() {} }, { row: 0, col: 0, width: 30 });
		const first = tui.showOverlay(modal, { row: 2, col: 6, width: 5 });
		const second = tui.showOverlay(modal, { row: 4, col: 9, width: 5 });
		const a = { x: 6, y: 2, width: 5, height: 3 },
			b = { x: 9, y: 4, width: 5, height: 3 };
		try {
			assertClipped(screenPlacements(tui.compose([])), bounds, [a, b]);
			second.setHidden(true);
			assertClipped(screenPlacements(tui.compose([])), bounds, [a]);
			second.setHidden(false);
			lower.focus();
			assertClipped(screenPlacements(tui.compose([])), bounds, []);
			first.hide();
		} finally {
			tui.stop();
		}
	});

	it("preserves the source offset of an image already clipped by scrolling", () => {
		const tui = new OverlayTui(new VirtualTerminal(40, 12));
		const lines = imageLines();
		// Only the final two image rows remain in the scroll viewport.
		const cropped = [cropKittyImageLine(lines[1], 4, 2), "", "after"];
		tui.showOverlay(modal, { row: 1, col: 8, width: 5 });
		try {
			assertClipped(
				screenPlacements(tui.compose(cropped)),
				{ ...bounds, y: 0, height: 2 },
				[{ x: 8, y: 1, width: 5, height: 3 }],
				{ x: 0, y: 80, width: 100, height: 40 },
			);
		} finally {
			tui.stop();
		}
	});

	it("clips images to their overlay bounds before later overlays cover them", () => {
		const tui = new OverlayTui(new VirtualTerminal(40, 12));
		tui.showOverlay({ render: () => [image(7300), "", ""], invalidate() {} }, { row: 1, col: 5, width: 8 });
		tui.showOverlay(modal, { row: 2, col: 8, width: 5 });
		try {
			assertClipped(
				screenPlacements(tui.compose([])),
				{ x: 5, y: 1, width: 8, height: 3 },
				[{ x: 8, y: 2, width: 5, height: 3 }],
				{ x: 0, y: 0, width: 80, height: 60 },
			);
		} finally {
			tui.stop();
		}
	});

	it("gives repeated placements of the same image distinct placement ids", () => {
		const tui = new OverlayTui(new VirtualTerminal(40, 12));
		const encoded = image(7400, 5, 3);
		tui.showOverlay(modal, { row: 1, col: 2, width: 10 });
		try {
			const pieces = screenPlacements(tui.compose([`${encoded}${" ".repeat(15)}${encoded}`, "", ""]));
			assertClipped(
				pieces.filter((piece) => piece.x < 15),
				{ x: 0, y: 0, width: 5, height: 3 },
				[{ x: 2, y: 1, width: 10, height: 3 }],
			);
			assertClipped(
				pieces.filter((piece) => piece.x >= 15),
				{ x: 15, y: 0, width: 5, height: 3 },
				[],
			);
			assert.equal(new Set(pieces.map((piece) => piece.placementId)).size, pieces.length);
		} finally {
			tui.stop();
		}
	});

	for (const wezterm of [false, true]) {
		it(`reuses uploads while opening, changing and closing a modal${wezterm ? " in WezTerm" : ""}`, async () => {
			const previous = process.env.WEZTERM_PANE;
			if (wezterm) process.env.WEZTERM_PANE = "1";
			const terminal = new RecordingTerminal(40, 12);
			const tui = new TuiAltScreen(terminal);
			const lines = imageLines(7500);
			let label = "MODAL";
			tui.setLayoutRoot({ render: () => lines, invalidate() {} });
			tui.start();
			try {
				await terminal.waitForRender();
				assert.ok(terminal.writes.includes("\x1b_Ga=T"), "image must initially be transmitted");
				terminal.writes = "";
				const overlay = tui.showOverlay(
					{ render: () => [label, "server", "close"], invalidate() {} },
					{ row: 3, col: 8, width: 5 },
				);
				await terminal.waitForRender();
				assert.ok(terminal.writes.includes("\x1b_Ga=d,d=a,q=2"), "opening modal must delete old placements");
				assert.ok(!/\x1b_Ga=[Tt]/.test(terminal.writes), "cropping must reuse the uploaded bitmap");
				assertClipped(placements(terminal.writes), bounds, [{ x: 8, y: 3, width: 5, height: 3 }]);
				assert.equal(terminal.getViewport()[3].slice(8, 13), "MODAL");
				terminal.writes = "";
				label = "EDIT";
				tui.requestRender();
				await terminal.waitForRender();
				assert.equal(terminal.getViewport()[3].slice(8, 12), "EDIT");
				if (wezterm) assertClipped(placements(terminal.writes), bounds, [{ x: 8, y: 3, width: 5, height: 3 }]);
				terminal.writes = "";
				overlay.hide();
				await terminal.waitForRender();
				assertClipped(placements(terminal.writes), bounds, []);
				assert.ok(!/\x1b_Ga=[Tt]/.test(terminal.writes), "closing must reuse the uploaded bitmap");
			} finally {
				tui.stop();
				if (previous === undefined) delete process.env.WEZTERM_PANE;
				else process.env.WEZTERM_PANE = previous;
			}
		});
	}

	it("rounds source crop boundaries consistently for odd-sized bitmaps", () => {
		const tui = new OverlayTui(new VirtualTerminal(40, 12));
		const lines = imageLines(7550);
		registerKittyImageMetadata({ imageId: 7550, columns: 10, rows: 6, widthPx: 103, heightPx: 127 });
		tui.showOverlay(modal, { row: 3, col: 8, width: 5 });
		try {
			assertClipped(screenPlacements(tui.compose(lines)), bounds, [{ x: 8, y: 3, width: 5, height: 3 }], {
				x: 0,
				y: 0,
				width: 103,
				height: 127,
			});
		} finally {
			tui.stop();
		}
	});

	it("uploads multiple images once when a modal is present on the first frame and survives resize", async () => {
		const terminal = new RecordingTerminal(40, 12);
		const tui = new TuiAltScreen(terminal);
		const lines = [`${image(7570, 5, 3)}${" ".repeat(15)}${image(7571, 5, 6)}`, ...Array<string>(5).fill("")];
		tui.setLayoutRoot({ render: () => lines, invalidate() {} });
		tui.showOverlay(modal, { row: 1, col: 2, width: 5 });
		tui.start();
		try {
			await terminal.waitForRender();
			assert.equal([...terminal.writes.matchAll(/\x1b_Ga=t,/g)].length, 2, "each bitmap needs exactly one upload");
			assert.ok(!terminal.writes.includes("\x1b_Ga=T"), "initial upload must not display the unclipped image");
			assertClipped(
				placements(terminal.writes).filter((piece) => piece.id === 7570),
				{ x: 0, y: 0, width: 5, height: 3 },
				[{ x: 2, y: 1, width: 5, height: 3 }],
			);
			assertClipped(
				placements(terminal.writes).filter((piece) => piece.id === 7571),
				{ x: 15, y: 0, width: 5, height: 6 },
				[],
			);
			terminal.writes = "";
			terminal.resize(42, 12);
			await terminal.waitForRender();
			assert.ok(!/\x1b_Ga=[Tt]/.test(terminal.writes), "resizing must reuse both uploads");
			assertClipped(
				placements(terminal.writes).filter((piece) => piece.id === 7570),
				{ x: 0, y: 0, width: 5, height: 3 },
				[{ x: 2, y: 1, width: 5, height: 3 }],
			);
			assertClipped(
				placements(terminal.writes).filter((piece) => piece.id === 7571),
				{ x: 15, y: 0, width: 5, height: 6 },
				[],
			);
		} finally {
			tui.stop();
		}
	});

	it("tracks the tallest of multiple image transmissions on one row", () => {
		assert.equal(getKittyImagePlacementRows(`${image(7600, 2, 2)}  ${image(7601, 5, 6)}`), 6);
	});
});
