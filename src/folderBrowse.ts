import type { Asset } from "./types";

export function parentFolder(relativePath: string): string {
  const separator = relativePath.lastIndexOf("/");
  return separator < 0 ? "" : relativePath.slice(0, separator);
}

/** Navigation uses the approved scan index, not filesystem paths supplied to native commands. */
export function folderIndex(assets: Asset[]): Map<string, Asset[]> {
  const folders = new Map<string, Asset[]>();
  for (const asset of assets) {
    if (asset.relativePath === ".") continue;
    if (asset.kind === "folder" && asset.status === "missing") continue;
    const parent = parentFolder(asset.relativePath);
    const siblings = folders.get(parent);
    if (siblings) siblings.push(asset);
    else folders.set(parent, [asset]);
  }
  return folders;
}

export function folderBreadcrumbs(folder: string): { name: string; path: string }[] {
  if (!folder) return [];
  let path = "";
  return folder.split("/").map((name) => {
    path = path ? `${path}/${name}` : name;
    return { name, path };
  });
}
