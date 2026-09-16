#[cfg(target_os = "windows")]
fn main() -> Result<(), String> {
  use std::time::Duration;

  use app_lib::capture_process_to_summary;
  use serde_json::json;

  let mut args = std::env::args().skip(1);
  let process_id = args
    .next()
    .ok_or_else(|| "usage: process_loopback_probe <pid> [seconds]".to_string())?
    .parse::<u32>()
    .map_err(|_| "pid must be a positive integer".to_string())?;
  let mut json_output = false;
  let mut seconds_arg = None;
  for arg in args {
    if arg == "--json" {
      json_output = true;
    } else if seconds_arg.is_none() {
      seconds_arg = Some(arg);
    } else {
      return Err("usage: process_loopback_probe <pid> [seconds] [--json]".to_string());
    }
  }
  let seconds = seconds_arg
    .unwrap_or_else(|| "10".to_string())
    .parse::<u64>()
    .map_err(|_| "seconds must be a positive integer".to_string())?;

  let result = capture_process_to_summary(process_id, Duration::from_secs(seconds))?;
  if json_output {
    println!(
      "{}",
      json!({
        "processId": result.process_id,
        "sampleRateHz": result.sample_rate_hz,
        "channelCount": result.channel_count,
        "capturedFrames": result.captured_frames,
        "silentFrames": result.silent_frames,
        "integratedLufs": result.metrics.integrated_lufs,
        "truePeakMaxDbtp": result.metrics.true_peak_max_dbtp,
        "samplePeakMaxLDb": result.metrics.sample_peak_max_l_db,
        "samplePeakMaxRDb": result.metrics.sample_peak_max_r_db,
      })
    );
    return Ok(());
  }
  println!("process id       : {}", result.process_id);
  println!(
    "format           : {} Hz, {} ch, float32",
    result.sample_rate_hz, result.channel_count
  );
  println!("captured frames  : {}", result.captured_frames);
  println!("silent frames    : {}", result.silent_frames);
  println!("integrated LUFS  : {:.3}", result.metrics.integrated_lufs);
  println!(
    "true peak dBTP   : {:.3}",
    result.metrics.true_peak_max_dbtp
  );
  println!(
    "sample peak L dB : {:.3}",
    result.metrics.sample_peak_max_l_db
  );
  println!(
    "sample peak R dB : {:.3}",
    result.metrics.sample_peak_max_r_db
  );
  Ok(())
}

#[cfg(not(target_os = "windows"))]
fn main() {
  eprintln!("process_loopback_probe is Windows-only");
  std::process::exit(2);
}
