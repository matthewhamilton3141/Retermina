//! End-to-end coverage of the session host over its real socket protocol —
//! the same path the app's `pty` client drives. Proves the survival mechanism:
//! a session detaches (≈ app quit), keeps running, and a reattach replays the
//! missed output in order while the shell is still alive; then an explicit close
//! removes it.

#![cfg(unix)]

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::process::Command;
use std::time::{Duration, Instant};

use retermina_lib::session_proto::{
    read_header_line, AttachReply, CreateReply, Request, SimpleReply,
};

fn send(stream: &mut UnixStream, req: &Request) {
    let mut line = serde_json::to_vec(req).unwrap();
    line.push(b'\n');
    stream.write_all(&line).unwrap();
    stream.flush().unwrap();
}

fn connect(sock: &std::path::Path) -> UnixStream {
    UnixStream::connect(sock).expect("connect host")
}

/// Read whatever arrives over `deadline`, returning it as a lossy string.
fn read_for(stream: &mut UnixStream, deadline: Duration) -> String {
    stream
        .set_read_timeout(Some(Duration::from_millis(150)))
        .unwrap();
    let end = Instant::now() + deadline;
    let mut out = Vec::new();
    let mut buf = [0u8; 4096];
    while Instant::now() < end {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => out.extend_from_slice(&buf[..n]),
            Err(_) => {} // timeout tick
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Highest N across all `TICK-N` occurrences of actual output (the echoed
/// command line contains `TICK-$i`, which has no digits and is ignored).
fn max_tick(s: &str) -> Option<u64> {
    s.match_indices("TICK-")
        .filter_map(|(i, _)| {
            let digits: String = s[i + 5..].chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse::<u64>().ok()
        })
        .max()
}

#[test]
fn survives_detach_reattach_and_close() {
    let dir = std::env::temp_dir().join(format!("retermina-sh-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let sock = dir.join("s.sock");

    let mut host = Command::new(env!("CARGO_BIN_EXE_session-host"))
        .env("RETERMINA_SESSION_SOCK", &sock)
        .spawn()
        .expect("spawn session-host");

    // Wait for the socket to come up.
    let up = Instant::now() + Duration::from_secs(5);
    while UnixStream::connect(&sock).is_err() {
        assert!(Instant::now() < up, "host never came up");
        std::thread::sleep(Duration::from_millis(50));
    }

    // Create a session and start a per-second counter.
    let mut c = connect(&sock);
    send(&mut c, &Request::Create { cwd: None, cols: 80, rows: 24, color_fgbg: None });
    let reply: CreateReply = serde_json::from_str(&read_header_line(&mut c).unwrap()).unwrap();
    let sid = reply.session_id;
    c.write_all(b"i=0; while true; do echo TICK-$i; i=$((i+1)); sleep 1; done\n").unwrap();

    let first = read_for(&mut c, Duration::from_millis(2600));
    let max_first = max_tick(&first).expect("counter produced output");

    // Detach (≈ app quit) and let the counter keep running with no client.
    drop(c);
    std::thread::sleep(Duration::from_millis(2500));

    // Reattach and verify replay of the gap + that it's still counting.
    let mut c2 = connect(&sock);
    send(&mut c2, &Request::Attach { session_id: sid.clone() });
    let att: AttachReply = serde_json::from_str(&read_header_line(&mut c2).unwrap()).unwrap();
    assert!(att.ok, "reattach should succeed for a live session");

    let replay = read_for(&mut c2, Duration::from_millis(2000));
    assert!(
        replay.contains(&format!("TICK-{}", max_first + 1)),
        "replay should include the tick produced while detached (TICK-{})",
        max_first + 1,
    );
    let max_replay = max_tick(&replay).expect("replay produced output");
    assert!(max_replay > max_first, "shell should still be counting after reattach");

    // Explicit close removes it (must not resurrect).
    let mut cc = connect(&sock);
    send(&mut cc, &Request::Close { session_id: sid.clone() });
    let _ = read_header_line(&mut cc);

    let mut cl = connect(&sock);
    send(&mut cl, &Request::List);
    let listed: SimpleReply = serde_json::from_str(&read_header_line(&mut cl).unwrap()).unwrap();
    assert!(
        !listed.sessions.unwrap_or_default().contains(&sid),
        "closed session must be gone",
    );

    let _ = host.kill();
    let _ = std::fs::remove_dir_all(&dir);
}
