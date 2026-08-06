export function destinationFor(search) {
  const lobby = new URLSearchParams(search).get("tv") === "1";
  return lobby
    ? "https://lvzion.vercel.app/rooms/tv"
    : "https://lvzion.vercel.app/rooms";
}

if (typeof window !== "undefined") {
  const destination = destinationFor(window.location.search);
  document.querySelector("#continue")?.setAttribute("href", destination);
  window.location.replace(destination);
}
