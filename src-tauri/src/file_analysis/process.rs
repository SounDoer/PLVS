use std::io;
use std::process::{Child, ChildStderr, ChildStdout, Command, ExitStatus};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

#[derive(Default)]
pub(super) struct FileProcess {
  cancelled: AtomicBool,
  child: Mutex<Option<Child>>,
}

impl FileProcess {
  pub(super) fn is_cancelled(&self) -> bool {
    self.cancelled.load(Ordering::Acquire)
  }

  pub(super) fn cancel(&self) {
    self.cancelled.store(true, Ordering::Release);
    self.kill();
  }

  fn kill(&self) {
    if let Some(child) = self
      .child
      .lock()
      .expect("file process lock poisoned")
      .as_mut()
    {
      let _ = child.kill();
    }
  }

  pub(super) fn spawn(&self, command: &mut Command) -> io::Result<RunningFileProcess<'_>> {
    let mut slot = self.child.lock().expect("file process lock poisoned");
    if self.is_cancelled() {
      return Err(io::Error::new(
        io::ErrorKind::Interrupted,
        "File analysis was cancelled",
      ));
    }
    assert!(slot.is_none(), "file analysis already owns a child process");
    let mut child = command.spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    *slot = Some(child);
    Ok(RunningFileProcess {
      owner: self,
      stdout,
      stderr,
      waited: false,
    })
  }
}

pub(super) struct RunningFileProcess<'a> {
  owner: &'a FileProcess,
  pub(super) stdout: Option<ChildStdout>,
  pub(super) stderr: Option<ChildStderr>,
  waited: bool,
}

impl RunningFileProcess<'_> {
  pub(super) fn wait(&mut self) -> io::Result<ExitStatus> {
    loop {
      let status = self
        .owner
        .child
        .lock()
        .expect("file process lock poisoned")
        .as_mut()
        .expect("missing file process")
        .try_wait()?;
      if let Some(status) = status {
        self.waited = true;
        return Ok(status);
      }
      thread::sleep(Duration::from_millis(10));
    }
  }
}

impl Drop for RunningFileProcess<'_> {
  fn drop(&mut self) {
    if let Some(mut child) = self
      .owner
      .child
      .lock()
      .expect("file process lock poisoned")
      .take()
    {
      if !self.waited {
        let _ = child.kill();
        let _ = child.wait();
      }
    }
  }
}

#[cfg(all(test, unix))]
mod tests {
  use super::*;
  use std::io::Read;
  use std::process::Stdio;

  #[test]
  fn cancelling_releases_a_reader_waiting_for_the_child() {
    let process = FileProcess::default();
    let mut command = Command::new("sleep");
    command.arg("5").stdout(Stdio::piped());
    let mut child = process.spawn(&mut command).unwrap();
    let mut stdout = child.stdout.take().unwrap();
    thread::scope(|scope| {
      let (send, receive) = std::sync::mpsc::channel();
      scope.spawn(move || {
        send.send(stdout.read(&mut [0_u8; 1])).unwrap();
      });
      assert!(receive.recv_timeout(Duration::from_millis(50)).is_err());
      process.cancel();
      assert_eq!(
        receive
          .recv_timeout(Duration::from_secs(2))
          .unwrap()
          .unwrap(),
        0
      );
    });
    assert!(!child.wait().unwrap().success());
  }
}
