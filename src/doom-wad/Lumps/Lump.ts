export default class Lump
{
	private _name: string = "";
	private _content: ArrayBuffer = new ArrayBuffer(0);

	get name(): string
	{
		return this._name;
	}

	set name(value: string)
	{
		value = value.trim().replace(/\0+$/g, "");

		if(!/^[A-Z0-9\[\]\-_\\]+$/.test(value))
			throw new Error("Invalid lump name");

		if(value.length > 8)
		{		
			console.warn(`Name ${value} will be truncated`);

			value = value.substring(0, 8);
		}

		this._name = value + Array( 8 - value.length + 1 ).join("\x00");
	}

	get content(): ArrayBuffer
	{
		return this._content;
	}

	set content(value: ArrayBuffer)
	{
		this._content = value;
	}

	get length(): number
	{
		return this.content.byteLength; // NB: Add terminator
	}
}