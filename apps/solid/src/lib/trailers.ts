export interface Person {
  readonly name: string
  readonly email: string
}

const CO_AUTHOR = /^co-authored-by:\s*(.+?)\s*<([^>]*)>\s*$/i

export const splitCoAuthors = (message: string, author: Person) => {
  const coAuthors: Array<Person> = []
  const kept: Array<string> = []
  for (const line of message.split("\n")) {
    const match = CO_AUTHOR.exec(line.trim())
    const name = match?.[1]
    const email = match?.[2]
    if (name === undefined || email === undefined) {
      kept.push(line)
      continue
    }
    const known = [author, ...coAuthors].some((person) => person.email.toLowerCase() === email.toLowerCase())
    if (!known) coAuthors.push({ name, email })
  }
  return { message: kept.join("\n").trimEnd(), coAuthors }
}
