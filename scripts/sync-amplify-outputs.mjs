import { copyFile, mkdir, access } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const sourcePath = path.join(rootDir, "amplify_outputs.json");
const publicDir = path.join(rootDir, "public");
const targetPath = path.join(publicDir, "amplify_outputs.json");

try {
  await access(sourcePath);
  await mkdir(publicDir, { recursive: true });
  await copyFile(sourcePath, targetPath);
  console.log("Copied amplify_outputs.json to public/");
} catch {
  console.log("No amplify_outputs.json found at repo root; skipping copy");
}
