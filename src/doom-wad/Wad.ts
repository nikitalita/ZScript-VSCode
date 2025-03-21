import Lump from "./Lumps/Lump";
import Reader from "./Reader";
import Writer from "./Writer";

export enum WadType {
	IWAD = "IWAD",
	PWAD = "PWAD"
};

export default class Wad
{
	type: WadType = WadType.PWAD;
	lumps: Lump[] = [];

	get lumpsTotalByteLength(): number
	{
		let result = 0;

		this.lumps.forEach(lump => { result += lump.length; });

		return result;
	}

	load(input: ArrayBuffer): void
	{
		const reader = new Reader(this);
		reader.read(input);
	}

	save(): ArrayBuffer
	{
		const writer	= new Writer(this);
		const size		= writer.getBufferSize();
		const result	= new ArrayBuffer(size);

		writer.write(result);

		return result;
	}
}