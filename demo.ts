import { WisteriaEngine } from "./src";

// ?intro=0 skips the opening; ?image=0 shows the built-in illustration; ?image=url uses another photo.
const params = new URLSearchParams(location.search);
const image = params.get("image");

const engine = new WisteriaEngine(document.querySelector("canvas")!, {
  image: image === "0" ? undefined : image ?? "/wisteria.jpg",
  intro: params.get("intro") !== "0",
});

// Handy for poking at the simulation from the console.
(window as unknown as { wisteria: WisteriaEngine }).wisteria = engine;
