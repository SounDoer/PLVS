use std::io::{self, Write};
use tauri_plugin_log::{fern, Target, TargetKind};

pub fn console_target() -> Target {
  Target::new(TargetKind::Dispatch(
    fern::Dispatch::new().chain(console_output(|| io::stdout().lock())),
  ))
}

fn console_output<W: Write>(writer: impl Fn() -> W + Send + Sync + 'static) -> fern::Output {
  fern::Output::call(move |record| {
    // A launcher may close both inherited pipes while the desktop app keeps running.
    // Fern's built-in stdout target falls back to stderr and panics if both fail.
    // Console output is optional: never report its errors through the logger itself.
    let mut stream = writer();
    let _ = writeln!(stream, "{}", record.args());
    let _ = stream.flush();
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::{Arc, Mutex};

  struct FailedConsole {
    fail_write: bool,
  }

  impl Write for FailedConsole {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
      if self.fail_write {
        Err(io::Error::new(io::ErrorKind::BrokenPipe, "launcher exited"))
      } else {
        Ok(bytes.len())
      }
    }

    fn flush(&mut self) -> io::Result<()> {
      Err(io::Error::new(io::ErrorKind::BrokenPipe, "launcher exited"))
    }
  }

  #[test]
  fn failed_console_does_not_panic_or_skip_later_log_targets() {
    for fail_write in [true, false] {
      let captured = Arc::new(Mutex::new(Vec::new()));
      let sink = captured.clone();
      let (_, logger) = fern::Dispatch::new()
        .chain(console_output(move || FailedConsole { fail_write }))
        .chain(fern::Output::call(move |record| {
          sink.lock().unwrap().push(record.args().to_string());
        }))
        .into_log();
      for message in ["dock.resize completed", "next operation completed"] {
        logger.log(
          &log::Record::builder()
            .args(format_args!("{message}"))
            .level(log::Level::Info)
            .target("diagnostics")
            .build(),
        );
      }
      logger.flush();
      assert_eq!(
        *captured.lock().unwrap(),
        ["dock.resize completed", "next operation completed"]
      );
    }
  }

  #[test]
  fn closed_launcher_pipes_leave_file_logging_alive() {
    use std::io::{BufRead, Read};
    use std::process::{Command, Stdio};
    const CHILD_LOG: &str = "PLVS_CLOSED_PIPE_TEST_LOG";
    if let Some(path) = std::env::var_os(CHILD_LOG) {
      writeln!(io::stdout(), "PLVS_PIPE_READY").unwrap();
      io::stdout().flush().unwrap();
      // Parent closes both readers before releasing the child through stdin.
      let mut ready = [0];
      io::stdin().read_exact(&mut ready).unwrap();
      let (_, logger) = fern::Dispatch::new()
        .chain(console_output(|| io::stdout().lock()))
        .chain(std::fs::File::create(path).unwrap())
        .into_log();
      for message in ["dock.resize completed", "next operation completed"] {
        logger.log(
          &log::Record::builder()
            .args(format_args!("{message}"))
            .level(log::Level::Info)
            .build(),
        );
      }
      logger.flush();
      // The test harness itself writes to stdout when a test returns.
      std::process::exit(0);
    }
    let path = std::env::temp_dir().join(format!("plvs-pipe-test-{}.log", std::process::id()));
    let mut child = Command::new(std::env::current_exe().unwrap())
      .args([
        "--exact",
        "runtime_logging::tests::closed_launcher_pipes_leave_file_logging_alive",
        "--nocapture",
      ])
      .env(CHILD_LOG, &path)
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()
      .unwrap();
    // Let libtest finish its own startup output before disconnecting the pipes.
    let mut output = io::BufReader::new(child.stdout.take().unwrap());
    loop {
      let mut line = String::new();
      assert_ne!(
        output.read_line(&mut line).unwrap(),
        0,
        "child did not become ready"
      );
      if line.contains("PLVS_PIPE_READY") {
        break;
      }
    }
    drop(output);
    drop(child.stderr.take());
    child.stdin.take().unwrap().write_all(b"!").unwrap();
    let status = child.wait().unwrap();
    let contents = std::fs::read_to_string(&path).unwrap_or_default();
    let _ = std::fs::remove_file(path);
    assert!(status.success(), "closed-pipe child exited with {status}");
    assert_eq!(
      contents,
      "dock.resize completed\nnext operation completed\n"
    );
  }
}
