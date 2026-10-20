// Room 808 FM — the stations on the dial.
//
// Each entry needs a DIRECT STREAM URL: the address a player like VLC would
// open (usually ends in .mp3 / .aac, or is an Icecast/Shoutcast mount), not
// the station's web page. Where to find it: the station's "listen live"
// player (right-click → inspect the <audio> element, or read the player's
// config in the page source), the station's "stream URL / for apps" page, or
// a directory such as radio-browser.info.
//
//   id        unique, used to remember the last station
//   name      shown on the dial
//   tagline   what the station plays (optional)
//   location  city / region (optional)
//   group     "Local" | "National" | anything — the dial groups by it
//   url       the stream (https:// works everywhere; http:// only on an http page)
//   site      the station's website (optional, opens in a new tab)
//
// Streams that send CORS headers play through the room's mixer and meters;
// ones that don't still play, straight to the speakers. Listeners can also add
// their own stations in the panel (saved in the browser).
export const STATIONS = [
  // ---- Local ----
  {
    // the StreamOn player at listen.streamon.fm/cfuv uses this AAC mount
    id: "cfuv", name: "CFUV 101.9 FM", tagline: "Victoria's campus & community station", location: "Victoria, BC",
    group: "Local", url: "https://ais-sa1.streamon.fm/7132_64k.aac", site: "https://listen.streamon.fm/cfuv"
  },
  {
    // the Radio Player widget on kootenaycoopradio.com streams from this AzuraCast mount
    id: "kcr", name: "Kootenay Co-op Radio 93.5", tagline: "Community-powered radio · CJLY", location: "Nelson, BC",
    group: "Local", url: "https://a10.asurahosting.com:7410/radio.mp3", site: "https://www.kootenaycoopradio.com/"
  }

  // ---- National ----
  // { id: "national-1", name: "Station name", tagline: "What it plays", location: "Country", group: "National", url: "https://…", site: "https://…" },
];

/** A usable station: a name and an http(s) stream URL. */
export function validStation(s) {
  return !!(s && typeof s.name === "string" && s.name.trim() && typeof s.url === "string" && /^https?:\/\/\S+$/i.test(s.url.trim()));
}
