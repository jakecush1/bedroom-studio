import "./jc808.css";
import { TEMPLATE } from "./template.js";
import { mountJC808 } from "./app.js";

export function create(studio, host) {
  const root = document.createElement("div");
  root.className = "jc808";
  root.innerHTML = TEMPLATE;
  host.appendChild(root);
  return mountJC808(root, studio);
}
