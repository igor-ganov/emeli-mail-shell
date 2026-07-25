// Desktop entry point. All logic lives in the library (`run`) so the same code
// powers the Android build via the mobile entry point.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    emeli_lib::run()
}
