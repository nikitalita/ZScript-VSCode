import { addon } from "..";
import { IMonitorInfo, IRectangle } from "../interfaces";
import { release } from "os";

const getMonitorInfo = (id: number): IMonitorInfo | null => {
  if (!addon || !addon.getMonitorInfo) return null;
  return addon.getMonitorInfo(id);
}

export class Monitor {
  public id: number;

  constructor(id: number) {
    this.id = id;
  }

  getBounds(): IRectangle | null {
    return getMonitorInfo(this.id)?.bounds ?? null;
  }

  getWorkArea(): IRectangle | null {
    return getMonitorInfo(this.id)?.workArea ?? null;
  }

  isPrimary(): boolean | null {
    return getMonitorInfo(this.id)?.isPrimary ?? null;
  }

  getScaleFactor(): number | null {
    if (!addon || !addon.getMonitorScaleFactor) return null;

    const numbers = release()
      .split(".")
      .map(d => parseInt(d, 10));

    if (numbers[0] > 8 || (numbers[0] === 8 && numbers[1] >= 1)) {
      return addon.getMonitorScaleFactor(this.id);
    }

    return 1;
  };

  isValid(): boolean {
    return addon && addon.getMonitorInfo;
  }
}
