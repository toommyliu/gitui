import * as Schema from "effect/Schema"
import { Oid } from "./domain.ts"

export const CommitIdentity = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  committerName: Schema.String,
  committerEmail: Schema.String,
  signing: Schema.Boolean,
  signingKey: Schema.String,
  signingFormat: Schema.Literals(["openpgp", "ssh", "x509"]),
  signingProgram: Schema.String,
  local: Schema.Struct({
    name: Schema.NullOr(Schema.String),
    email: Schema.NullOr(Schema.String),
    signing: Schema.NullOr(Schema.Boolean),
    signingKey: Schema.NullOr(Schema.String),
    signingFormat: Schema.NullOr(Schema.Literals(["openpgp", "ssh", "x509"])),
  }),
})
export type CommitIdentity = typeof CommitIdentity.Type

export const IdentitySettings = Schema.Struct({
  name: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  signing: Schema.NullOr(Schema.Boolean),
  signingKey: Schema.NullOr(Schema.String),
  signingFormat: Schema.NullOr(Schema.Literals(["openpgp", "ssh", "x509"])),
})
export type IdentitySettings = typeof IdentitySettings.Type

export const CommitUpdate = Schema.Union([
  Schema.TaggedStruct("Output", { text: Schema.String }),
  Schema.TaggedStruct("Committed", { oid: Oid }),
])
export type CommitUpdate = typeof CommitUpdate.Type

export const CredentialPrompt = Schema.Struct({
  id: Schema.String,
  message: Schema.String,
  secret: Schema.Boolean,
})
export type CredentialPrompt = typeof CredentialPrompt.Type
