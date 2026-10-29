export type FailureHint = "identity" | "signing" | "http-auth" | "ssh-auth"

const patterns: ReadonlyArray<readonly [FailureHint, RegExp]> = [
  [
    "identity",
    /tell me who you are|identity unknown|empty ident name|unable to auto-detect email|no (?:name|email) was given/i,
  ],
  [
    "signing",
    /failed to sign|ssh-keygen|gpgsm|user\.signingkey|defaultKeyCommand|no private key found|couldn't load public key|load key/i,
  ],
  [
    "http-auth",
    /authentication failed for|invalid username or password|could not read (?:username|password)|returned error: 40[13]|access denied/i,
  ],
  ["ssh-auth", /permission denied \(publickey/i],
]

export const failureHint = (text: string): FailureHint | null =>
  patterns.find(([, pattern]) => pattern.test(text))?.[0] ?? null

export const hintMessages: Record<FailureHint, string> = {
  identity: "Git needs a name and email for the commit author.",
  signing: "Git couldn't sign the commit. Check the signing key and format, and that your signing program can run.",
  "http-auth":
    "The remote rejected the sign-in. Check that your credential helper has a token or password with access to this repository.",
  "ssh-auth":
    "The remote rejected your SSH key. Check that your SSH agent has a key loaded (ssh-add -l) with access to this repository.",
}

export const authAdvice = (stderr: string) => {
  const hint = failureHint(stderr)
  return hint === "http-auth" || hint === "ssh-auth" ? hintMessages[hint] : null
}
