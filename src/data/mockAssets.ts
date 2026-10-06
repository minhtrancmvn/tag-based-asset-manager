import type { Asset, LibrarySummary } from "../types";

/** Deliberately fictional demo rows used only in unit tests. Desktop app does not read these rows. */
export const demoLibrary: LibrarySummary = {
  id: "demo-library",
  name: "Workshop Library",
  rootPath: "Sample library · demonstration only",
  assetCount: 16,
  lastScanAt: null,
};

export const mockAssets: Asset[] = [
  { id: "a1", name: "Figures", relativePath: "Figures", kind: "folder", extension: null, modifiedAt: "2026-10-03T16:20:00Z", sizeBytes: null, tags: ["collection:3d-models"], status: "ready", notes: "All printable characters." },
  { id: "a2", name: "Flexi Dragon.3mf", relativePath: "Figures/Flexi Dragon.3mf", kind: "file", extension: "3mf", modifiedAt: "2026-10-04T09:45:00Z", sizeBytes: 14_820_352, tags: ["category:animal", "style:flexi", "theme:fantasy", "status:printed"], status: "ready", notes: "Works well in PLA." },
  { id: "a3", name: "Robot.stl", relativePath: "Figures/Robot.stl", kind: "file", extension: "stl", modifiedAt: "2026-10-02T14:12:00Z", sizeBytes: 7_354_368, tags: ["category:figure", "status:to-print"], status: "ready" },
  { id: "a4", name: "Animals", relativePath: "Animals", kind: "folder", extension: null, modifiedAt: "2026-09-29T10:12:00Z", sizeBytes: null, tags: ["category:animal"], status: "ready" },
  { id: "a5", name: "Articulated Octopus.3mf", relativePath: "Animals/Articulated Octopus.3mf", kind: "file", extension: "3mf", modifiedAt: "2026-10-03T12:05:00Z", sizeBytes: 9_815_040, tags: ["category:animal", "style:flexi", "status:to-print"], status: "ready" },
  { id: "a6", name: "Fox Pendant.step", relativePath: "Animals/Fox Pendant.step", kind: "file", extension: "step", modifiedAt: "2026-09-26T17:04:00Z", sizeBytes: 2_582_528, tags: ["category:animal", "style:minimal"], status: "ready" },
  { id: "a7", name: "Reference", relativePath: "Reference", kind: "folder", extension: null, modifiedAt: "2026-10-01T11:55:00Z", sizeBytes: null, tags: [], status: "untagged" },
  { id: "a8", name: "Dragon paint guide.pdf", relativePath: "Reference/Dragon paint guide.pdf", kind: "file", extension: "pdf", modifiedAt: "2026-10-01T11:55:00Z", sizeBytes: 1_310_720, tags: ["theme:fantasy", "reference:painting"], status: "ready" },
  { id: "a9", name: "Miniatures", relativePath: "Miniatures", kind: "folder", extension: null, modifiedAt: "2026-09-24T13:20:00Z", sizeBytes: null, tags: ["category:figure"], status: "ready" },
  { id: "a10", name: "Knight tabletop v2.stl", relativePath: "Miniatures/Knight tabletop v2.stl", kind: "file", extension: "stl", modifiedAt: "2026-09-30T08:41:00Z", sizeBytes: 4_521_984, tags: ["category:figure", "theme:fantasy", "status:printed"], status: "ready" },
  { id: "a11", name: "Paint swatches.png", relativePath: "Reference/Paint swatches.png", kind: "file", extension: "png", modifiedAt: "2026-09-22T18:28:00Z", sizeBytes: 843_776, tags: [], status: "untagged" },
  { id: "a12", name: "Octopus detail.jpg", relativePath: "Animals/Octopus detail.jpg", kind: "file", extension: "jpg", modifiedAt: "2026-09-27T10:08:00Z", sizeBytes: 2_105_344, tags: ["category:animal", "reference:photo"], status: "ready" },
  { id: "a13", name: "Display stand.3mf", relativePath: "Figures/Display stand.3mf", kind: "file", extension: "3mf", modifiedAt: "2026-10-02T07:51:00Z", sizeBytes: 1_925_120, tags: ["status:to-print", "material:pla"], status: "ready" },
  { id: "a14", name: "Packaging", relativePath: "Packaging", kind: "folder", extension: null, modifiedAt: "2026-09-21T15:02:00Z", sizeBytes: null, tags: [], status: "untagged" },
  { id: "a15", name: "Fox in motion.zip", relativePath: "Animals/Fox in motion.zip", kind: "file", extension: "zip", modifiedAt: "2026-09-19T13:22:00Z", sizeBytes: 26_214_400, tags: ["category:animal", "style:flexi", "material:pla"], status: "ready" },
  { id: "a16", name: "Old creature sketch.svg", relativePath: "Reference/Old creature sketch.svg", kind: "file", extension: "svg", modifiedAt: null, sizeBytes: null, tags: ["theme:fantasy"], status: "missing", notes: "Demo of a stale metadata reference." },
];
