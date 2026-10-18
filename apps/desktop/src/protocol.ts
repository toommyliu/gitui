import * as Schema from "effect/Schema"

export const SCHEME = "gitui"
export const APP_ORIGIN = `${SCHEME}://app`

export const BackendConfig = Schema.Struct({ repoRoots: Schema.Array(Schema.String) })
export type BackendConfig = typeof BackendConfig.Type

export const BackendReady = Schema.Struct({ port: Schema.Int })
