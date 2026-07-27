fn main() {
    // Cargo caches build scripts aggressively, and `tauri_build` only declares
    // a dependency on tauri.conf.json — not on the icon files it reads. Without
    // this, editing an icon and rebuilding silently keeps the old artwork
    // embedded, which looks exactly like the change never happened.
    println!("cargo:rerun-if-changed=icons");

    tauri_build::build()
}
