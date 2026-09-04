pub mod broker;
pub mod discovery;
pub mod protocol;
#[cfg(target_os = "windows")]
pub mod windows_pipe;
#[cfg(not(target_os = "windows"))]
pub mod windows_pipe {
  #[derive(Default)]
  pub struct PipeServerState(());

  impl PipeServerState {
    pub fn stop(&self) {}
  }
}
