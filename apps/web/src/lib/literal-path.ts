export const literalPath = (path: string) => {
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i)
    if (code < 32 || code === 127) return JSON.stringify(path)
  }
  return /[\\"]|^\s|\s$|\s{2}/.test(path) ? JSON.stringify(path) : path
}
