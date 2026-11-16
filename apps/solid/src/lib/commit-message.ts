export const splitMessage = (message: string) => {
  const [summary = "", ...rest] = message.split("\n")
  if (rest[0] === "") rest.shift()
  return { summary, description: rest.join("\n") }
}

export const joinMessage = (summary: string, description: string) =>
  description === "" ? summary : `${summary}\n\n${description}`
