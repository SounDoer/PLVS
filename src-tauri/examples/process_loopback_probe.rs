#[cfg(target_os = "windows")]
fn main() -> Result<(), String> {
  use std::time::Duration;

  use app_lib::{capture_process_to_summary_with_format, list_capture_applications};
  use serde_json::json;

  let mut args = std::env::args().skip(1);
  let first_arg = args
    .next()
    .ok_or_else(|| "usage: process_loopback_probe <pid> [seconds]".to_string())?;
  if first_arg == "--list-applications" {
    println!(
      "{}",
      serde_json::to_string_pretty(&list_capture_applications()?)
        .map_err(|error| error.to_string())?
    );
    return Ok(());
  }
  let process_id = if first_arg.starts_with("app-") {
    list_capture_applications()?
      .into_iter()
      .find(|application| application.id == first_arg)
      .map(|application| application.process_id)
      .ok_or_else(|| "capture application is not currently running".to_string())?
  } else {
    first_arg
      .parse::<u32>()
      .map_err(|_| "pid must be a positive integer or stable application id".to_string())?
  };
  let rest: Vec<String> = args.collect();
  let mut json_output = false;
  let mut seconds_arg = None;
  let mut channels = 2u16;
  let mut sample_rate = 48_000u32;
  let mut index = 0;
  while index < rest.len() {
    match rest[index].as_str() {
      "--json" => {
        json_output = true;
        index += 1;
      }
      "--channels" => {
        let value = rest.get(index + 1).ok_or_else(|| {
          "usage: process_loopback_probe <pid> [seconds] [--channels <n>] [--json]".to_string()
        })?;
        channels = value
          .parse::<u16>()
          .map_err(|_| "channels must be 1, 2, 6, or 8".to_string())?;
        index += 2;
      }
      "--sample-rate" => {
        let value = rest.get(index + 1).ok_or_else(|| {
          "usage: process_loopback_probe <pid> [seconds] [--channels <n>] [--sample-rate <hz>] [--json]".to_string()
        })?;
        sample_rate = value
          .parse::<u32>()
          .map_err(|_| "sample rate must be an integer in Hz".to_string())?;
        index += 2;
      }
      value if seconds_arg.is_none() => {
        seconds_arg = Some(value.to_string());
        index += 1;
      }
      _ => {
        return Err(
          "usage: process_loopback_probe <pid> [seconds] [--channels <n>] [--sample-rate <hz>] [--json]".to_string(),
        );
      }
    }
  }
  let seconds = seconds_arg
    .unwrap_or_else(|| "10".to_string())
    .parse::<u64>()
    .map_err(|_| "seconds must be a positive integer".to_string())?;

  let result = capture_process_to_summary_with_format(
    process_id,
    Duration::from_secs(seconds),
    sample_rate,
    channels,
  )?;
  if json_output {
    println!(
      "{}",
      json!({
        "processId": result.process_id,
        "sampleRateHz": result.sample_rate_hz,
        "channelCount": result.channel_count,
        "capturedFrames": result.captured_frames,
        "silentFrames": result.silent_frames,
        "channelPeakDbfs": result.channel_peak_dbfs,
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
  println!("channel peaks    : {:?} dBFS", result.channel_peak_dbfs);
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
