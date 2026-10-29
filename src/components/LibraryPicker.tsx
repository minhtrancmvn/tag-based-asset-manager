import { FolderOpen } from "lucide-react";
import type { LibrarySummary } from "../types";
import { SelectMenu } from "./SelectMenu";

interface LibraryPickerProps {
  libraries: LibrarySummary[];
  activeLibraryId: string | null;
  disabled: boolean;
  onActivate: (libraryId: string) => void;
}

/** Sidebar library selector: name plus root path inside the box and in each option. */
export function LibraryPicker({ libraries, activeLibraryId, disabled, onActivate }: LibraryPickerProps) {
  return (
    <SelectMenu
      id="library-picker"
      className="library-picker"
      label="Active library"
      listLabel="Libraries"
      options={libraries.map((library) => ({ value: library.id, label: library.name, detail: library.rootPath }))}
      value={activeLibraryId}
      placeholder={libraries.length ? "Choose a library" : "No libraries"}
      disabled={disabled}
      onChange={onActivate}
      leading={<span className="library-avatar"><FolderOpen size={18} strokeWidth={1.7} /></span>}
    />
  );
}
