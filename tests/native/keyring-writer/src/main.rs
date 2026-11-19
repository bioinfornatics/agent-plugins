//! Test-only helper for ap-44kd. Writes or deletes the Goose keyring entry
//! (service "goose", user "secrets") through keyring-rs, the library Goose uses,
//! so agent-plugin's platform reader is checked against the real storage format.
//! The value comes from GOOSE_KEYRING_TEST_VALUE to avoid shell quoting of JSON.
use keyring::Entry;

fn main() {
    let action = std::env::args().nth(1).unwrap_or_default();
    let entry = Entry::new("goose", "secrets").expect("keyring entry");
    match action.as_str() {
        "write" => {
            let value = std::env::var("GOOSE_KEYRING_TEST_VALUE").expect("GOOSE_KEYRING_TEST_VALUE");
            entry.set_password(&value).expect("write keyring entry");
        }
        "delete" => entry.delete_credential().expect("delete keyring entry"),
        _ => {
            eprintln!("usage: goose-keyring-writer write|delete");
            std::process::exit(2);
        }
    }
}
