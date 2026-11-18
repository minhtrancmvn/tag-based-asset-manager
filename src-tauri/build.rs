use std::env;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=TAURI_UPDATER_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=TAG_ASSET_MANAGER_USAGE_ENDPOINT");

    let mut attributes = tauri_build::Attributes::new();
    if is_windows_msvc() {
        // tauri-build links its manifest resource into binaries only, so test
        // executables that reach the Tauri runtime load Common Controls v5 and
        // exit with STATUS_ENTRYPOINT_NOT_FOUND. Embed the same manifest through
        // the linker for every linked target instead; keeping both would add a
        // duplicate manifest resource to the app binary.
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        embed_windows_manifest();
    }
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}

fn is_windows_msvc() -> bool {
    env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
}

fn embed_windows_manifest() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
        .join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
}
