import { Schema } from 'effect'

export class VideoBackendUnavailableError extends Schema.TaggedError<VideoBackendUnavailableError>()(
  'VideoBackendUnavailableError',
  {
    backend: Schema.String,
    message: Schema.String,
  },
) {}

export class VideoFeatureUnavailableError extends Schema.TaggedError<VideoFeatureUnavailableError>()(
  'VideoFeatureUnavailableError',
  {
    backend: Schema.String,
    feature: Schema.String,
    message: Schema.String,
  },
) {}

export class VideoLoadError extends Schema.TaggedError<VideoLoadError>()(
  'VideoLoadError',
  {
    backend: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.String),
  },
) {}

export class VideoControllerStateError extends Schema.TaggedError<VideoControllerStateError>()(
  'VideoControllerStateError',
  {
    backend: Schema.String,
    state: Schema.Literal('loading', 'load-failed', 'destroyed'),
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.String),
  },
) {}

export type VideoPlayerError =
  | VideoBackendUnavailableError
  | VideoFeatureUnavailableError
  | VideoLoadError
  | VideoControllerStateError
