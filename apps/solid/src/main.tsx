import { render } from "@solidjs/web"
import "./styles.css"
import { App } from "./app"

const root = document.getElementById("root")
if (root !== null) render(() => <App />, root)
