use crate::backend::BackendState;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const FEED_URL: &str = "https://raw.githubusercontent.com/minhtrancmvn/tag-based-asset-manager/update-preview/latest.json";

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
    busy: std::sync::atomic::AtomicBool,
}

fn supported_platform(os: &str, arch: &str) -> bool {
    matches!((os, arch), ("macos", "aarch64") | ("windows", "x86_64"))
}

fn newer_version(current: &str, offered: &str) -> bool {
    match (
        semver::Version::parse(current),
        semver::Version::parse(offered),
    ) {
        (Ok(current), Ok(offered)) => offered > current,
        _ => false,
    }
}

fn approved_download(version: &str, platform: &str, url: &str) -> bool {
    if semver::Version::parse(version).is_err() {
        return false;
    }
    let suffix = match platform {
        "macos" => "aarch64.app.tar.gz",
        "windows" => "x64-setup.exe",
        _ => return false,
    };
    url == format!("https://github.com/minhtrancmvn/tag-based-asset-manager/releases/download/v{version}/Tag-Based-Asset-Manager_{version}_{suffix}")
}

fn configured_key() -> Option<&'static str> {
    option_env!("TAURI_UPDATER_PUBLIC_KEY")
        .map(str::trim)
        .filter(|key| !key.is_empty())
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum UpdateCheck {
    Disabled { reason: String },
    Current,
    Available { version: String, notes: String },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    phase: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

struct BusyGuard<'a>(&'a AtomicBool);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl UpdateState {
    fn begin(&self) -> Result<BusyGuard<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "An update operation is already running".to_string())?;
        Ok(BusyGuard(&self.busy))
    }
}

#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<UpdateCheck, String> {
    let _busy = state.begin()?;
    *state
        .pending
        .lock()
        .map_err(|_| "Update state unavailable")? = None;
    if !supported_platform(std::env::consts::OS, std::env::consts::ARCH) {
        return Ok(UpdateCheck::Disabled {
            reason: "Updates currently support macOS Apple Silicon and Windows x64 only.".into(),
        });
    }
    let Some(key) = configured_key() else {
        return Ok(UpdateCheck::Disabled { reason: "Updates are not configured in this build. Install a published build manually until updater signing is set up.".into() });
    };
    validate_key(key)?;
    let updater = app
        .updater_builder()
        .endpoints(vec![FEED_URL
            .parse()
            .map_err(|_| "Invalid built-in update feed")?])
        .map_err(|error| error.to_string())?
        .pubkey(key)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    let Some(mut update) = updater
        .check()
        .await
        .map_err(|error| format!("Could not check for updates: {error}"))?
    else {
        return Ok(UpdateCheck::Current);
    };
    prepare_offer(&mut update, std::env::consts::OS)?;
    let result = UpdateCheck::Available {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
    };
    *state
        .pending
        .lock()
        .map_err(|_| "Update state unavailable")? = Some(update);
    Ok(result)
}

fn prepare_offer(update: &mut Update, platform: &str) -> Result<(), String> {
    if !newer_version(&update.current_version, &update.version)
        || !approved_download(&update.version, platform, update.download_url.as_str())
    {
        return Err(
            "Update feed contains an invalid version or unexpected package. Installation refused."
                .into(),
        );
    }
    update.timeout = Some(std::time::Duration::from_secs(300));
    Ok(())
}

fn validate_key(key: &str) -> Result<(), String> {
    let valid = STANDARD
        .decode(key)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .is_some_and(|text| {
            text.lines()
                .next()
                .is_some_and(|line| line.starts_with("untrusted comment:"))
                && text
                    .lines()
                    .nth(1)
                    .is_some_and(|line| STANDARD.decode(line).is_ok_and(|bytes| bytes.len() == 42))
        });
    if valid {
        Ok(())
    } else {
        Err("Updater public key is invalid; installation disabled".into())
    }
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
    backend: State<'_, BackendState>,
    version: String,
    on_progress: Channel<UpdateProgress>,
) -> Result<(), String> {
    let _busy = state.begin()?;
    let update = state
        .pending
        .lock()
        .map_err(|_| "Update state unavailable")?
        .clone()
        .ok_or("Check for updates before installing")?;
    if update.version != version
        || !newer_version(&update.current_version, &version)
        || !approved_download(&version, std::env::consts::OS, update.download_url.as_str())
    {
        return Err("Offered update changed; check for updates again".into());
    }
    // Check before downloading, then again while holding the lock through install/restart.
    backend.with_update_install_lock(|| Ok(()))?;
    let mut downloaded = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let _ = on_progress.send(UpdateProgress {
                    phase: "downloading",
                    downloaded,
                    total,
                });
            },
            || {},
        )
        .await
        .map_err(|error| format!("Update download or signature verification failed: {error}"))?;
    let backend = backend.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend.with_update_install_lock(|| {
            let _ = on_progress.send(UpdateProgress {
                phase: "installing",
                downloaded: bytes.len() as u64,
                total: Some(bytes.len() as u64),
            });
            update
                .install(&bytes)
                .map_err(|error| format!("Could not install update: {error}"))?;
            // Windows exits inside install; macOS must restart explicitly.
            app.restart();
        })
    })
    .await
    .map_err(|error| format!("Update installation task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepares_only_new_approved_offers_with_bounded_download_time() {
        let mac = "https://github.com/minhtrancmvn/tag-based-asset-manager/releases/download/v2.0.0/Tag-Based-Asset-Manager_2.0.0_aarch64.app.tar.gz";
        let updater = test_updater();
        let mut update = updater.restore_update(test_manifest(mac)).unwrap().unwrap();
        assert!(prepare_offer(&mut update, "macos").is_ok());
        assert_eq!(update.timeout, Some(std::time::Duration::from_secs(300)));
        update.version = "0.0.1".into();
        assert!(prepare_offer(&mut update, "macos").is_err());
    }

    // Public, non-secret test vector from tauri-plugin-updater 2.14.1 offline_tests.
    const PUBLIC_KEY: &str = "untrusted comment: minisign public key: A49EF4746FA6E6D7\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe";
    const SIGNATURE: &str = "untrusted comment: signature from tauri secret key\nRUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=\ntrusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0\nDDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==";

    fn test_updater() -> tauri_plugin_updater::Updater {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        // Load the product's real security configuration, not a permissive test substitute.
        context.config_mut().plugins = serde_json::from_value(
            serde_json::from_str::<serde_json::Value>(include_str!("../tauri.conf.json")).unwrap()
                ["plugins"]
                .clone(),
        )
        .unwrap();
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        app.updater_builder()
            .endpoints(vec![FEED_URL.parse().unwrap()])
            .unwrap()
            .pubkey(STANDARD.encode(PUBLIC_KEY))
            .executable_path("/Applications/Test.app/Contents/MacOS/test")
            .configure_client(|_| panic!("Unexpected network request in offline test"))
            .build()
            .unwrap()
    }

    fn test_manifest(url: &str) -> serde_json::Value {
        serde_json::json!({
            "version": "2.0.0", "notes": "Literal notes", "pub_date": "2026-10-30T00:00:00Z",
            "platforms": {
                "darwin-aarch64": { "url": url, "signature": STANDARD.encode(SIGNATURE) },
                "windows-x86_64": { "url": url, "signature": STANDARD.encode(SIGNATURE) }
            }
        })
    }

    #[test]
    fn verifies_real_versioned_signature_and_rejects_tampered_bytes_or_advertised_version() {
        let updater = test_updater();
        let manifest = test_manifest("https://example.invalid/package");
        let update = updater.restore_update(manifest.clone()).unwrap().unwrap();
        update.verify(b"test").unwrap();
        assert!(update.verify(b"tampered").is_err());
        let mut inflated = manifest;
        inflated["version"] = serde_json::json!("3.0.0");
        assert!(updater
            .restore_update(inflated)
            .unwrap()
            .unwrap()
            .verify(b"test")
            .is_err());
    }

    #[test]
    fn rejects_absent_malformed_or_plaintext_public_key() {
        assert!(validate_key(&STANDARD.encode(PUBLIC_KEY)).is_ok());
        for key in ["", "not-base64", PUBLIC_KEY] {
            assert!(validate_key(key).is_err());
        }
    }

    #[test]
    fn serializes_update_operations_and_releases_guard_after_failure() {
        let state = UpdateState::default();
        let first = state.begin().unwrap();
        assert!(state.begin().is_err());
        drop(first);
        assert!(state.begin().is_ok());
    }

    #[test]
    fn product_configuration_requires_signed_version_without_frontend_plugin_grants() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["plugins"]["updater"]["requireSignedVersion"], true);
        assert_eq!(config["plugins"]["updater"]["pubkey"], "");
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert!(!capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p.as_str().is_some_and(|p| p.starts_with("updater:"))));
    }

    #[test]
    fn supports_only_published_platforms() {
        assert!(supported_platform("macos", "aarch64"));
        assert!(supported_platform("windows", "x86_64"));
        assert!(!supported_platform("macos", "x86_64"));
        assert!(!supported_platform("linux", "x86_64"));
    }

    #[test]
    fn rejects_equal_older_and_invalid_versions() {
        assert!(newer_version("0.4.0", "0.5.0"));
        assert!(!newer_version("0.4.0", "0.4.0"));
        assert!(!newer_version("0.4.0", "0.3.9"));
        assert!(!newer_version("0.4.0", "0.4.0-beta.1"));
        assert!(!newer_version("0.4.0", "not a version"));
    }

    #[test]
    fn accepts_only_exact_repository_release_asset_for_platform_and_version() {
        let mac = "https://github.com/minhtrancmvn/tag-based-asset-manager/releases/download/v0.5.0/Tag-Based-Asset-Manager_0.5.0_aarch64.app.tar.gz";
        assert!(approved_download("0.5.0", "macos", mac));
        assert!(!approved_download("0.6.0", "macos", mac));
        assert!(!approved_download("0.5.0", "windows", mac));
        assert!(!approved_download(
            "0.5.0",
            "macos",
            &mac.replace("https:", "http:")
        ));
        assert!(!approved_download(
            "0.5.0",
            "macos",
            &mac.replace("github.com", "example.com")
        ));
        assert!(!approved_download(
            "0.5.0",
            "macos",
            &(mac.to_string() + "?redirect=elsewhere")
        ));
        let windows = "https://github.com/minhtrancmvn/tag-based-asset-manager/releases/download/v0.5.0/Tag-Based-Asset-Manager_0.5.0_x64-setup.exe";
        assert!(approved_download("0.5.0", "windows", windows));
    }
}
