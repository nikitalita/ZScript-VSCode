import Lump from "./Lump";
import Textmap from "./Textmap";

export default class LumpFactory
{
	private static classesByName: Record<string, typeof Lump> = {};

	static registerClassForName(name: string, constructor: typeof Lump)
	{
		LumpFactory.classesByName[name.toUpperCase()] = constructor;
	}

	static createFromName(name: string)
	{
		let result: Lump;

		const trimmed = name.replace(/\0.*$/g,'').toUpperCase();

		if(!(trimmed in LumpFactory.classesByName))
			result = new Lump();
		else
			result = new LumpFactory.classesByName[trimmed]();

		result.name = name;

		return result;
	}
}

LumpFactory.registerClassForName("TEXTMAP", Textmap);