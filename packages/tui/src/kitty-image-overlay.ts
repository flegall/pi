import { getKittyImageMetadata, getKittyImagePlacement } from "./terminal-image.ts";
import { visibleWidth } from "./utils.ts";

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface OverlayImage {
	id: number;
	rect: Rect;
	source: Rect;
	transmission: string;
	fragments: Rect[];
}

function intersect(a: Rect, b: Rect): Rect | undefined {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const right = Math.min(a.x + a.width, b.x + b.width);
	const bottom = Math.min(a.y + a.height, b.y + b.height);
	return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}

/** Keep graphics separate from text until all fullscreen overlays have been composited. */
export class KittyImageOverlay {
	private images: OverlayImage[] = [];

	extract(line: string, row: number, col: number, clip: Rect): string {
		let text = "";
		let offset = 0;
		while (true) {
			const placement = getKittyImagePlacement(line, offset);
			if (!placement) break;
			text += line.slice(offset, placement.start);
			const transmission = line.slice(placement.start, placement.start + placement.transmissionBytes);
			const metadata = getKittyImageMetadata(transmission)!;
			const controls = new Map(
				transmission
					.slice(3, transmission.indexOf(";"))
					.split(",")
					.map((entry) => entry.split("=") as [string, string]),
			);
			const rect = {
				x: col + visibleWidth(text),
				y: row,
				width: Number(controls.get("c") ?? metadata.columns),
				height: placement.rows,
			};
			const visible = intersect(rect, clip);
			if (visible) {
				this.images.push({
					id: metadata.imageId,
					rect,
					source: {
						x: Number(controls.get("x") ?? 0),
						y: Number(controls.get("y") ?? 0),
						width: Number(controls.get("w") ?? metadata.widthPx),
						height: Number(controls.get("h") ?? metadata.heightPx),
					},
					transmission,
					fragments: [visible],
				});
			}
			offset = placement.start + placement.transmissionBytes;
		}
		return text + line.slice(offset);
	}

	cover(overlay: Rect): void {
		for (const image of this.images) {
			image.fragments = image.fragments.flatMap((rect) => {
				const covered = intersect(rect, overlay);
				if (!covered) return [rect];
				return [
					{ x: rect.x, y: rect.y, width: rect.width, height: covered.y - rect.y },
					{
						x: rect.x,
						y: covered.y + covered.height,
						width: rect.width,
						height: rect.y + rect.height - covered.y - covered.height,
					},
					{ x: rect.x, y: covered.y, width: covered.x - rect.x, height: covered.height },
					{
						x: covered.x + covered.width,
						y: covered.y,
						width: rect.x + rect.width - covered.x - covered.width,
						height: covered.height,
					},
				].filter((piece) => piece.width > 0 && piece.height > 0);
			});
		}
	}

	paint(lines: string[]): void {
		const placementIds = new Map<number, number>();
		for (const image of this.images) {
			if (image.fragments.length === 0) continue;
			const { rect, source } = image;
			// Transmit without displaying; cached frames omit this upload and retain every cropped placement.
			let commands = image.transmission.replace("a=T", "a=t");
			for (const piece of image.fragments) {
				const x = source.x + Math.floor(((piece.x - rect.x) * source.width) / rect.width);
				const y = source.y + Math.floor(((piece.y - rect.y) * source.height) / rect.height);
				const right = source.x + Math.floor(((piece.x + piece.width - rect.x) * source.width) / rect.width);
				const bottom = source.y + Math.floor(((piece.y + piece.height - rect.y) * source.height) / rect.height);
				const id = (placementIds.get(image.id) ?? 0) + 1;
				placementIds.set(image.id, id);
				const down = piece.y - rect.y;
				commands += `\x1b[s${down > 0 ? `\x1b[${down}B` : ""}\x1b[${piece.x + 1}G`;
				commands += `\x1b_Ga=p,q=2,C=1,i=${image.id},p=${id},x=${x},y=${y},w=${Math.max(1, right - x)},h=${Math.max(1, bottom - y)},c=${piece.width},r=${piece.height}\x1b\\\x1b[u`;
			}
			lines[rect.y] += commands;
		}
	}
}
