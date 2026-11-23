import { resolveSopDataRoot } from "../config.js";
import { SopDatabase } from "./sop-database.js";

const command = process.argv[2] ?? "health";
const argument = process.argv[3] ?? "";
const dataRoot = resolveSopDataRoot();
if (command === "restore") {
  await SopDatabase.restoreOffline({ sopDataRoot: dataRoot }, argument);
  process.stdout.write("SOP database restored; restart BFF after checking health.\n");
} else {
  const database = new SopDatabase({ sopDataRoot: dataRoot });
  try {
    if (command === "backup") {
      const fileName = await database.backup(argument || "manual");
      process.stdout.write(`${fileName}\n`);
    } else if (command === "health") {
      process.stdout.write(`${JSON.stringify(database.health())}\n`);
    } else {
      throw new Error(`未知命令：${command}`);
    }
  } finally {
    database.onModuleDestroy();
  }
}
