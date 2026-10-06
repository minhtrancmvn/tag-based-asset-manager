use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

pub const MANIFEST_NAME: &str = ".asset-tags.json";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema_version: u32,
    pub updated_at: String,
    pub items: BTreeMap<String, Entry>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Entry {
    pub id: String,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Entry {
    pub fn absent() -> Self {
        Self {
            id: String::new(),
            tags: Vec::new(),
            notes: None,
            extra: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum ReadManifest {
    Missing,
    Valid {
        manifest: Manifest,
        bytes: Vec<u8>,
    },
    Blocked {
        bytes: Option<Vec<u8>>,
        error: String,
    },
}

// serde_json's default Value/map parser silently keeps the last duplicate key.
// Sidecars must not lose identities or unknown fields during an edit.
struct UniqueValue(Value);

impl<'de> Deserialize<'de> for UniqueValue {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = UniqueValue;
            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("JSON without duplicate object keys")
            }
            fn visit_bool<E: serde::de::Error>(self, value: bool) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::Bool(value)))
            }
            fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::from(value)))
            }
            fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::from(value)))
            }
            fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Self::Value, E> {
                serde_json::Number::from_f64(value)
                    .map(|number| UniqueValue(Value::Number(number)))
                    .ok_or_else(|| E::custom("Invalid JSON number"))
            }
            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::String(value.into())))
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::Null))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                while let Some(UniqueValue(value)) = sequence.next_element()? {
                    values.push(value);
                }
                Ok(UniqueValue(Value::Array(values)))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Self::Value, A::Error> {
                let mut values = serde_json::Map::new();
                while let Some(key) = map.next_key::<String>()? {
                    if values.contains_key(&key) {
                        return Err(serde::de::Error::custom(format!(
                            "Duplicate JSON key {key:?}"
                        )));
                    }
                    let UniqueValue(value) = map.next_value()?;
                    values.insert(key, value);
                }
                Ok(UniqueValue(Value::Object(values)))
            }
        }
        deserializer.deserialize_any(Visitor)
    }
}

impl Manifest {
    pub fn empty() -> Self {
        Self {
            schema_version: 1,
            updated_at: now(),
            items: BTreeMap::new(),
            extra: BTreeMap::new(),
        }
    }

    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let UniqueValue(raw) = serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
        let value: Self = serde_json::from_value(raw.clone()).map_err(|error| error.to_string())?;
        if value.schema_version != 1 {
            return Err(format!(
                "Unsupported metadata schema version {}",
                value.schema_version
            ));
        }
        DateTime::parse_from_rfc3339(&value.updated_at)
            .map_err(|_| "updatedAt must be an RFC 3339 timestamp".to_string())?;
        for (key, entry) in &value.items {
            validate_key(key)?;
            if entry.notes.is_none() && raw["items"][key].get("notes").is_some() {
                return Err(format!(
                    "notes must be a string when present for metadata entry {key:?}"
                ));
            }
            uuid::Uuid::parse_str(&entry.id)
                .map_err(|_| format!("Invalid UUID for metadata entry {key:?}"))?;
            for tag in &entry.tags {
                if tag.trim().is_empty() {
                    return Err(format!("Empty tag in metadata entry {key:?}"));
                }
            }
        }
        Ok(value)
    }

    pub fn serialize(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec_pretty(self).map_err(|error| error.to_string())
    }
}

pub fn normalize_tags(tags: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut values: Vec<_> = tags
        .into_iter()
        .map(|tag| tag.trim().to_lowercase())
        .filter(|tag| !tag.is_empty())
        .collect();
    values.sort();
    values.dedup();
    values
}

pub fn validate_key(key: &str) -> Result<(), String> {
    if key == "." {
        return Ok(());
    }
    if key.is_empty()
        || key == ".."
        || key.starts_with("../")
        || key.starts_with("..\\")
        || key.contains('/')
        || key.contains('\\')
        || key.contains(':')
        || key == MANIFEST_NAME
        || key.starts_with(".asset-tags.tmp-")
        || Path::new(key).is_absolute()
        || Path::new(key).components().count() != 1
        || Path::new(key).file_name().and_then(|value| value.to_str()) != Some(key)
    {
        return Err(format!("Invalid metadata item key {key:?}"));
    }
    Ok(())
}

pub fn read(directory: &Path) -> ReadManifest {
    let path = directory.join(MANIFEST_NAME);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return ReadManifest::Missing,
        Err(error) => {
            return ReadManifest::Blocked {
                bytes: None,
                error: error.to_string(),
            }
        }
    };
    if reject_manifest_metadata(&metadata).is_err() || !metadata.is_file() {
        return ReadManifest::Blocked {
            bytes: None,
            error: "Manifest is not a safe regular file".into(),
        };
    }
    match fs::read(&path) {
        Ok(bytes) => match Manifest::parse(&bytes) {
            Ok(manifest) => ReadManifest::Valid { manifest, bytes },
            Err(error) => ReadManifest::Blocked {
                bytes: Some(bytes),
                error,
            },
        },
        Err(error) => ReadManifest::Blocked {
            bytes: None,
            error: error.to_string(),
        },
    }
}

#[cfg(unix)]
fn reject_manifest_metadata(metadata: &fs::Metadata) -> Result<(), ()> {
    use std::os::unix::fs::MetadataExt;
    if metadata.file_type().is_symlink() || metadata.nlink() != 1 {
        Err(())
    } else {
        Ok(())
    }
}
#[cfg(windows)]
fn reject_manifest_metadata(metadata: &fs::Metadata) -> Result<(), ()> {
    use std::os::windows::fs::MetadataExt;
    if metadata.file_type().is_symlink() || metadata.file_attributes() & 0x0400 != 0 {
        Err(())
    } else {
        Ok(())
    }
}
#[cfg(not(any(unix, windows)))]
fn reject_manifest_metadata(metadata: &fs::Metadata) -> Result<(), ()> {
    if metadata.file_type().is_symlink() {
        Err(())
    } else {
        Ok(())
    }
}

pub fn metadata_revision(
    entry: Option<&Entry>,
    key: &str,
    kind: &str,
    owner: &str,
    state: &str,
) -> String {
    revision(&(entry, key, kind, owner, state))
}

pub fn revision(payload: &impl Serialize) -> String {
    let bytes = serde_json::to_vec(payload).expect("revision payload serializes");
    format!("sha256:{}", hex(&Sha256::digest(bytes)))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn edit_entry(
    directory: &Path,
    key: &str,
    expected_target_revision: &str,
    add_tags: &[String],
    remove_tags: &[String],
) -> Result<(Entry, Vec<u8>), String> {
    validate_key(key)?;
    let path = directory.join(MANIFEST_NAME);
    let current = read(directory);
    let (mut manifest, original_bytes) = match current {
        ReadManifest::Missing => (Manifest::empty(), None),
        ReadManifest::Valid { manifest, bytes } => (manifest, Some(bytes)),
        ReadManifest::Blocked { error, .. } => return Err(format!("Manifest is blocked: {error}")),
    };
    let existing = manifest.items.get(key).cloned();
    let actual_revision = revision(&(&existing, key));
    if actual_revision != expected_target_revision {
        return Err("Metadata changed since scan; rescan before editing".into());
    }
    let (entry, changed) = mutate_tags(&mut manifest, key, add_tags, remove_tags);
    if !changed {
        return Ok((entry, original_bytes.unwrap_or_default()));
    }
    let bytes = manifest.serialize()?;
    write_atomic(&path, original_bytes.as_deref(), &bytes)?;
    Ok((entry, bytes))
}

// Validated owner/key only. Shared by single and grouped edits; remove then add means adds win overlap.
pub fn mutate_tags(
    manifest: &mut Manifest,
    key: &str,
    add_tags: &[String],
    remove_tags: &[String],
) -> (Entry, bool) {
    let existing = manifest.items.get(key).cloned();
    let normalized_old_tags = normalize_tags(
        existing
            .as_ref()
            .map(|entry| entry.tags.clone())
            .unwrap_or_default(),
    );
    let mut next_tags = normalized_old_tags.clone();
    let removes = normalize_tags(remove_tags.iter().cloned());
    next_tags.retain(|tag| !removes.contains(tag));
    next_tags.extend(add_tags.iter().cloned());
    let next_tags = normalize_tags(next_tags);
    if next_tags == normalized_old_tags {
        return (existing.unwrap_or_else(Entry::absent), false);
    }
    let mut entry = existing.unwrap_or_else(|| Entry {
        id: uuid::Uuid::new_v4().to_string(),
        ..Entry::absent()
    });
    entry.tags = next_tags;
    manifest.items.insert(key.to_string(), entry.clone());
    manifest.updated_at = now();
    (entry, true)
}

pub fn write_atomic(path: &Path, expected: Option<&[u8]>, bytes: &[u8]) -> Result<(), String> {
    path.parent().ok_or("Invalid manifest path")?;
    match fs::symlink_metadata(path) {
        Ok(metadata) if reject_manifest_metadata(&metadata).is_err() || !metadata.is_file() => {
            return Err("Manifest is not a safe regular file".into())
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && expected.is_none() => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err("Manifest changed since scan; rescan before editing".into())
        }
        Err(error) => return Err(format!("Could not inspect manifest: {error}")),
    }
    let actual = match fs::read(path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("Could not read manifest: {error}")),
    };
    if actual.as_deref() != expected {
        return Err("Manifest changed before replacement; rescan before editing".into());
    }
    write_atomic_with_replace(path, expected, bytes, replace)
}

pub(crate) fn write_atomic_with_replace(
    path: &Path,
    expected: Option<&[u8]>,
    bytes: &[u8],
    replace_fn: impl FnOnce(&Path, &Path) -> Result<(), String>,
) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid manifest path")?;
    let temp = parent.join(format!(".asset-tags.tmp-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| format!("Could not create manifest temporary file: {error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("Could not write manifest: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Could not flush manifest: {error}"))?;
        drop(file);
        match fs::symlink_metadata(path) {
            Ok(metadata) if reject_manifest_metadata(&metadata).is_err() || !metadata.is_file() => {
                return Err("Manifest is not a safe regular file".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && expected.is_none() => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err("Manifest changed before replacement; rescan before editing".into());
            }
            Err(error) => {
                return Err(format!(
                    "Could not inspect manifest before replacement: {error}"
                ))
            }
        }
        let recheck = match fs::read(path) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(format!("Could not recheck manifest: {error}")),
        };
        if recheck.as_deref() != expected {
            return Err("Manifest changed before replacement; rescan before editing".into());
        }
        replace_fn(&temp, path)?;
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn replace(temp: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        fs::rename(temp, destination)
            .map_err(|error| format!("Could not replace manifest: {error}"))
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let source: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let target: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let moved = unsafe {
            MoveFileExW(
                source.as_ptr(),
                target.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if moved == 0 {
            Err(format!(
                "Could not replace manifest: {}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn parses_serializes_normalizes_and_preserves_unknown_fields() {
        let input = br#"{"schemaVersion":1,"updatedAt":"2026-10-05T00:00:00Z","future":7,"items":{"model.stl":{"id":"76bfd01c-2055-43b1-996a-c3f9f4ab8f7e","tags":[" Foo ","foo","BAR"],"custom":true}}}"#;
        let manifest = Manifest::parse(input).unwrap();
        let item = &manifest.items["model.stl"];
        assert_eq!(item.tags, vec![" Foo ", "foo", "BAR"]);
        assert_eq!(item.extra["custom"], true);
        let output = manifest.serialize().unwrap();
        let value: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(value["future"], 7);
        assert_eq!(value["items"]["model.stl"]["custom"], true);
    }

    #[test]
    fn invalid_schema_fields_are_rejected_without_modification() {
        let dir = tempdir().unwrap();
        let baseline = serde_json::json!({"schemaVersion":1,"updatedAt":"2026-10-05T00:00:00Z","items":{"model.stl":{"id":"76bfd01c-2055-43b1-996a-c3f9f4ab8f7e","tags":["favorite"]}}});
        for (field, value) in [
            ("tags", serde_json::json!([42])),
            ("tags", serde_json::json!("favorite")),
            ("notes", serde_json::Value::Null),
            ("notes", serde_json::json!(false)),
            ("id", serde_json::json!("not-a-uuid")),
        ] {
            let mut invalid = baseline.clone();
            invalid["items"]["model.stl"][field] = value;
            let bytes = serde_json::to_vec(&invalid).unwrap();
            fs::write(dir.path().join(MANIFEST_NAME), &bytes).unwrap();
            assert!(Manifest::parse(&bytes).is_err());
            assert!(edit_entry(dir.path(), "model.stl", "revision", &["new".into()], &[]).is_err());
            assert_eq!(fs::read(dir.path().join(MANIFEST_NAME)).unwrap(), bytes);
        }
        for (field, value) in [
            ("schemaVersion", serde_json::json!(2)),
            ("updatedAt", serde_json::json!("not-a-date")),
        ] {
            let mut invalid = baseline.clone();
            invalid[field] = value;
            assert!(Manifest::parse(&serde_json::to_vec(&invalid).unwrap()).is_err());
        }
    }

    #[test]
    fn malformed_json_is_blocked_and_edit_leaves_bytes_unchanged() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(MANIFEST_NAME);
        let bytes = b"{broken";
        fs::write(&path, bytes).unwrap();
        assert!(edit_entry(dir.path(), "asset.stl", "x", &[], &[]).is_err());
        assert_eq!(fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn edit_preserves_existing_uuid_notes_unknown_and_stale_entries() {
        let dir = tempdir().unwrap();
        let mut manifest = Manifest::empty();
        manifest.extra.insert("future".into(), Value::from(8));
        manifest.items.insert(
            "asset.stl".into(),
            Entry {
                id: "76bfd01c-2055-43b1-996a-c3f9f4ab8f7e".into(),
                tags: vec!["one".into()],
                notes: Some("note".into()),
                extra: BTreeMap::new(),
            },
        );
        manifest.items.insert(
            "gone.stl".into(),
            Entry {
                id: "bb4e208d-7415-4ba7-9d7d-92192611f6f8".into(),
                tags: vec!["stale".into()],
                notes: None,
                extra: BTreeMap::new(),
            },
        );
        let bytes = manifest.serialize().unwrap();
        fs::write(dir.path().join(MANIFEST_NAME), &bytes).unwrap();
        let expected = revision(&(Some(manifest.items["asset.stl"].clone()), "asset.stl"));
        let (entry, output) =
            edit_entry(dir.path(), "asset.stl", &expected, &[" TWO ".into()], &[]).unwrap();
        assert_eq!(entry.id, manifest.items["asset.stl"].id);
        assert_eq!(entry.notes.as_deref(), Some("note"));
        let updated = Manifest::parse(&output).unwrap();
        assert!(updated.items.contains_key("gone.stl"));
        assert_eq!(updated.extra["future"], 8);
    }

    #[test]
    fn first_folder_edit_uses_dot_and_noop_does_not_write_or_generate_uuid() {
        let dir = tempdir().unwrap();
        let expected = revision(&(None::<Entry>, "."));
        let (entry, _) = edit_entry(dir.path(), ".", &expected, &[], &[]).unwrap();
        assert!(entry.id.is_empty());
        assert!(!dir.path().join(MANIFEST_NAME).exists());
        let expected = revision(&(None::<Entry>, "."));
        let (entry, _) = edit_entry(dir.path(), ".", &expected, &[" Folder ".into()], &[]).unwrap();
        assert!(!entry.id.is_empty());
        assert_eq!(entry.tags, vec!["folder"]);
    }

    #[test]
    fn unsafe_metadata_keys_are_rejected_but_normal_names_are_supported() {
        for key in [
            "../x",
            "..",
            "a/b",
            "a\\b",
            "/tmp/x",
            ".asset-tags.json",
            ".asset-tags.tmp-x",
            "C:",
        ] {
            assert!(validate_key(key).is_err());
        }
        for key in ["猫.stl", "a..b.stl"] {
            assert!(validate_key(key).is_ok());
        }
    }

    #[test]
    fn normalizes_tags_by_trim_lowercase_deduplicate_and_sort() {
        assert_eq!(
            normalize_tags([" Z ".into(), "alpha".into(), "ALPHA".into(), "".into()]),
            vec!["alpha", "z"]
        );
    }

    #[test]
    fn duplicate_json_keys_are_rejected_without_rewriting_bytes() {
        let dir = tempdir().unwrap();
        for input in [
            r#"{"schemaVersion":1,"updatedAt":"2026-10-05T00:00:00Z","items":{"asset.stl":{"id":"76bfd01c-2055-43b1-996a-c3f9f4ab8f7e","tags":["first"]},"asset.stl":{"id":"bb4e208d-7415-4ba7-9d7d-92192611f6f8","tags":["second"]}}}"#,
            r#"{"schemaVersion":1,"updatedAt":"2026-10-05T00:00:00Z","items":{},"future":{"x":1,"x":2}}"#,
        ] {
            fs::write(dir.path().join(MANIFEST_NAME), input).unwrap();
            assert!(Manifest::parse(input.as_bytes()).is_err());
            assert!(edit_entry(
                dir.path(),
                "new.stl",
                &revision(&(None::<Entry>, "new.stl")),
                &["new".into()],
                &[]
            )
            .is_err());
            assert_eq!(
                fs::read(dir.path().join(MANIFEST_NAME)).unwrap(),
                input.as_bytes()
            );
        }
    }

    #[test]
    fn remove_tags_normalizes_existing_spelling_and_preserves_uuid() {
        let dir = tempdir().unwrap();
        let mut manifest = Manifest::empty();
        let entry = Entry {
            id: "76bfd01c-2055-43b1-996a-c3f9f4ab8f7e".into(),
            tags: vec![" Foo ".into(), "BAR".into(), "foo".into()],
            notes: None,
            extra: BTreeMap::new(),
        };
        manifest.items.insert("asset.stl".into(), entry.clone());
        fs::write(
            dir.path().join(MANIFEST_NAME),
            manifest.serialize().unwrap(),
        )
        .unwrap();
        let (updated, _) = edit_entry(
            dir.path(),
            "asset.stl",
            &revision(&(Some(&entry), "asset.stl")),
            &[],
            &[" FOO ".into()],
        )
        .unwrap();
        assert_eq!(updated.tags, vec!["bar"]);
        assert_eq!(updated.id, entry.id);
    }

    #[cfg(unix)]
    #[test]
    fn linked_manifests_are_blocked_and_never_modified() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let source = outside.path().join("source.json");
        let bytes = Manifest::empty().serialize().unwrap();
        fs::write(&source, &bytes).unwrap();
        let destination = dir.path().join(MANIFEST_NAME);
        for hardlink in [false, true] {
            if hardlink {
                fs::hard_link(&source, &destination).unwrap();
            } else {
                symlink(&source, &destination).unwrap();
            }
            assert!(matches!(read(dir.path()), ReadManifest::Blocked { .. }));
            assert!(edit_entry(dir.path(), "asset.stl", "revision", &["x".into()], &[]).is_err());
            assert_eq!(fs::read(&source).unwrap(), bytes);
            fs::remove_file(destination.clone()).unwrap();
        }
    }

    #[test]
    fn atomic_write_rejects_changed_bytes_and_keeps_destination() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(MANIFEST_NAME);
        fs::write(&path, b"external change").unwrap();
        assert!(write_atomic(&path, Some(b"old"), b"new").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"external change");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_recheck_rejects_link_destination_and_cleans_temp() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let source = outside.path().join("source");
        fs::write(&source, b"original").unwrap();
        let path = dir.path().join(MANIFEST_NAME);
        symlink(&source, &path).unwrap();
        let result = write_atomic_with_replace(&path, Some(b"original"), b"replacement", |_, _| {
            panic!("unsafe destination must not reach replacement")
        });
        assert!(result.unwrap_err().contains("safe regular file"));
        assert_eq!(fs::read(&source).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn injected_replace_failure_cleans_temporary_file_and_preserves_destination() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(MANIFEST_NAME);
        let before = b"original";
        fs::write(&path, before).unwrap();
        let error = write_atomic_with_replace(&path, Some(before), b"replacement", |_, _| {
            Err("injected failure".into())
        });
        assert!(error.is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
