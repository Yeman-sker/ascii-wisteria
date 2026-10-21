import { WisteriaEngine } from "./src";

// ?intro=0 skips the opening; ?poem=0 turns the poem off; ?poem=句子 shows your own line.
const params = new URLSearchParams(location.search);
const poem = params.get("poem");

const image = params.get("image");

const engine = new WisteriaEngine(document.querySelector("canvas")!, {
  // ?image=0 shows the built-in illustration; ?image=url uses another photo.
  image: image === "0" ? undefined : image ?? "/wisteria.jpg",
  intro: params.get("intro") !== "0",
  poem: poem === "0" ? false : poem ? poem.split("|") : undefined,
  poemDelay: params.has("poemDelay") ? Number(params.get("poemDelay")) : undefined,
});

// Handy for poking at the simulation from the console.
(window as unknown as { wisteria: WisteriaEngine }).wisteria = engine;
