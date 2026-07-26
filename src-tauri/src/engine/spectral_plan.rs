#![allow(dead_code)]

use std::cmp::Ordering;
use std::collections::{BTreeSet, HashSet};

use crate::ipc::types::{SpectrumAnalysisChannel, SpectrumAnalysisRequest};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum ProjectionKind {
  Combined,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum TransformStreamId {
  Physical(usize),
  Projection {
    first: usize,
    second: usize,
    kind: ProjectionKind,
  },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum ConsumerInput {
  Single(TransformStreamId),
  Pair {
    first: TransformStreamId,
    second: TransformStreamId,
  },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum ConsumerProjection {
  Single,
  Combined,
  Lr,
  Ms,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum ConsumerSelection {
  Single(usize),
  Pair { first: usize, second: usize },
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ConsumerSettings {
  pub speed_percent: f64,
  pub tilt_db_per_octave: f64,
  pub octave_smoothing: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SpectralConsumerBinding {
  pub request_key: String,
  pub selection: ConsumerSelection,
  pub input: ConsumerInput,
  pub projection: ConsumerProjection,
  pub settings: ConsumerSettings,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SpectralPlan {
  pub streams: Vec<TransformStreamId>,
  pub consumers: Vec<SpectralConsumerBinding>,
}

pub(crate) fn same_logical_consumer(
  active: &SpectralConsumerBinding,
  desired: &SpectralConsumerBinding,
) -> bool {
  let projection_matches = active.projection == desired.projection
    || matches!(
      (
        active.selection,
        active.projection,
        desired.selection,
        desired.projection,
      ),
      (
        ConsumerSelection::Pair { .. },
        ConsumerProjection::Single,
        ConsumerSelection::Pair { .. },
        ConsumerProjection::Combined,
      ) | (
        ConsumerSelection::Pair { .. },
        ConsumerProjection::Combined,
        ConsumerSelection::Pair { .. },
        ConsumerProjection::Single,
      )
    );
  active.request_key == desired.request_key
    && active.selection == desired.selection
    && active.settings == desired.settings
    && projection_matches
}

/// A non-IPC representation of a pair consumer that will need aligned physical transforms.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FuturePairNeed {
  first: u16,
  second: u16,
}

impl FuturePairNeed {
  pub(crate) fn new(first: u16, second: u16) -> Self {
    Self { first, second }
  }
}

fn selected_channel(channel: u16, channel_count: usize) -> usize {
  (channel as usize).min(channel_count - 1)
}

fn canonical_pair(first: usize, second: usize) -> (usize, usize) {
  if first <= second {
    (first, second)
  } else {
    (second, first)
  }
}

fn binding_order(first: &SpectralConsumerBinding, second: &SpectralConsumerBinding) -> Ordering {
  first
    .request_key
    .cmp(&second.request_key)
    .then_with(|| first.selection.cmp(&second.selection))
    .then_with(|| first.input.cmp(&second.input))
    .then_with(|| first.projection.cmp(&second.projection))
    .then_with(|| {
      first
        .settings
        .speed_percent
        .total_cmp(&second.settings.speed_percent)
    })
    .then_with(|| {
      first
        .settings
        .tilt_db_per_octave
        .total_cmp(&second.settings.tilt_db_per_octave)
    })
    .then_with(|| {
      first
        .settings
        .octave_smoothing
        .cmp(&second.settings.octave_smoothing)
    })
}

pub(crate) fn plan_spectral_requests(
  channels: u16,
  requests: &[SpectrumAnalysisRequest],
  future_pair_needs: &[FuturePairNeed],
) -> SpectralPlan {
  let channel_count = channels.max(1) as usize;
  let mut physical_pairs = HashSet::new();

  for need in future_pair_needs {
    let first = selected_channel(need.first, channel_count);
    let second = selected_channel(need.second, channel_count);
    physical_pairs.insert(canonical_pair(first, second));
  }
  for request in requests {
    if let SpectrumAnalysisChannel::Pair { x, y } = request.channel {
      if matches!(request.view.as_str(), "lr" | "ms") {
        let first = selected_channel(x, channel_count);
        let second = selected_channel(y, channel_count);
        physical_pairs.insert(canonical_pair(first, second));
      }
    }
  }

  let mut streams = BTreeSet::new();
  for &(first, second) in &physical_pairs {
    streams.insert(TransformStreamId::Physical(first));
    streams.insert(TransformStreamId::Physical(second));
  }

  let mut consumers = Vec::with_capacity(requests.len());
  for request in requests {
    let settings = ConsumerSettings {
      speed_percent: request.speed_percent,
      tilt_db_per_octave: request.tilt_db_per_octave,
      octave_smoothing: request.octave_smoothing.clone(),
    };
    let (selection, input, projection) = match request.channel {
      SpectrumAnalysisChannel::Single { ch } => {
        let channel = selected_channel(ch, channel_count);
        let stream = TransformStreamId::Physical(channel);
        streams.insert(stream);
        (
          ConsumerSelection::Single(channel),
          ConsumerInput::Single(stream),
          ConsumerProjection::Single,
        )
      }
      SpectrumAnalysisChannel::Pair { x, y } => {
        let first = selected_channel(x, channel_count);
        let second = selected_channel(y, channel_count);
        let pair = canonical_pair(first, second);
        let requested_projection = match request.view.as_str() {
          "lr" => ConsumerProjection::Lr,
          "ms" => ConsumerProjection::Ms,
          _ => ConsumerProjection::Combined,
        };
        let input = if first == second || physical_pairs.contains(&pair) {
          let first_stream = TransformStreamId::Physical(first);
          let second_stream = TransformStreamId::Physical(second);
          streams.insert(first_stream);
          streams.insert(second_stream);
          if first == second && requested_projection == ConsumerProjection::Combined {
            ConsumerInput::Single(first_stream)
          } else {
            ConsumerInput::Pair {
              first: first_stream,
              second: second_stream,
            }
          }
        } else {
          let stream = TransformStreamId::Projection {
            first: pair.0,
            second: pair.1,
            kind: ProjectionKind::Combined,
          };
          streams.insert(stream);
          ConsumerInput::Single(stream)
        };
        let projection = match input {
          ConsumerInput::Single(_) => ConsumerProjection::Single,
          ConsumerInput::Pair { .. } => requested_projection,
        };
        (ConsumerSelection::Pair { first, second }, input, projection)
      }
    };
    consumers.push(SpectralConsumerBinding {
      request_key: request.key.clone(),
      selection,
      input,
      projection,
      settings,
    });
  }
  consumers.sort_by(binding_order);

  SpectralPlan {
    streams: streams.into_iter().collect(),
    consumers,
  }
}

#[cfg(test)]
mod tests {
  use super::{
    plan_spectral_requests, ConsumerInput, ConsumerProjection, ConsumerSelection, FuturePairNeed,
    ProjectionKind, TransformStreamId,
  };
  use crate::ipc::types::{SpectrumAnalysisChannel, SpectrumAnalysisRequest};

  fn request(
    key: &str,
    channel: SpectrumAnalysisChannel,
    view: &str,
    speed_percent: f64,
    octave_smoothing: &str,
  ) -> SpectrumAnalysisRequest {
    SpectrumAnalysisRequest {
      key: key.to_string(),
      channel,
      view: view.to_string(),
      speed_percent,
      tilt_db_per_octave: 4.5,
      octave_smoothing: octave_smoothing.to_string(),
    }
  }

  fn pair_request(key: &str, x: u16, y: u16, view: &str) -> SpectrumAnalysisRequest {
    request(
      key,
      SpectrumAnalysisChannel::Pair { x, y },
      view,
      50.0,
      "off",
    )
  }

  #[test]
  fn no_active_frequency_requests_produces_an_empty_plan() {
    let plan = plan_spectral_requests(8, &[], &[]);

    assert!(plan.streams.is_empty());
    assert!(plan.consumers.is_empty());
  }

  #[test]
  fn lone_combined_pair_uses_one_direct_projection_stream() {
    let request = pair_request("combined", 3, 1, "combined");

    let plan = plan_spectral_requests(8, &[request], &[]);

    assert_eq!(
      plan.streams,
      vec![TransformStreamId::Projection {
        first: 1,
        second: 3,
        kind: ProjectionKind::Combined,
      }]
    );
    assert_eq!(plan.consumers.len(), 1);
    assert_eq!(plan.consumers[0].request_key, "combined");
    assert_eq!(
      plan.consumers[0].selection,
      ConsumerSelection::Pair {
        first: 3,
        second: 1,
      }
    );
    assert_eq!(plan.consumers[0].projection, ConsumerProjection::Single);
    assert_eq!(
      plan.consumers[0].input,
      ConsumerInput::Single(TransformStreamId::Projection {
        first: 1,
        second: 3,
        kind: ProjectionKind::Combined,
      })
    );
  }

  #[test]
  fn duplicate_combined_requests_share_transform_but_keep_keyed_settings() {
    let mut requests = vec![
      request(
        "combined-fast",
        SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
        "combined",
        10.0,
        "off",
      ),
      request(
        "combined-slow",
        SpectrumAnalysisChannel::Pair { x: 0, y: 1 },
        "combined",
        90.0,
        "1/3",
      ),
    ];
    requests[0].tilt_db_per_octave = 0.75;
    requests[1].tilt_db_per_octave = 5.25;

    let plan = plan_spectral_requests(2, &requests, &[]);

    assert_eq!(plan.streams.len(), 1);
    assert_eq!(plan.consumers.len(), 2);
    assert_eq!(plan.consumers[0].request_key, "combined-fast");
    assert_eq!(plan.consumers[0].settings.speed_percent, 10.0);
    assert_eq!(plan.consumers[0].settings.tilt_db_per_octave, 0.75);
    assert_eq!(plan.consumers[0].settings.octave_smoothing, "off");
    assert_eq!(plan.consumers[1].request_key, "combined-slow");
    assert_eq!(plan.consumers[1].settings.speed_percent, 90.0);
    assert_eq!(plan.consumers[1].settings.tilt_db_per_octave, 5.25);
    assert_eq!(plan.consumers[1].settings.octave_smoothing, "1/3");
  }

  #[test]
  fn lr_and_ms_requests_require_aligned_physical_pair_streams() {
    for view in ["lr", "ms"] {
      let request = pair_request(view, 4, 2, view);
      let plan = plan_spectral_requests(6, &[request], &[]);

      assert_eq!(
        plan.streams,
        vec![
          TransformStreamId::Physical(2),
          TransformStreamId::Physical(4)
        ]
      );
      assert_eq!(
        plan.consumers[0].input,
        ConsumerInput::Pair {
          first: TransformStreamId::Physical(4),
          second: TransformStreamId::Physical(2),
        }
      );
      assert_eq!(
        plan.consumers[0].projection,
        if view == "lr" {
          ConsumerProjection::Lr
        } else {
          ConsumerProjection::Ms
        }
      );
    }
  }

  #[test]
  fn combined_reuses_physical_pair_when_any_pair_consumer_needs_it() {
    let combined = pair_request("combined", 0, 1, "combined");
    for (other_requests, future_pairs) in [
      (
        vec![pair_request("lr", 0, 1, "lr")],
        Vec::<FuturePairNeed>::new(),
      ),
      (
        vec![pair_request("ms", 0, 1, "ms")],
        Vec::<FuturePairNeed>::new(),
      ),
      (vec![], vec![FuturePairNeed::new(0, 1)]),
    ] {
      let mut requests = vec![combined.clone()];
      requests.extend(other_requests);
      let plan = plan_spectral_requests(2, &requests, &future_pairs);

      assert_eq!(
        plan.streams,
        vec![
          TransformStreamId::Physical(0),
          TransformStreamId::Physical(1)
        ]
      );
      assert!(!plan
        .streams
        .iter()
        .any(|stream| matches!(stream, TransformStreamId::Projection { .. })));
      let binding = plan
        .consumers
        .iter()
        .find(|binding| binding.request_key == "combined")
        .expect("combined binding");
      assert_eq!(
        binding.input,
        ConsumerInput::Pair {
          first: TransformStreamId::Physical(0),
          second: TransformStreamId::Physical(1),
        }
      );
    }
  }

  #[test]
  fn single_channel_request_uses_only_that_physical_stream() {
    let request = request(
      "single",
      SpectrumAnalysisChannel::Single { ch: 5 },
      "combined",
      50.0,
      "off",
    );

    let plan = plan_spectral_requests(8, &[request], &[]);

    assert_eq!(plan.streams, vec![TransformStreamId::Physical(5)]);
    assert_eq!(
      plan.consumers[0].input,
      ConsumerInput::Single(TransformStreamId::Physical(5))
    );
    assert_eq!(plan.consumers[0].projection, ConsumerProjection::Single);
  }

  #[test]
  fn inactive_and_unrequested_channels_are_absent() {
    let request = request(
      "single",
      SpectrumAnalysisChannel::Single { ch: 2 },
      "combined",
      50.0,
      "off",
    );

    let plan = plan_spectral_requests(8, &[request], &[]);

    assert_eq!(plan.streams, vec![TransformStreamId::Physical(2)]);
    assert_eq!(plan.consumers.len(), 1);
  }

  #[test]
  fn plan_is_stable_independent_of_request_and_pair_need_order() {
    let requests = vec![
      pair_request("z-combined", 3, 1, "combined"),
      pair_request("a-ms", 0, 2, "ms"),
      request(
        "m-single",
        SpectrumAnalysisChannel::Single { ch: 5 },
        "combined",
        25.0,
        "1/6",
      ),
    ];
    let future_pairs = vec![FuturePairNeed::new(7, 6), FuturePairNeed::new(3, 1)];
    let mut reversed_requests = requests.clone();
    reversed_requests.reverse();
    let mut reversed_pairs = future_pairs.clone();
    reversed_pairs.reverse();

    assert_eq!(
      plan_spectral_requests(8, &requests, &future_pairs),
      plan_spectral_requests(8, &reversed_requests, &reversed_pairs)
    );
  }

  #[test]
  fn selections_are_clamped_to_the_effective_channel_count() {
    let requests = vec![
      pair_request("clamped-pair", 99, 7, "lr"),
      request(
        "clamped-single",
        SpectrumAnalysisChannel::Single { ch: 42 },
        "combined",
        50.0,
        "off",
      ),
    ];

    let plan = plan_spectral_requests(2, &requests, &[FuturePairNeed::new(12, 13)]);

    assert_eq!(plan.streams, vec![TransformStreamId::Physical(1)]);
    assert!(plan.streams.iter().all(|stream| match stream {
      TransformStreamId::Physical(channel) => *channel < 2,
      TransformStreamId::Projection { first, second, .. } => *first < 2 && *second < 2,
    }));
    assert!(plan.consumers.iter().all(|binding| match binding.input {
      ConsumerInput::Single(TransformStreamId::Physical(channel)) => channel == 1,
      ConsumerInput::Pair {
        first: TransformStreamId::Physical(first),
        second: TransformStreamId::Physical(second),
      } => first == 1 && second == 1,
      _ => false,
    }));
  }
}
