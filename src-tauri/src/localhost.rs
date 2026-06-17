//! Background "Localhost Tracker": enumerate processes listening on local TCP
//! ports and offer a one-click kill. The frontend polls [`list_listening_ports`]
//! on an interval and calls [`kill_process`] when the user terminates a server.
//!
//! Port discovery shells out to the platform's native tool — `lsof` on
//! macOS/Linux, `netstat` on Windows — and parses its text output. The parsers
//! are pure functions (`parse_lsof` / `parse_netstat`) so they can be unit
//! tested without a live socket. Discovery degrades gracefully: if the tool is
//! missing or errors, we return an empty list rather than surfacing an error.

use std::collections::HashSet;
use std::process::Command;

use serde::Serialize;

/// A single process listening on a local TCP port.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningPort {
    /// The TCP port being listened on.
    pub port: u16,
    /// Owning process id (used as the kill target).
    pub pid: u32,
    /// Process/command name (best-effort; may be empty on Windows).
    pub process: String,
    /// The local bind address as reported by the OS (e.g. `127.0.0.1:3000`).
    pub address: String,
    /// Transport protocol; currently always `TCP`.
    pub protocol: String,
}

/// Extract the trailing port from a bind address. Handles IPv4 (`127.0.0.1:80`),
/// wildcard (`*:8080`), and bracketed IPv6 (`[::1]:3000`) forms by splitting on
/// the final colon.
fn port_from_address(addr: &str) -> Option<u16> {
    let idx = addr.rfind(':')?;
    addr[idx + 1..].parse::<u16>().ok()
}

/// Parse `lsof -nP -iTCP -sTCP:LISTEN` output into listening ports.
///
/// Each data row looks like:
/// ```text
/// node    54321 user   23u  IPv4 0x..      0t0  TCP 127.0.0.1:3000 (LISTEN)
/// ```
/// The command name is column 0, the pid column 1, and the bind address is the
/// token immediately before the trailing `(LISTEN)`. Rows are de-duplicated by
/// (pid, port) so a server bound on both IPv4 and IPv6 collapses to one entry.
fn parse_lsof(output: &str) -> Vec<ListeningPort> {
    let mut seen: HashSet<(u32, u16)> = HashSet::new();
    let mut ports = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("COMMAND") {
            continue;
        }
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() < 9 {
            continue;
        }
        // The connection state is the final token for listening sockets.
        if !tokens
            .last()
            .is_some_and(|t| t.eq_ignore_ascii_case("(LISTEN)"))
        {
            continue;
        }
        let Ok(pid) = tokens[1].parse::<u32>() else {
            continue;
        };
        let address = tokens[tokens.len() - 2];
        let Some(port) = port_from_address(address) else {
            continue;
        };
        if seen.insert((pid, port)) {
            ports.push(ListeningPort {
                port,
                pid,
                process: tokens[0].to_string(),
                address: address.to_string(),
                protocol: "TCP".to_string(),
            });
        }
    }

    ports.sort_by_key(|p| p.port);
    ports
}

/// Parse `netstat -ano -p TCP` output (Windows) into listening ports. Process
/// names are left blank here and filled in separately via `tasklist`.
///
/// Listening rows look like:
/// ```text
///   TCP    0.0.0.0:135    0.0.0.0:0    LISTENING    1234
/// ```
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_netstat(output: &str) -> Vec<ListeningPort> {
    let mut seen: HashSet<(u32, u16)> = HashSet::new();
    let mut ports = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if !line.contains("LISTENING") {
            continue;
        }
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() < 5 {
            continue;
        }
        let Ok(pid) = tokens[tokens.len() - 1].parse::<u32>() else {
            continue;
        };
        let address = tokens[1];
        let Some(port) = port_from_address(address) else {
            continue;
        };
        if seen.insert((pid, port)) {
            ports.push(ListeningPort {
                port,
                pid,
                process: String::new(),
                address: address.to_string(),
                protocol: tokens[0].to_uppercase(),
            });
        }
    }

    ports.sort_by_key(|p| p.port);
    ports
}

/// Map pid -> image name by parsing `tasklist /FO CSV /NH` (Windows only,
/// best-effort). Returns an empty map on any failure.
#[cfg(windows)]
fn windows_process_names() -> std::collections::HashMap<u32, String> {
    let mut map = std::collections::HashMap::new();
    let Ok(output) = Command::new("tasklist").args(["/FO", "CSV", "/NH"]).output() else {
        return map;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        // Format: "Image Name","PID","Session Name","Session#","Mem Usage"
        let fields: Vec<&str> = line.split("\",\"").collect();
        if fields.len() < 2 {
            continue;
        }
        let name = fields[0].trim_start_matches('"').to_string();
        let pid = fields[1].trim_matches('"').trim();
        if let Ok(pid) = pid.parse::<u32>() {
            map.insert(pid, name);
        }
    }
    map
}

/// List every process currently listening on a local TCP port.
///
/// Returns `Ok([])` (never an error) when the platform tool is unavailable, so
/// the tracker panel simply shows "no servers" instead of an error state.
#[tauri::command]
pub fn list_listening_ports() -> Result<Vec<ListeningPort>, String> {
    #[cfg(windows)]
    {
        let Ok(output) = Command::new("netstat").args(["-ano", "-p", "TCP"]).output() else {
            return Ok(Vec::new());
        };
        let mut ports = parse_netstat(&String::from_utf8_lossy(&output.stdout));
        let names = windows_process_names();
        for port in &mut ports {
            if let Some(name) = names.get(&port.pid) {
                port.process = name.clone();
            }
        }
        Ok(ports)
    }

    #[cfg(not(windows))]
    {
        let Ok(output) = Command::new("lsof")
            .args(["-nP", "-iTCP", "-sTCP:LISTEN"])
            .output()
        else {
            return Ok(Vec::new());
        };
        Ok(parse_lsof(&String::from_utf8_lossy(&output.stdout)))
    }
}

/// Terminate a process by pid. `force` escalates to SIGKILL / `taskkill /F`;
/// otherwise a graceful SIGTERM / `taskkill` is sent. On Windows the whole
/// process tree (`/T`) is targeted so child workers of a dev server die too.
#[tauri::command]
pub fn kill_process(pid: u32, force: Option<bool>) -> Result<(), String> {
    let force = force.unwrap_or(false);

    #[cfg(windows)]
    let mut command = {
        let mut c = Command::new("taskkill");
        c.arg("/PID").arg(pid.to_string()).arg("/T");
        if force {
            c.arg("/F");
        }
        c
    };

    #[cfg(not(windows))]
    let mut command = {
        let mut c = Command::new("kill");
        c.arg(if force { "-KILL" } else { "-TERM" });
        c.arg(pid.to_string());
        c
    };

    let output = command.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("failed to terminate process {pid}")
    } else {
        stderr
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_port_from_ipv4_wildcard_and_ipv6() {
        assert_eq!(port_from_address("127.0.0.1:3000"), Some(3000));
        assert_eq!(port_from_address("*:8080"), Some(8080));
        assert_eq!(port_from_address("[::1]:5173"), Some(5173));
        assert_eq!(port_from_address("not-an-address"), None);
    }

    #[test]
    fn parses_lsof_output_and_dedupes_ipv4_ipv6() {
        let output = "\
COMMAND   PID  USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node    12345  matt   23u  IPv4 0xabc            0t0  TCP 127.0.0.1:3000 (LISTEN)
node    12345  matt   24u  IPv6 0xdef            0t0  TCP [::1]:3000 (LISTEN)
Python  67890  matt    5u  IPv4 0x123            0t0  TCP *:8000 (LISTEN)
ssh       222  matt    3u  IPv4 0x999            0t0  TCP 127.0.0.1:22 (ESTABLISHED)
";
        let ports = parse_lsof(output);
        assert_eq!(ports.len(), 2, "ESTABLISHED skipped; ipv4+ipv6 collapse");
        // Sorted by port: 3000 then 8000.
        assert_eq!(ports[0].port, 3000);
        assert_eq!(ports[0].pid, 12345);
        assert_eq!(ports[0].process, "node");
        assert_eq!(ports[1].port, 8000);
        assert_eq!(ports[1].process, "Python");
    }

    #[test]
    fn parses_netstat_listening_rows() {
        let output = "\
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234
  TCP    [::]:135               [::]:0                 LISTENING       1234
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       9876
  TCP    127.0.0.1:55012        127.0.0.1:5173         ESTABLISHED     9876
";
        let ports = parse_netstat(output);
        assert_eq!(ports.len(), 2, "dedupe 135, skip ESTABLISHED");
        assert_eq!(ports[0].port, 135);
        assert_eq!(ports[0].pid, 1234);
        assert_eq!(ports[1].port, 5173);
        assert_eq!(ports[1].pid, 9876);
    }

    #[test]
    fn returns_empty_on_garbage() {
        assert!(parse_lsof("total nonsense here").is_empty());
        assert!(parse_netstat("nothing listening").is_empty());
    }
}
