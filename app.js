// app.js — SAFE BASELINE

const app = document.getElementById("app");

if (!app) {
  throw new Error("Missing #app root");
}

// NEVER clear body — only touch #app
app.innerHTML = `
  <section class="hero">
    <h1>Unplugged Channel</h1>
    <p>Warm. Cozy. Unplugged.</p>
  </section>

  <section id="episodes"></section>
`;

// Load episode data safely
import { episodes } from "./data/episodes.js";

const episodesEl = document.getElementById("episodes");

if (!episodesEl) {
  console.warn("Episodes container missing");
} else {
  episodesEl.innerHTML = episodes.map(ep => `
    <article class="episode">
      <h3>${ep.title}</h3>
      <p>${ep.description || ""}</p>
    </article>
  `).join("");
}
