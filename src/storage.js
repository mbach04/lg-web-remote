import fs from "node:fs";
import path from "node:path";

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "data");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export class JsonStore {
  constructor(fileName, dataDir = process.env.DATA_DIR || DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
    this.filePath = path.join(this.dataDir, fileName);
    ensureDir(this.dataDir);
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, "{}\n", "utf8");
    }
  }

  read() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      return {};
    }
  }

  write(value) {
    fs.writeFileSync(this.filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}
